type DialogForAi = {
  peerId: number;
  transcript: string;
  averageResponse: number | null;
  slow: boolean;
  unanswered: boolean;
};

export type AiDialogResult = {
  peerId: number;
  intent: string;
  goal: string;
  goalReached: boolean;
  status: "Успешно" | "Риск" | "Потерян" | "Не лид";
  objections: string[];
  score: number;
  issue: string;
  nuance: string;
  recommendation: string;
  betterReply: string;
  confidence: number;
};

type Usage = { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number };
type RouterPayload = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

const ROUTER_BASE_URLS = [
  process.env.OPENAI_BASE_URL || "https://router.cheap/v1",
  process.env.OPENAI_RESERVE_URL || "https://direct.router-cheap.com/v1",
].map((value) => value.replace(/\/$/, ""));
const MODEL_PRIORITY = [
  process.env.OPENAI_MODEL,
  "deepseek-v4-flash",
  "gemini-3.8-flash",
  "gpt-5.4-mini",
  "claude-haiku-4-5",
].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
const PRICES: Record<string, [number, number]> = {
  "gpt-5.6-luna": [1, 6],
  "gpt-5.6-terra": [2.5, 15],
  "gpt-5.6-sol": [5, 30],
  "gpt-4o": [2.5, 10],
};

function readableRouterError(error: unknown) {
  const message = error instanceof Error ? error.message : "Router Cheap не обработал запрос";
  return /Access to model .* is disabled/i.test(message)
    ? "В аккаунте Router Cheap закрыт доступ к моделям. В разделе Routing включите automatic conversion или смените тип баланса."
    : message;
}

function extractText(payload: RouterPayload) {
  const chatContent = payload.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return chatContent;
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) if (part.type === "output_text" && part.text) return part.text;
  }
  throw new Error("OpenAI не вернул структурированный результат");
}

function parseStructuredText(text: string) {
  const candidates = [
    text.trim(),
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
  ];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Router Cheap may wrap structured output in Markdown; try the next representation.
    }
  }
  throw new Error("Модель вернула ответ не в формате JSON");
}

function dialogsFromParsed(parsed: unknown, schemaName = "vk_dialog_analysis"): AiDialogResult[] {
  if (Array.isArray(parsed)) return parsed as AiDialogResult[];
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const candidates = [
    record.dialogs,
    record.results,
    (record.data as Record<string, unknown> | undefined)?.dialogs,
    (record.result as Record<string, unknown> | undefined)?.dialogs,
    (record.analysis as Record<string, unknown> | undefined)?.dialogs,
    (record[schemaName] as Record<string, unknown> | undefined)?.dialogs,
    record[schemaName],
  ];
  const direct = candidates.find(Array.isArray);
  if (direct) return direct as AiDialogResult[];

  // Some OpenAI-compatible routers add their own envelope around structured output.
  // Find the first array that actually looks like dialog results without relying on its key.
  const seen = new Set<unknown>();
  const findNested = (value: unknown, depth: number): AiDialogResult[] => {
    if (depth > 6 || value === null || typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === "object" && "peerId" in item)) return value as AiDialogResult[];
      for (const item of value) {
        const found = findNested(item, depth + 1);
        if (found.length) return found;
      }
      return [];
    }
    const nestedRecord = value as Record<string, unknown>;
    if (typeof nestedRecord.peerId === "number") return [nestedRecord as AiDialogResult];
    for (const child of Object.values(nestedRecord)) {
      const found = findNested(child, depth + 1);
      if (found.length) return found;
    }
    return [];
  };
  return findNested(parsed, 0);
}

function usageOf(payload: RouterPayload, model: string): Usage {
  const inputTokens = Number(payload.usage?.input_tokens || payload.usage?.prompt_tokens || 0);
  const outputTokens = Number(payload.usage?.output_tokens || payload.usage?.completion_tokens || 0);
  const [inputPrice, outputPrice] = PRICES[model] || [0, 0];
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(payload.usage?.total_tokens || inputTokens + outputTokens),
    estimatedCostUsd: (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000,
  };
}

async function routerChat(apiKey: string, model: string, input: unknown, instructions: string, timeoutMs: number) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: `${instructions} Верни только объект JSON с корневым массивом dialogs, без Markdown, заголовков и пояснений.` },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 3500,
  });
  let lastError = "Router Cheap недоступен";
  for (const baseUrl of ROUTER_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await response.text();
      let payload: RouterPayload;
      try { payload = JSON.parse(responseText) as RouterPayload; } catch { payload = { error: { message: responseText.slice(0, 300) } }; }
      if (!response.ok) {
        lastError = payload.error?.message || `Ошибка Router Cheap (${response.status})`;
        if (response.status >= 500) continue;
        break;
      }
      return { parsed: parseStructuredText(extractText(payload)), usage: usageOf(payload, model), model, finishReason: payload.choices?.[0]?.finish_reason || "" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) break;
    }
  }
  throw new Error(lastError);
}

