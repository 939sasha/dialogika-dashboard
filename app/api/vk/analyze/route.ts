import { analyzeDialogsWithAi } from "../../../lib/openaiAnalysis";

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";
const BATCH_SIZE = 25;
const PHONE_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
const INTEREST_RE = /(цен|стоим|сколько|заказ|портрет|холст|размер|срок|достав|макет|фото|оплат)\w*/i;

const GOALS = {
  order: { label: "Оформление заказа", signal: /(заказ\w*|оформ\w*|заказываю|портрет\w*)/i, success: /(заказ\s+(?:оформлен|принят|подтвержд)|оформили|заказываю|беру)/i },
  payment: { label: "Получение оплаты", signal: /(оплат\w*|чек|предоплат\w*|ссылк\w*\s+на\s+оплат)/i, success: /(оплатил\w*|оплата\s+(?:прошла|получена)|чек\s+об\s+оплате)/i },
  photo: { label: "Получение фото для макета", signal: /(фото\w*|изображени\w*|макет\w*)/i, success: /(прислал\w*\s+фото|отправил\w*\s+фото|фото\s+получен\w*|делайте\s+макет)/i },
  delivery: { label: "Получение данных для доставки", signal: /(достав\w*|адрес\w*|получател\w*|индекс)/i, success: /(адрес\s+(?:доставки|получателя)|фио\s+получателя|индекс\s+\d+)/i },
};
const OBJECTIONS = {
  price: { label: "Высокая цена", re: /(дорог\w*|слишком\s+дорог|цена\s+высок|дешевле|скидк\w*|бюджет\w*)/i },
  distance: { label: "Доставка и расстояние", re: /(далеко|доставк\w*|пересыл\w*|другой\s+город|не\s+доставляете|самовывоз)/i },
  timing: { label: "Сроки изготовления", re: /(долго|срок\w*|успеете|к\s+дат\w*|когда\s+готов|быстрее)/i },
  trust: { label: "Недостаток доверия", re: /(гарант\w*|отзыв\w*|боюсь|обман\w*|точно\s+получу|довер)/i },
  quality: { label: "Сомнения в результате", re: /(не\s+похож|качество|как\s+будет\s+выглядеть|не\s+понрав|передел)/i },
  payment: { label: "Условия оплаты", re: /(предоплат\w*|оплата\s+заранее|наложенн\w*|после\s+получения|частями)/i },
};

type GoalKey = keyof typeof GOALS;
type ObjectionKey = keyof typeof OBJECTIONS;
type VkMessage = { id: number; date: number; from_id: number; peer_id: number; out: number; text?: string };
type ConversationItem = { conversation?: { peer?: { id?: number } }; last_message?: VkMessage };

function sanitizedTranscript(messages: VkMessage[]) {
  return [...messages]
    .sort((a, b) => a.date - b.date)
    .slice(-40)
    .map((message) => {
      const text = (message.text || "[вложение]")
        .replace(PHONE_RE, "[ТЕЛЕФОН]")
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
        .replace(/https?:\/\/\S+/gi, "[ССЫЛКА]")
        .replace(/\b(?:id|club)\d+\b/gi, "[VK_ID]");
      const time = new Date(message.date * 1000).toISOString();
      return `${time} ${message.out ? "МЕНЕДЖЕР" : "КЛИЕНТ"}: ${text}`;
    })
    .join("\n")
    .slice(-12000);
}

