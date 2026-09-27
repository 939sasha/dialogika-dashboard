import { analyzeDialogsWithAi } from "../../../lib/openaiAnalysis";

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";
// Keep each Worker request comfortably below Cloudflare's proxy timeout.
// The browser continues with the next page and updates visible progress after every batch.
const BATCH_SIZE = 3;
const PHONE_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
const PHONE_GLOBAL_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;
const INTEREST_RE = /(цен|стоим|сколько|билет|посет|запис|экскурс|выстав|мастер.?класс|расписан|места|оплат)\w*/i;

const GOALS = {
  order: { label: "Запись на посещение", signal: /(запис\w*|билет\w*|экскурс\w*|мастер.?класс\w*)/i, success: /(запис\w*\s+(?:подтвержд|оформл)|вас\s+записали|билет\w*\s+(?:куплен|оформлен|приобретен))/i },
  payment: { label: "Получение оплаты", signal: /(оплат\w*|чек|предоплат\w*|ссылк\w*\s+на\s+оплат)/i, success: /(оплатил\w*|оплата\s+(?:прошла|получена)|чек\s+об\s+оплате)/i },
};
const PURCHASE_SUCCESS_RE = /(билет\w*\s+(?:куплен|оформлен|приобретен)|оплатил\w*|оплата\s+(?:прошла|получена)|чек\s+об\s+оплате|покупк\w*\s+(?:оформлен|подтвержден|совершен))/i;
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
type VkMessage = { id: number; date: number; from_id: number; peer_id: number; out: number; text?: string; ref?: string; ref_source?: string };
type ConversationItem = { conversation?: { peer?: { id?: number } }; last_message?: VkMessage };
type SenlerCredential = { accessToken: string; groupId: string };
type SenlerSubscriber = {
  vk_user_id?: number;
  ref?: string;
  ref_source?: string;
  utms?: Array<Record<string, unknown>>;
};

function sanitizeMessageText(value?: string) {
  return (value || "[вложение]")
    .replace(PHONE_GLOBAL_RE, "[ТЕЛЕФОН]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[ССЫЛКА]")
    .replace(/\b(?:id|club)\d+\b/gi, "[VK_ID]")
    .slice(0, 350);
}

function sanitizedTranscript(messages: VkMessage[]) {
  return [...messages]
    .sort((a, b) => a.date - b.date)
    .slice(-40)
    .map((message) => {
      const time = new Date(message.date * 1000).toISOString();
      return `${time} ${message.out ? "МЕНЕДЖЕР" : "КЛИЕНТ"}: ${sanitizeMessageText(message.text)}`;
    })
    .join("\n")
    .slice(-12000);
}

