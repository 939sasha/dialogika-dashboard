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

const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const PRICES: Record<string, [number, number]> = {
  "gpt-5.6-luna": [1, 6],
  "gpt-5.6-terra": [2.5, 15],
  "gpt-5.6-sol": [5, 30],
};

function extractText(payload: any) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) if (part.type === "output_text" && part.text) return part.text;
  }
  throw new Error("OpenAI не вернул структурированный результат");
}

function usageOf(payload: any): Usage {
  const inputTokens = Number(payload.usage?.input_tokens || 0);
  const outputTokens = Number(payload.usage?.output_tokens || 0);
  const [inputPrice, outputPrice] = PRICES[MODEL] || [0, 0];
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(payload.usage?.total_tokens || inputTokens + outputTokens),
    estimatedCostUsd: (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000,
  };
}

async function responses(input: unknown, schema: Record<string, unknown>, name: string, instructions: string, sessionApiKey?: string) {
  const apiKey = sessionApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("На сервере сайта не настроен OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions,
      input: JSON.stringify(input),
      text: { verbosity: "low", format: { type: "json_schema", name, strict: true, schema } },
      max_output_tokens: 8000,
    }),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload.error?.message || `Ошибка OpenAI (${response.status})`);
  return { parsed: JSON.parse(extractText(payload)), usage: usageOf(payload), model: MODEL };
}

const dialogSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dialogs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          peerId: { type: "integer" }, intent: { type: "string" }, goal: { type: "string" },
          goalReached: { type: "boolean" }, status: { type: "string", enum: ["Успешно", "Риск", "Потерян", "Не лид"] },
          objections: { type: "array", items: { type: "string" } }, score: { type: "integer", minimum: 0, maximum: 100 },
          issue: { type: "string" }, nuance: { type: "string" }, recommendation: { type: "string" },
          betterReply: { type: "string" }, confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["peerId", "intent", "goal", "goalReached", "status", "objections", "score", "issue", "nuance", "recommendation", "betterReply", "confidence"],
      },
    },
  },
  required: ["dialogs"],
};

export async function analyzeDialogsWithAi(dialogs: DialogForAi[], sessionApiKey?: string) {
  const all: AiDialogResult[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  for (let index = 0; index < dialogs.length; index += 8) {
    const part = dialogs.slice(index, index + 8);
    const result = await responses(part, dialogSchema, "vk_dialog_analysis", [
      "Ты старший руководитель отдела продаж. Анализируй каждый диалог по смыслу и контексту, а не по ключевым словам.",
      "Самостоятельно определи намерение клиента, фактическое целевое действие бизнеса и достигнуто ли оно.",
      "Подмечай скрытые сомнения, слабые ответы, отсутствие инициативы, пропущенные вопросы и момент потери клиента.",
      "Не выдумывай факты. Если переписка неоднозначна — снижай confidence. Ответы должны быть краткими и прикладными.",
      "Персональные данные уже заменены маркерами. Не пытайся их восстановить.",
    ].join(" "), sessionApiKey);
    all.push(...(result.parsed.dialogs as AiDialogResult[]));
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
      totalTokens: usage.totalTokens + result.usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd + result.usage.estimatedCostUsd,
    };
  }
  return { dialogs: all, usage, model: MODEL };
}