function normalizeAiDialog(value: unknown, expectedIds: Set<number>): AiDialogResult | null {
  if (!value || typeof value !== "object") return null;
  const dialog = value as Record<string, unknown>;
  const peerId = Number(dialog.peerId);
  const score = Number(dialog.score);
  const confidence = Number(dialog.confidence);
  const status = dialog.status;
  if (!expectedIds.has(peerId) || !["Успешно", "Риск", "Потерян", "Не лид"].includes(String(status)) ||
    typeof dialog.goalReached !== "boolean" || !Number.isFinite(score) || !Number.isFinite(confidence)) return null;
  return {
    peerId, status: status as AiDialogResult["status"], goalReached: dialog.goalReached,
    score: Math.max(0, Math.min(100, score)), confidence: Math.max(0, Math.min(100, confidence <= 1 ? confidence * 100 : confidence)),
    intent: String(dialog.intent || ""), goal: String(dialog.goal || ""),
    objections: Array.isArray(dialog.objections) ? dialog.objections.map(String) : [],
    issue: String(dialog.issue || ""), nuance: String(dialog.nuance || ""),
    recommendation: String(dialog.recommendation || ""), betterReply: String(dialog.betterReply || ""),
  };
}

export async function analyzeDialogsWithAi(dialogs: DialogForAi[], sessionApiKey?: string, preferredModel?: string) {
  const all: AiDialogResult[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  let fallbackCount = 0;
  let failureReason = "";
  const diagnostics: Array<{ model: string; returned: number; accepted: number; finishReason?: string; error?: string; shape?: Record<string, string>; idMatch?: boolean }> = [];
  const apiKey = sessionApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("На сервере сайта не настроен API-ключ Router Cheap");
  const models = preferredModel && MODEL_PRIORITY.includes(preferredModel)
    ? [preferredModel, ...MODEL_PRIORITY.filter((model) => model !== preferredModel)]
    : MODEL_PRIORITY;
  const usedModels = new Set<string>();
  for (let index = 0; index < dialogs.length; index += 3) {
    const part = dialogs.slice(index, index + 3).map((dialog) => ({
      ...dialog,
      transcript: dialog.transcript.split("\n").slice(-18).map((line) => line.slice(0, 500)).join("\n"),
    }));
    const completed = new Map<number, AiDialogResult>();
    for (const model of models.slice(0, 3)) {
      const remaining = part.filter((dialog) => !completed.has(dialog.peerId));
      if (!remaining.length) break;
      try {
        const result = await routerChat(apiKey, model, { dialogs: remaining }, [
        "Ты старший руководитель отдела продаж. Анализируй каждый диалог по смыслу и контексту, а не по ключевым словам.",
        "Контекст бизнеса: музей эмальерного искусства, выставки, экскурсии, мастер-классы и билеты.",
        "Целевой интерес — намерение посетить, записаться, купить билет или мастер-класс. Цель достигнута только при подтверждённой записи, покупке или оплате. Переданный телефон оценивай отдельно и не считай достигнутой целью.",
        "Подмечай скрытые сомнения, слабые ответы, отсутствие инициативы, пропущенные вопросы и момент потери клиента.",
        "Не выдумывай факты. Если переписка неоднозначна — снижай confidence. Ответы должны быть краткими и прикладными.",
        "Персональные данные уже заменены маркерами. Не пытайся их восстановить.",
        "Для каждого входного peerId верни ровно один объект со всеми полями: peerId, intent, goal, goalReached, status, objections, score, issue, nuance, recommendation, betterReply, confidence.",
      ].join(" "), 60_000);
        const parsedDialogs = dialogsFromParsed(result.parsed);
        const requestedIds = new Set(remaining.map((dialog) => dialog.peerId));
        let accepted = 0;
        for (const item of parsedDialogs) {
          const normalized = normalizeAiDialog(item, requestedIds);
          if (normalized) { completed.set(normalized.peerId, normalized); accepted += 1; }
        }
        const sample = parsedDialogs[0] as unknown;
        const shape = sample && typeof sample === "object"
          ? Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value]))
          : undefined;
        diagnostics.push({ model, returned: parsedDialogs.length, accepted, finishReason: result.finishReason, shape, idMatch: sample && typeof sample === "object" ? requestedIds.has(Number((sample as Record<string, unknown>).peerId)) : undefined });
        if (completed.size) usedModels.add(result.model);
        usage = {
          inputTokens: usage.inputTokens + result.usage.inputTokens,
          outputTokens: usage.outputTokens + result.usage.outputTokens,
          totalTokens: usage.totalTokens + result.usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd + result.usage.estimatedCostUsd,
        };
      } catch (error) {
        if (!failureReason) failureReason = readableRouterError(error);
        diagnostics.push({ model, returned: 0, accepted: 0, error: readableRouterError(error) });
        // Try the next currently available fast model.
      }
    }
    all.push(...completed.values());
    fallbackCount += part.length - completed.size;
  }
  return {
    dialogs: all,
    usage,
    model: usedModels.size ? [...usedModels].join(", ") : "резервный алгоритм",
    analyzedCount: all.length,
    fallbackCount,
    failureReason: all.length ? "" : failureReason,
    diagnostics,
  };
}

export async function checkRouterModels(apiKey: string) {
  let failureReason = "Router Cheap не обработал проверочный запрос";
  for (const model of MODEL_PRIORITY.slice(0, 3)) {
    try {
      await routerChat(apiKey, model, { check: true }, "Верни JSON {\"ok\":true}.", 8_000);
      return { ok: true, model };
    } catch (error) {
      if (error instanceof Error && (/Access to model|Routing/i.test(error.message) || failureReason === "Router Cheap не обработал проверочный запрос")) {
        failureReason = readableRouterError(error);
      }
    }
  }
  return { ok: false, error: failureReason };
}