function evidenceMessages(messages: VkMessage[]) {
  const chronological = [...messages].sort((a, b) => a.date - b.date);
  if (!chronological.length) return [];
  const signalIndexes = chronological
    .map((message, index) => ({
      index,
      text: message.text || "",
    }))
    .filter(({ text }) => PHONE_RE.test(text) || PURCHASE_SUCCESS_RE.test(text) || INTEREST_RE.test(text))
    .map(({ index }) => index);

  const selected = new Set<number>();
  for (const index of signalIndexes.slice(-2)) {
    if (index > 0) selected.add(index - 1);
    selected.add(index);
    if (index + 1 < chronological.length) selected.add(index + 1);
  }
  for (let index = chronological.length - 1; index >= 0 && selected.size < 4; index -= 1) selected.add(index);

  return [...selected]
    .sort((a, b) => a - b)
    .slice(-4)
    .map((index) => {
      const message = chronological[index];
      return {
        role: message.out ? "Менеджер" as const : "Клиент" as const,
        text: sanitizeMessageText(message.text),
        date: new Date(message.date * 1000).toISOString(),
      };
    });
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
    if ([6, 9].includes(payload.error?.error_code || 0) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1) * (attempt + 1)));
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
  let adId: string | null = null;
  let totalCount = 0;
  let oldestSeen = false;
  while (true) {
    const page = await vkMethod("messages.getHistory", token, {
      peer_id: String(peerId),
      count: "200",
      offset: String(offset),
      group_id: String(groupId),
    }) as { count?: number; items?: VkMessage[] };
    const items = page.items || [];
    totalCount = page.count || totalCount;
    const detectedAdId = items.map(adIdFromMessage).find(Boolean);
    if (!adId && detectedAdId) adId = detectedAdId;
    all.push(...items.filter((message) => message.date >= cutoff));
    if (offset + items.length >= (page.count || 0)) {
      firstEverDate = items.at(-1)?.date || null;
      oldestSeen = true;
    }
    if ((items.at(-1)?.date || 0) < cutoff) firstEverDate = items.at(-1)?.date || null;
    if (items.length < 200 || (items.at(-1)?.date || 0) < cutoff) break;
    offset += items.length;
  }
  // The VK advertising marker is normally attached to the very first message.
  // It may be years older than the selected analytics period, so fetch the oldest
  // history page once instead of scanning the entire conversation.
  if (!adId && !oldestSeen && totalCount > 0) {
    const oldestPage = await vkMethod("messages.getHistory", token, {
      peer_id: String(peerId), count: "1", offset: String(totalCount - 1), group_id: String(groupId),
    }) as { items?: VkMessage[] };
    const oldestItems = oldestPage.items || [];
    adId = oldestItems.map(adIdFromMessage).find(Boolean) || adId;
    firstEverDate = oldestItems.at(-1)?.date || firstEverDate;
  }
  return { messages: all, firstEverDate, adId };
}

function parseSenlerCredential(value?: string): SenlerCredential | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SenlerCredential>;
    return parsed.accessToken && parsed.groupId ? { accessToken: parsed.accessToken, groupId: parsed.groupId } : null;
  } catch { return null; }
}

function senlerAdId(item: SenlerSubscriber) {
  const candidates: Array<{ value: unknown; source?: unknown }> = [
    { value: item.ref, source: item.ref_source },
    ...(item.utms || []).flatMap((utm) => [
      { value: utm.ref, source: utm.ref_source },
      { value: utm.utm_content, source: utm.utm_source },
    ]),
  ];
  const preferred = candidates.find(({ value, source }) => value && /vk[_\s-]?ads|реклам/i.test(String(source || "")));
  const numeric = candidates.find(({ value }) => /^\d{5,}$/.test(String(value || "").trim()));
  const selected = preferred || numeric || candidates.find(({ value }) => String(value || "").trim());
  return selected ? String(selected.value).trim() : null;
}

