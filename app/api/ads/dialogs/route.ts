import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";
const PHONE_GLOBAL_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;

type StoredDialog = {
  peerId?: number;
  adId?: string | null;
  status?: string;
  score?: number;
  issue?: string;
  goal?: string;
  goalReached?: boolean;
  purchase?: boolean;
  metrics?: { hasPhone?: boolean };
  evidence?: Array<{ role: "Клиент" | "Менеджер"; text: string; date: string }>;
};

type VkMessage = { id?: number; date?: number; out?: number; text?: string };

async function vkHistory(token: string, groupId: string, peerId: number, count = 8, offset = 0) {
  const body = new URLSearchParams({
    access_token: token,
    v: VK_VERSION,
    group_id: groupId,
    peer_id: String(peerId),
    count: String(count),
    offset: String(offset),
  });
  const response = await fetch(`${VK_API}/messages.getHistory`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json() as { response?: { items?: VkMessage[] }; error?: { error_msg?: string } };
  if (payload.error) throw new Error(payload.error.error_msg || "VK не вернул историю диалога");
  return payload.response?.items || [];
}

function sanitize(text: string) {
  return (text || "[вложение]")
    .replace(PHONE_GLOBAL_RE, "[ТЕЛЕФОН]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[ССЫЛКА]")
    .replace(/\b(?:id|club)\d+\b/gi, "[VK_ID]");
}

function purchaseOf(dialog: StoredDialog) {
  return dialog.purchase ?? (Boolean(dialog.goalReached) && /(покуп|оплат|билет|приобр)/i.test(`${dialog.goal || ""} ${dialog.issue || ""}`));
}

export async function GET(request: Request) {
  const authToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const { url: supabaseUrl, publishableKey: key } = publicSupabaseConfig();
  const requestUrl = new URL(request.url);
  const communityId = requestUrl.searchParams.get("communityId");
  const adId = requestUrl.searchParams.get("adId");
  const peerId = requestUrl.searchParams.get("peerId");
  const offset = Number(requestUrl.searchParams.get("offset") || 0);
  if (!authToken || !communityId || !adId) {
    return Response.json({ error: "Требуется вход" }, { status: 401 });
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || (peerId && (!Number.isSafeInteger(Number(peerId)) || Number(peerId) <= 0))) {
    return Response.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const client = createClient(supabaseUrl, key, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await client.auth.getUser(authToken);
  if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });

  const { data, error } = await client.from("dialogika_connections")
    .select("credential_ciphertext,latest_analysis")
    .eq("user_id", user.id)
    .eq("kind", "vk")
    .eq("external_id", communityId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const analysis = data?.latest_analysis as { dialogs?: StoredDialog[] } | null;
  const matched = (analysis?.dialogs || []).filter((dialog) => String(dialog.adId || "") === adId && dialog.peerId);
  if (peerId) {
    const dialog = matched.find((item) => String(item.peerId) === peerId);
    if (!dialog) return Response.json({ error: "Диалог не найден в этом источнике" }, { status: 404 });
    const { data: credential, error: credentialError } = await client.rpc("dialogika_get_credential", {
      p_kind: "vk",
      p_external_id: communityId,
    });
    if (credentialError || typeof credential !== "string" || !credential) {
      return Response.json({ error: "История VK недоступна. Проверьте подключение сообщества." }, { status: 503 });
    }
    try {
      const history: VkMessage[] = [];
      for (let page = 0; page < 5; page += 1) {
        const batch = await vkHistory(credential, communityId, Number(peerId), 200, page * 200);
        history.push(...batch);
        if (batch.length < 200) break;
      }
      return Response.json({
        messages: history.sort((a, b) => Number(a.date || 0) - Number(b.date || 0)).map((message) => ({
          role: message.out ? "Менеджер" : "Клиент",
          text: sanitize(message.text || "[вложение]"),
          date: message.date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(message.date * 1000)) : "",
        })),
        truncated: history.length >= 1000,
      });
    } catch {
      return Response.json({ error: "VK не вернул историю переписки" }, { status: 502 });
    }
  }

  const sorted = [...matched].sort((a, b) =>
    Number(purchaseOf(b)) - Number(purchaseOf(a)) ||
    Number(Boolean(b.metrics?.hasPhone)) - Number(Boolean(a.metrics?.hasPhone)) ||
    Number(b.score || 0) - Number(a.score || 0)
  );
  const selected = sorted.slice(offset, offset + 8);
  if (!selected.length) return Response.json({ dialogs: [], total: matched.length });

  const needsLiveHistory = selected.some((dialog) => !dialog.evidence?.length);
  let vkToken = "";
  if (needsLiveHistory) {
    const { data: credential, error: credentialError } = await client.rpc("dialogika_get_credential", {
      p_kind: "vk",
      p_external_id: communityId,
    });
    if (!credentialError && typeof credential === "string") vkToken = credential;
  }

  const rows = await Promise.all(selected.map(async (dialog) => {
    let messages = (dialog.evidence || []).map((message) => ({
      ...message,
      date: message.date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(message.date)) : "",
    }));
    let messagesUnavailable = false;

    if (!messages.length && vkToken) {
      const history = await vkHistory(vkToken, communityId, Number(dialog.peerId)).catch(() => []);
      messages = [...history]
        .sort((a, b) => Number(a.date || 0) - Number(b.date || 0))
        .slice(-6)
        .map((message) => ({
          role: message.out ? "Менеджер" as const : "Клиент" as const,
          text: sanitize(message.text || "[вложение]"),
          date: message.date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(message.date * 1000)) : "",
        }));
    }
    if (!messages.length) messagesUnavailable = true;

    return {
      peerId: Number(dialog.peerId),
      status: dialog.status || "Не определён",
      score: Number(dialog.score || 0),
      issue: dialog.issue || "",
      goal: dialog.goal || "",
      purchase: dialog.purchase !== undefined || dialog.goalReached !== undefined ? purchaseOf(dialog) : null,
      phone: dialog.metrics?.hasPhone !== undefined ? Boolean(dialog.metrics.hasPhone) : null,
      messages,
      messagesUnavailable,
    };
  }));

  return Response.json({
    dialogs: rows,
    total: matched.length,
    liveHistoryAvailable: Boolean(vkToken),
  });
}
