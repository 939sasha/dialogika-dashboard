import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";
import { assignedAccount, verifiedSources } from "../../../lib/communityAds";

const dashboardSyncUrl = "https://vk-ads-dashboard.sashablinnikov939.workers.dev/api/sync/vk-entities";

async function authorizedClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Требуется вход");
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await client.auth.getUser(token);
  if (!user) throw new Error("Требуется вход");
  return { client, token, user };
}

export async function GET(request: Request) {
  const communityId = new URL(request.url).searchParams.get("communityId");
  if (!communityId) {
    return Response.json({ error: "Для этого сообщества кабинет VK Ads не подключён" }, { status: 400 });
  }
  try {
    const { client, user } = await authorizedClient(request);
    return Response.json(await verifiedSources(client, user.id, communityId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "VK Ads недоступен";
    return Response.json({ error: message }, { status: message === "Требуется вход" ? 401 : 503 });
  }
}

export async function POST(request: Request) {
  try {
    const { client, token, user } = await authorizedClient(request);
    const { communityId } = await request.json() as { communityId?: string };
    if (!communityId || !/^\d+$/.test(communityId)) return Response.json({ error: "Укажите сообщество" }, { status: 400 });
    const accountId = await assignedAccount(client, user.id, communityId);
    if (!accountId) return Response.json({ error: "Сначала выберите рекламный кабинет" }, { status: 400 });
    const { data: project, error } = await client.from("projects").select("id")
      .eq("user_id", user.id).eq("connection_type", "api").eq("vk_account_id", accountId).maybeSingle();
    if (error || !project) return Response.json({ error: "Выбранный кабинет не найден" }, { status: 404 });
    const response = await fetch(dashboardSyncUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, maxEntities: 5000 }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json().catch(() => ({})) as { error?: string; counts?: unknown };
    if (!response.ok) return Response.json({ error: result.error || "Не удалось обновить объявления кабинета" }, { status: 502 });
    return Response.json({ ok: true, counts: result.counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VK Ads недоступен";
    return Response.json({ error: message }, { status: message === "Требуется вход" ? 401 : 503 });
  }
}