async function getSenlerAds(credential: SenlerCredential | null, peerIds: number[]) {
  const result = new Map<number, string>();
  if (!credential || !peerIds.length) return result;
  const response = await fetch("https://senler.ru/api/subscribers/get", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      group_id: credential.groupId,
      access_token: credential.accessToken,
      v: 2,
      count: 100,
      vk_user_id: peerIds,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as { success?: boolean; items?: SenlerSubscriber[] } | null;
  if (!response.ok || !payload?.success) return result;
  for (const item of payload.items || []) {
    const adId = senlerAdId(item);
    if (item.vk_user_id && adId) result.set(Number(item.vk_user_id), adId);
  }
  return result;
}

function adIdFromMessage(message: VkMessage) {
  const ref = message.ref?.trim();
  if (!ref) return null;
  if (message.ref_source === "vk_ads" || message.ref_source?.toLowerCase().includes("ads")) return ref;
  return /^\d{5,}$/.test(ref) ? ref : null;
}

function messageRevision(message?: VkMessage) {
  if (!message?.id || !message.date) return "";
  return [message.id, message.date].join(":");
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
  const hasPhone = PHONE_RE.test(clientText);
  const purchaseConfirmed = PURCHASE_SUCCESS_RE.test(text);
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
  return { hasPhone, purchaseConfirmed, hasGoal, hasInterest, lost, unanswered, slow, poorNextStep, averageResponse, responseSum: responseTimes.reduce((a, b) => a + b, 0), responseCount: responseTimes.length, score, goalCounts, objectionCounts };
}

export async function POST(request: Request) {
  try {
    const { token, openaiKey, senlerCredential, preferredModel, groupId, days = 30, offset = 0, knownRevisions = {} } = await request.json() as {
      token?: string;
      openaiKey?: string;
      senlerCredential?: string;
      preferredModel?: string;
      groupId?: number;
      days?: number;
      offset?: number;
      knownRevisions?: Record<string, string>;
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

    type AnalysisRow = ReturnType<typeof analyzeDialog> & {
      peerId: number;
      firstEverDate: number | null;
      transcript: string;
      adId: string | null;
      revision: string;
      lastMessageId: number;
      lastMessageDate: number;
      evidence: Array<{ role: "Клиент" | "Менеджер"; text: string; date: string }>;
    };

    const unchangedPeerIds: number[] = [];
    const changedItems: Array<{ peerId: number; revision: string; lastMessage: VkMessage }> = [];
    for (const item of active) {
      const peerId = item.conversation?.peer?.id;
      const lastMessage = item.last_message;
      if (!peerId || !lastMessage) continue;
      const revision = messageRevision(lastMessage);
      if (revision && knownRevisions[String(peerId)] === revision) {
        unchangedPeerIds.push(peerId);
        continue;
      }
      changedItems.push({ peerId, revision, lastMessage });
    }

    const rawRows = await Promise.all(changedItems.map(async ({ peerId, revision, lastMessage }) => {
      const history = await getHistory(token, groupId, peerId, cutoff);
      if (!history.messages.length) return null;
      return {
        peerId,
        firstEverDate: history.firstEverDate,
        adId: history.adId,
        transcript: sanitizedTranscript(history.messages),
        revision,
        lastMessageId: lastMessage.id,
        lastMessageDate: lastMessage.date,
        evidence: evidenceMessages(history.messages),
        ...analyzeDialog(history.messages),
      } satisfies AnalysisRow;
    }));
    const attributedRows = rawRows.filter((row): row is AnalysisRow => row !== null);

    const senlerAds = await getSenlerAds(parseSenlerCredential(senlerCredential), attributedRows.map((row) => row.peerId));
    for (const row of attributedRows) if (!row.adId) row.adId = senlerAds.get(row.peerId) || null;
    const rows = attributedRows.filter((row) => Boolean(row.adId));

    const aiResult = rows.length
      ? await analyzeDialogsWithAi(rows.map((row) => ({
          peerId: row.peerId,
          transcript: row.transcript,
          averageResponse: row.averageResponse,
          slow: row.slow,
          unanswered: row.unanswered,
        })), openaiKey, preferredModel)
      : {
          dialogs: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
          model: "",
          analyzedCount: 0,
          fallbackCount: 0,
          failureReason: "",
          diagnostics: [],
        };
    const aiByPeer = new Map(aiResult.dialogs.map((dialog) => [dialog.peerId, dialog]));

    const ads = new Map<string, { adId: string; dialogs: number; leads: number; targets: number; lost: number; scoreSum: number }>();
    for (const row of rows) {
      if (!row.adId) continue;
      const current = ads.get(row.adId) || { adId: row.adId, dialogs: 0, leads: 0, targets: 0, lost: 0, scoreSum: 0 };
      const aiDialog = aiByPeer.get(row.peerId);
      current.dialogs += 1;
      current.leads += Number(aiDialog ? aiDialog.status !== "Не лид" : row.hasInterest);
      current.targets += Number(aiDialog ? aiDialog.goalReached : row.hasGoal);
      current.lost += Number(aiDialog ? aiDialog.status === "Потерян" : row.lost);
      current.scoreSum += aiDialog?.score ?? row.score;
      ads.set(row.adId, current);
    }

    const aiGoals = aiResult.dialogs.reduce<Record<string, number>>((acc, dialog) => {
      if (dialog.goal && dialog.goal !== "не определена") acc[dialog.goal] = (acc[dialog.goal] || 0) + 1;
      return acc;
    }, {});
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
    const leads = rows.filter((row) => aiByPeer.get(row.peerId)?.status !== "Не лид" && (aiByPeer.has(row.peerId) || row.hasInterest)).length;
    const targets = rows.filter((row) => aiByPeer.get(row.peerId)?.goalReached ?? row.hasGoal).length;
    const lost = rows.filter((row) => aiByPeer.get(row.peerId)?.status === "Потерян" || (!aiByPeer.has(row.peerId) && row.lost)).length;

    return Response.json({
      done: reachedCutoff || items.length < BATCH_SIZE || offset + items.length >= (conversations.count || 0),
      nextOffset: offset + items.length,
      totalConversations: conversations.count || 0,
      pageDialogs: active.length,
      changedDialogs: rows.length,
      unchangedPeerIds,
      goalLabels: Object.fromEntries(Object.entries(GOALS).map(([key, value]) => [key, value.label])),
      objectionLabels: Object.fromEntries(Object.entries(OBJECTIONS).map(([key, value]) => [key, value.label])),
      stats: {
        dialogs: rows.length,
        leads,
        contacts: rows.filter((row) => row.hasPhone).length,
        targets,
        lost,
        responseSum: rows.reduce((sum, row) => sum + row.responseSum, 0),
        responseCount: rows.reduce((sum, row) => sum + row.responseCount, 0),
      },
      goalCounts,
      objectionCounts,
      objectionDialogs: rows.filter((row) => Object.values(row.objectionCounts).some((count) => count > 0)).length,
      dailyNew,
      ads: [...ads.values()],
      ai: {
        enabled: true,
        model: aiResult.model,
        analyzedCount: aiResult.analyzedCount,
        fallbackCount: aiResult.fallbackCount,
        failureReason: aiResult.failureReason,
        diagnostics: aiResult.diagnostics,
        usage: aiResult.usage,
        goals: aiGoals,
        nuances: aiResult.dialogs.map((dialog) => dialog.nuance).filter(Boolean),
        recommendations: aiResult.dialogs.map((dialog) => dialog.recommendation).filter(Boolean),
      },
      problems: {
        slowResponse: rows.filter((row) => row.slow).length,
        noNextStep: rows.filter((row) => row.poorNextStep).length,
        unanswered: rows.filter((row) => row.unanswered).length,
      },
      dialogs: rows.map((row) => {
        const ai = aiByPeer.get(row.peerId);
        return {
          peerId: row.peerId,
          adId: row.adId,
          revision: row.revision,
          lastMessageId: row.lastMessageId,
          lastMessageDate: row.lastMessageDate,
          evidence: row.evidence,
          goalReached: ai?.goalReached ?? row.hasGoal,
          purchase: row.purchaseConfirmed || Boolean(ai?.goalReached && /(покуп|оплат|билет|приобр)/i.test(`${ai.goal || ""} ${ai.issue || ""}`)),
          aiAnalyzed: Boolean(ai),
          aiModel: ai ? aiResult.model : "",
          metrics: {
            hasPhone: row.hasPhone,
            hasInterest: row.hasInterest,
            responseSum: row.responseSum,
            responseCount: row.responseCount,
            slowResponse: row.slow,
            noNextStep: row.poorNextStep,
            unanswered: row.unanswered,
            firstEverDate: row.firstEverDate,
            objectionKeys: Object.entries(row.objectionCounts).filter(([, count]) => count > 0).map(([key]) => key),
          },
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
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|aborted/i.test(error.message));
    return Response.json(
      { error: timedOut ? "Router Cheap отвечает слишком долго. Пачка будет запущена повторно автоматически." : error instanceof Error ? error.message : "Не удалось провести анализ" },
      { status: timedOut ? 504 : 400 },
    );
  }
}
