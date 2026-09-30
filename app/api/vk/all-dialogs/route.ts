import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";

const interest = /(цен|стоим|сколько|дат[уые]|когда|адрес|где|запис|билет|экскурс|выстав|мастер.?класс|расписан|места|наличи|купить|заказ|проект|дом|площад|размер|комплект|доставк|срок|консультац|расч[её]т|смет)\w*/i;
type Message = { date?: number; out?: number; text?: string };
type Conversation = { conversation?: { peer?: { id?: number } }; last_message?: { date?: number } };

async function vk(method: string, token: string, groupId: string, params: Record<string, string>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://api.vk.com/method/${method}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...params, group_id: groupId, access_token: token, v: "5.199" }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = await response.json() as { response?: unknown; error?: { error_code?: number; error_msg?: string } };
      if ((response.status >= 500 || [6, 9].includes(data.error?.error_code || 0)) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1))); continue;
      }
      if (!response.ok || data.error || !data.response) throw new Error(data.error?.error_msg || `${method}: VK недоступен`);
      return data.response;
    } catch (error) {
      if (attempt === 2 || !(error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  throw new Error("VK временно недоступен");
}

async function credential(request: Request, communityId: string) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) throw new Error("Требуется вход");
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await client.auth.getUser(bearer);
  if (!user) throw new Error("Требуется вход");
  const { data: connection, error } = await client.from("dialogika_connections").select("id").eq("user_id", user.id).eq("kind", "vk").eq("external_id", communityId).maybeSingle();
  if (error || !connection) throw new Error("Сообщество не подключено");
  const { data: token, error: tokenError } = await client.rpc("dialogika_get_credential", { p_kind: "vk", p_external_id: communityId });
  if (tokenError || typeof token !== "string" || !token) throw new Error("Токен сообщества недоступен");
  return token;
}

export async function POST(request: Request) {
  const { communityId, days, offset } = await request.json().catch(() => ({})) as { communityId?: string; days?: number; offset?: number };
  if (!communityId || !/^\d+$/.test(communityId) || ![30, 60, 90].includes(days || 0) || !Number.isSafeInteger(offset) || (offset || 0) < 0) {
    return Response.json({ error: "Некорректные параметры" }, { status: 400 });
  }
  try {
    const token = await credential(request, communityId);
    const cutoff = Math.floor(Date.now() / 1000) - (days as number) * 86400;
    const page = await vk("messages.getConversations", token, communityId, { count: "10", offset: String(offset), filter: "all" }) as { count?: number; items?: Conversation[] };
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.count)) throw new Error("VK вернул неполную страницу диалогов");
    const active = page.items.filter((item) => (item.last_message?.date || 0) >= cutoff);
    const rows = await Promise.all(active.map(async (item) => {
      const peerId = item.conversation?.peer?.id;
      if (!Number.isSafeInteger(peerId) || !peerId || peerId <= 0) throw new Error("VK вернул диалог без ID");
      const messages: Message[] = [];
      let historyOffset = 0;
      while (true) {
        const history = await vk("messages.getHistory", token, communityId, { peer_id: String(peerId), count: "200", offset: String(historyOffset) }) as { count?: number; items?: Message[] };
        if (!Array.isArray(history.items) || !Number.isSafeInteger(history.count)) throw new Error(`VK вернул неполную историю диалога ${peerId}`);
        messages.push(...history.items.filter((message) => (message.date || 0) >= cutoff));
        historyOffset += history.items.length;
        if (!history.items.length || historyOffset >= (history.count || 0) || (history.items.at(-1)?.date || 0) < cutoff) break;
      }
      const incoming = messages.filter((message) => !message.out);
      return { peerId, messages: messages.length, clientReplied: incoming.length > 0,
        interestSignal: incoming.some((message) => interest.test(message.text || "")), lastDate: item.last_message?.date || 0 };
    }));
    return Response.json({ rows, totalAvailable: page.count, nextOffset: (offset as number) + page.items.length,
      done: page.items.length === 0 || (offset as number) + page.items.length >= (page.count || 0) || active.length < page.items.length },
    { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить диалоги" }, { status: 502 });
  }
}
