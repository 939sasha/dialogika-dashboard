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
    const sources = await verifiedSources(client, user.id, communityId);
    const { data: project, error: projectError } = await client.from("projects").select("id")
      .eq("user_id", user.id).eq("connection_type", "api").eq("vk_account_id", sources.accountId).maybeSingle();
    if (projectError || !project) throw projectError || new Error("Кабинет не найден");
    const { data: ads, error: adsError } = await client.from("ad_entities").select("raw_payload")
      .eq("project_id", project.id).eq("platform", "vk").in("entity_type", ["ad", "banner"]).range(0, 4999);
    if (adsError) throw adsError;
    if ((ads || []).length === 5000) throw new Error("Список объявлений достиг предела загрузки; источники требуется синхронизировать по страницам.");
    const miniAppAds = (ads || []).filter((item) => {
      const payload = item.raw_payload as { urls?: { primary?: { url_object_type?: string } } } | null;
      return payload?.urls?.primary?.url_object_type === "vk_miniapp_page";
    }).length;
    const { data: senler, error: senlerError } = await client.from("dialogika_connections").select("id")
      .eq("user_id", user.id).eq("kind", "senler").eq("external_id", communityId).maybeSingle();
    if (senlerError) throw senlerError;
    return Response.json({ ...sources, miniAppAds, senlerConnected: Boolean(senler) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VK Ads недоступен";
    return Response.json({ error: message }, { status: message === "Требуется вход" ? 401 : 503 });
  }
}

export async function POST(request: Request) {
  try {
    const { client, token, user } = await authorizedClient(request);
    const { communityId, projectId } = await request.json() as { communityId?: string; projectId?: string };
    if (!projectId && (!communityId || !/^\d+$/.test(communityId))) return Response.json({ error: "Укажите сообщество или кабинет" }, { status: 400 });
    const accountId = projectId ? null : await assignedAccount(client, user.id, communityId!);
    if (!projectId && !accountId) return Response.json({ error: "Сначала выберите рекламный кабинет" }, { status: 400 });
    let projects = client.from("projects").select("id, vk_account_id")
      .eq("user_id", user.id).eq("connection_type", "api");
    projects = projectId ? projects.eq("id", projectId) : projects.eq("vk_account_id", accountId!);
    const { data: project, error } = await projects.maybeSingle();
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
    return Response.json({ ok: true, projectId: project.id, accountId: project.vk_account_id, counts: result.counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VK Ads недоступен";
    return Response.json({ error: message }, { status: message === "Требуется вход" ? 401 : 503 });
  }
}
