import { createClient } from "@supabase/supabase-js";
import { decryptCredential } from "../../../lib/credentials";

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";
const PHONE_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;

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
};

type VkMessage = { id?: number; date?: number; out?: number; text?: string };

async function vkHistory(token: string, groupId: string, peerId: number) {
  const body = new URLSearchParams({
    access_token: token,
    v: VK_VERSION,
    group_id: groupId,
    peer_id: String(peerId),
    count: "8",
    offset: "0",
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
    .replace(PHONE_RE, "[ТЕЛЕФОН]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[ССЫЛКА]")
    .replace(/\b(?:id|club)\d+\b/gi, "[VK_ID]");
}

function purchaseOf(dialog: StoredDialog) {
  return dialog.purchase ?? (Boolean(dialog.goalReached) && /(покуп|оплат|билет|приобр)/i.test(`${dialog.goal || ""} ${dialog.issue || ""}`));
}

export async function GET(request: Request) {
  const authToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const requestUrl = new URL(request.url);
  const communityId = requestUrl.searchParams.get("communityId");
  const adId = requestUrl.searchParams.get("adId");
  if (!authToken || !supabaseUrl || !key || !communityId || !adId) {
    return Response.json({ error: "Требуется вход" }, { status: 401 });
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
  if (!data?.credential_ciphertext) return Response.json({ error: "Сообщество VK не подключено" }, { status: 404 });

  const analysis = data.latest_analysis as { dialogs?: StoredDialog[] } | null;
  const matched = (analysis?.dialogs || []).filter((dialog) => String(dialog.adId || "") === adId && dialog.peerId);
  const sorted = [...matched].sort((a, b) =>
    Number(purchaseOf(b)) - Number(purchaseOf(a)) ||
    Number(Boolean(b.metrics?.hasPhone)) - Number(Boolean(a.metrics?.hasPhone)) ||
    Number(b.score || 0) - Number(a.score || 0)
  );
  const selected = sorted.slice(0, 8);
  if (!selected.length) return Response.json({ dialogs: [], total: matched.length });

  try {
    const vkToken = await decryptCredential(data.credential_ciphertext);
    const rows = await Promise.all(selected.map(async (dialog) => {
      const history = await vkHistory(vkToken, communityId, Number(dialog.peerId)).catch(() => []);
      const messages = [...history]
        .sort((a, b) => Number(a.date || 0) - Number(b.date || 0))
        .slice(-6)
        .map((message) => ({
          role: message.out ? "Менеджер" as const : "Клиент" as const,
          text: sanitize(message.text || "[вложение]"),
          date: message.date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(message.date * 1000)) : "",
        }));
      return {
        peerId: Number(dialog.peerId),
        status: dialog.status || "Не определён",
        score: Number(dialog.score || 0),
        issue: dialog.issue || "",
        goal: dialog.goal || "",
        purchase: purchaseOf(dialog),
        phone: Boolean(dialog.metrics?.hasPhone),
        messages,
      };
    }));
    return Response.json({ dialogs: rows, total: matched.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить диалоги" }, { status: 500 });
  }
}
