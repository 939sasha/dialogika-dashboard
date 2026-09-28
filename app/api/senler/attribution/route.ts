import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";
import { assignedAccount } from "../../../lib/communityAds";

const dashboardUrl = "https://vk-ads-dashboard.sashablinnikov939.workers.dev/api/dialogika/senler-attribution";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const { communityId, days } = await request.json().catch(() => ({})) as { communityId?: string; days?: number };
  if (!communityId || !/^\d+$/.test(communityId) || ![30, 60, 90].includes(Number(days))) {
    return Response.json({ error: "Некорректные параметры сверки Senler" }, { status: 400 });
  }
  try {
    const { url, publishableKey } = publicSupabaseConfig();
    const client = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user } } = await client.auth.getUser(token);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const accountId = await assignedAccount(client, user.id, communityId);
    if (!accountId) return Response.json({ error: "Рекламный кабинет не выбран" }, { status: 400 });
    const { data: project, error } = await client.from("projects").select("id,senler_external_id")
      .eq("user_id", user.id).eq("connection_type", "api").eq("vk_account_id", accountId).maybeSingle();
    if (error || !project) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
    if (String(project.senler_external_id || "") !== communityId) {
      return Response.json({ error: "Senler этого кабинета относится к другому сообществу" }, { status: 409 });
    }
    const response = await fetch(dashboardUrl, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, communityId, days }), cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return Response.json({ error: result.error || "Senler не вернул подписки" }, { status: 502 });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Senler недоступен" }, { status: 502 });
  }
}
