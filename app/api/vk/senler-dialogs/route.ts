import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";
const PHONE_RE = /(?:\+?7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2}/g;

async function authorizedCommunity(request: Request, communityId: string) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || !/^\d+$/.test(communityId)) throw new Error("Требуется вход");
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await client.auth.getUser(bearer);
  if (!user) throw new Error("Требуется вход");
  const { data: connection, error } = await client.from("dialogika_connections").select("id")
    .eq("user_id", user.id).eq("kind", "vk").eq("external_id", communityId).maybeSingle();
  if (error || !connection) throw new Error("Сообщество не подключено");
  const { data: token, error: credentialError } = await client.rpc("dialogika_get_credential", {
    p_kind: "vk", p_external_id: communityId,
  });
  if (credentialError || typeof token !== "string" || !token) throw new Error("Токен сообщества недоступен");
  return token;
}

async function vkMethod(method: string, token: string, groupId: string, params: Record<string, string>) {
  const response = await fetch(`${VK_API}/${method}`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, group_id: groupId, access_token: token, v: VK_VERSION }),
    signal: AbortSignal.timeout(15_000) });
  const payload = await response.json() as { response?: unknown; error?: { error_msg?: string } };
  if (!response.ok || payload.error || !payload.response) throw new Error(payload.error?.error_msg || `VK API ${method} недоступен`);
  return payload.response;
}

function sanitize(text: string) {
  return (text || "[вложение]").replace(PHONE_RE, "[ТЕЛЕФОН]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[ССЫЛКА]")
    .replace(/\b(?:id|club)\d+\b/gi, "[VK_ID]");
}

export async function POST(request: Request) {
  const { communityId, peerIds } = await request.json().catch(() => ({})) as { communityId?: string; peerIds?: number[] };
  if (!communityId || !Array.isArray(peerIds) || peerIds.length > 500 ||
      peerIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return Response.json({ error: "Некорректные параметры поиска переписок" }, { status: 400 });
  }
  try {
    const token = await authorizedCommunity(request, communityId);
    const ids = [...new Set(peerIds)];
    const matched = new Set<number>();
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const data = await vkMethod("messages.getConversationsById", token, communityId,
        { peer_ids: batch.join(",") }) as { items?: Array<{ peer?: { id?: number } }> };
      for (const item of data.items || []) {
        const id = Number(item.peer?.id);
        if (batch.includes(id)) matched.add(id);
      }
    }
    return Response.json({ matchedPeerIds: [...matched] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VK не ответил" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const communityId = url.searchParams.get("communityId") || "";
  const peerId = Number(url.searchParams.get("peerId"));
  if (!Number.isSafeInteger(peerId) || peerId <= 0) return Response.json({ error: "Некорректный ID диалога" }, { status: 400 });
  try {
    const token = await authorizedCommunity(request, communityId);
    const messages: Array<{ role: "Клиент" | "Менеджер"; text: string; date: string }> = [];
    let total = 0;
    for (let offset = 0; offset < 1000; offset += 200) {
      const data = await vkMethod("messages.getHistory", token, communityId,
        { peer_id: String(peerId), count: "200", offset: String(offset) }) as {
        count?: number; items?: Array<{ date?: number; out?: number; text?: string }> };
      total = data.count || 0;
      for (const item of data.items || []) messages.push({ role: item.out ? "Менеджер" : "Клиент",
        text: sanitize(item.text || ""), date: new Date((item.date || 0) * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) });
      if (!data.items?.length || offset + data.items.length >= total) break;
    }
    return Response.json({ messages: messages.reverse(), total, truncated: total > messages.length },
      { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VK не ответил" }, { status: 502 });
  }
}