async function vkMethod(method: string, token: string, params: Record<string, string>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = new URLSearchParams({ ...params, access_token: token, v: VK_VERSION });
    const response = await fetch(`${VK_API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json() as { response?: unknown; error?: { error_code?: number; error_msg?: string } };
    if (payload.error?.error_code === 6 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    if (payload.error) throw new Error(payload.error.error_msg || "Ошибка API ВКонтакте");
    return payload.response;
  }
  throw new Error("ВКонтакте временно ограничил частоту запросов");
}

async function getHistory(token: string, groupId: number, peerId: number, cutoff: number) {
  const all: VkMessage[] = [];
  let offset = 0;
  let firstEverDate: number | null = null;
  while (true) {
    const page = await vkMethod("messages.getHistory", token, {
      peer_id: String(peerId),
      count: "200",
      offset: String(offset),
      group_id: String(groupId),
    }) as { count?: number; items?: VkMessage[] };
    const items = page.items || [];
    all.push(...items.filter((message) => message.date >= cutoff));
    if (offset + items.length >= (page.count || 0)) firstEverDate = items.at(-1)?.date || null;
    if ((items.at(-1)?.date || 0) < cutoff) firstEverDate = items.at(-1)?.date || null;
    if (items.length < 200 || (items.at(-1)?.date || 0) < cutoff) break;
    offset += items.length;
  }
  return { messages: all, firstEverDate };
}

function analyzeDialog(messages: VkMessage[]) {
  const chronological = [...messages].sort((a, b) => a.date - b.date);
  const text = chronological.map((m) => m.text || "").join(" ");
  const clientText = chronological.filter((m) => !m.out).map((m) => m.text || "").join(" ");
  const inbound = chronological.filter((m) => !m.out);
  const outbound = chronological.filter((m) => m.out);
  const responseTimes: number[] = [];
  const goalCounts = Object.fromEntries(Object.keys(GOALS).map((key) => [key, 0])) as Record<GoalKey, number>;
  const objectionCounts = Object.fromEntries(Object.keys(OBJECTIONS).map((key) => [key, 0])) as Record<ObjectionKey, number>;
  for (const [key, goal] of Object.entries(GOALS) as Array<[GoalKey, (typeof GOALS)[GoalKey]]>) {
    goalCounts[key] = goal.signal.test(text) ? 1 : 0;
  }
  for (const [key, objection] of Object.entries(OBJECTIONS) as Array<[ObjectionKey, (typeof OBJECTIONS)[ObjectionKey]]>) {
    objectionCounts[key] = objection.re.test(clientText) ? 1 : 0;
  }

  let pendingInbound: number | null = null;
  for (const message of chronological) {
    if (!message.out && pendingInbound === null) pendingInbound = message.date;
    if (message.out && pendingInbound !== null) {
      responseTimes.push(Math.max(0, message.date - pendingInbound));
      pendingInbound = null;
    }
  }
  const hasPhone = PHONE_RE.test(text);
  const hasGoal = Object.values(GOALS).some((goal) => goal.success.test(text));
  const hasInterest = INTEREST_RE.test(text) || inbound.length > 1;
  const last = chronological.at(-1);
  const unanswered = Boolean(last && !last.out);
  const averageResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;
  const slow = responseTimes.some((seconds) => seconds > 15 * 60);
  const poorNextStep = hasInterest && !hasGoal;
  const lost = unanswered && hasInterest && !hasGoal;
  const score = Math.max(20, 100 - (slow ? 25 : 0) - (unanswered ? 25 : 0) - (poorNextStep ? 20 : 0) - (!outbound.length ? 30 : 0));
  return { hasPhone, hasGoal, hasInterest, lost, unanswered, slow, poorNextStep, averageResponse, score, goalCounts, objectionCounts };
}

export async function POST(request: Request) {
  try {
    const { token, openaiKey, groupId, days = 30, offset = 0 } = await request.json() as {
      token?: string; openaiKey?: string; groupId?: number; days?: number; offset?: number;
    };
    if (!token || !groupId || ![30, 60, 90].includes(days) || offset < 0) {
      return Response.json({ error: "Некорректные параметры анализа" }, { status: 400 });
    }

    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const conversations = await vkMethod("messages.getConversations", token, {
      count: String(BATCH_SIZE),
      offset: String(offset),
      filter: "all",
      group_id: String(groupId),
    }) as { count?: number; items?: ConversationItem[] };
    const items = conversations.items || [];
    const active = items.filter((item) => (item.last_message?.date || 0) >= cutoff);
    const reachedCutoff = active.length < items.length;
    const rows: Array<ReturnType<typeof analyzeDialog> & { peerId: number; firstEverDate: number | null; transcript: string }> = [];

    for (const item of active) {
      const peerId = item.conversation?.peer?.id;
      if (!peerId) continue;
      const history = await getHistory(token, groupId, peerId, cutoff);
      if (history.messages.length) rows.push({ peerId, firstEverDate: history.firstEverDate, transcript: sanitizedTranscript(history.messages), ...analyzeDialog(history.messages) });
    }

    const aiResult = await analyzeDialogsWithAi(rows.map((row) => ({
      peerId: row.peerId,
      transcript: row.transcript,
      averageResponse: row.averageResponse,
      slow: row.slow,
      unanswered: row.unanswered,
    })), openaiKey);
    const aiByPeer = new Map(aiResult.dialogs.map((dialog) => [dialog.peerId, dialog]));
    const aiGoals = aiResult.dialogs.reduce<Record<string, number>>((acc, dialog) => {
      if (dialog.goal && dialog.goal !== "не определена") acc[dialog.goal] = (acc[dialog.goal] || 0) + 1;
      return acc;
    }, {});

    const responseSeconds = rows.flatMap((r) => r.averageResponse === null ? [] : [r.averageResponse]);
    const goalCounts = Object.fromEntries(Object.keys(GOALS).map((key) => [
      key,
      rows.reduce((sum, row) => sum + row.goalCounts[key as GoalKey], 0),
    ])) as Record<GoalKey, number>;
    const objectionCounts = Object.fromEntries(Object.keys(OBJECTIONS).map((key) => [
      key,
      rows.reduce((sum, row) => sum + row.objectionCounts[key as ObjectionKey], 0),
    ])) as Record<ObjectionKey, number>;
    const dailyNew = rows.reduce<Record<string, number>>((acc, row) => {
      if (row.firstEverDate && row.firstEverDate >= cutoff) {
        const day = new Date((row.firstEverDate + 3 * 3600) * 1000).toISOString().slice(0, 10);
        acc[day] = (acc[day] || 0) + 1;
      }
      return acc;
    }, {});
    const lost = rows.filter((r) => r.lost).length;

    return Response.json({
      done: reachedCutoff || items.length < BATCH_SIZE || offset + items.length >= (conversations.count || 0),
      nextOffset: offset + items.length,
      totalConversations: conversations.count || 0,
      goalLabels: Object.fromEntries(Object.entries(GOALS).map(([key, value]) => [key, value.label])),
      objectionLabels: Object.fromEntries(Object.entries(OBJECTIONS).map(([key, value]) => [key, value.label])),
      stats: {
        dialogs: rows.length,
        leads: rows.filter((r) => r.hasInterest).length,
        contacts: rows.filter((r) => r.hasPhone).length,
        targets: rows.filter((r) => r.hasGoal).length,
        lost,
        responseSum: responseSeconds.reduce((a, b) => a + b, 0),
        responseCount: responseSeconds.length,
      },
      goalCounts,
      objectionCounts,
      objectionDialogs: rows.filter((row) => Object.values(row.objectionCounts).some((count) => count > 0)).length,
      dailyNew,
      ai: {
        enabled: true,
        model: aiResult.model,
        usage: aiResult.usage,
        goals: aiGoals,
        nuances: aiResult.dialogs.map((dialog) => dialog.nuance).filter(Boolean),
        recommendations: aiResult.dialogs.map((dialog) => dialog.recommendation).filter(Boolean),
      },
      problems: {
        slowResponse: rows.filter((r) => r.slow).length,
        noNextStep: rows.filter((r) => r.poorNextStep).length,
        unanswered: rows.filter((r) => r.unanswered).length,
      },
      dialogs: rows.map((row) => {
        const ai = aiByPeer.get(row.peerId);
        return {
          peerId: row.peerId,
          score: ai?.score ?? row.score,
          status: ai?.status ?? (row.lost ? "Потерян" : row.hasGoal ? "Успешно" : "Риск"),
          issue: ai?.issue ?? (row.slow ? "Долгий ответ" : row.unanswered ? "Нет ответа" : row.poorNextStep ? "Не предложен следующий шаг" : "Цель достигнута"),
          intent: ai?.intent || "",
          goal: ai?.goal || "",
          nuance: ai?.nuance || "",
          recommendation: ai?.recommendation || "",
          betterReply: ai?.betterReply || "",
          confidence: ai?.confidence || 0,
          objections: ai?.objections || [],
        };
      }),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось провести анализ" },
      { status: 400 },
    );
  }
}
