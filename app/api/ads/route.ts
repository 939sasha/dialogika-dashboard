import { createClient } from "@supabase/supabase-js";

type AdStat = { adId: string; dialogs: number; leads: number; targets: number; lost: number; scoreSum: number; matched?: boolean; lookupUnavailable?: boolean; lookupReason?: string; matchType?: "banner" | "group" | "campaign"; adName?: string; groupId?: string; groupName?: string; campaignId?: string; campaignName?: string };
type VkEntity = { id?: number | string; name?: string; campaign_id?: number | string; ad_group_id?: number | string; ad_plan_id?: number | string };

const EMALIS_COMMUNITY_ID = "109534321";
const VK_API_BASE = "https://ads.vk.com/api/v2";

async function vkList(path: string, fields: string, token: string, ids: string[]) {
  const rows: VkEntity[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const query = new URLSearchParams({ limit: "250", offset: "0", fields, _id__in: chunk.join(",") });
    const requestPage = async (scoped: boolean) => {
      if (scoped) query.set("_user_id", process.env.VK_ADS_EMALIS_ACCOUNT_ID || "29867480");
      else query.delete("_user_id");
      const response = await fetch(`${VK_API_BASE}/${path}.json?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`VK Ads ${path}: HTTP ${response.status}`);
      const payload = await response.json() as { items?: VkEntity[] } | VkEntity[];
      return Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    };
    const scoped = await requestPage(true).catch((error) => {
      if (error instanceof Error && /HTTP (400|401|403)/.test(error.message)) return [];
      throw error;
    });
    const page = scoped.length ? scoped : await requestPage(false);
    const expected = new Set(chunk);
    rows.push(...page.filter((item) => expected.has(String(item.id))));
  }
  return rows;
}

async function enrichWithVkAds(ads: AdStat[], communityId: string) {
  const vkToken = process.env.VK_ADS_EMALIS_TOKEN;
  if (!ads.length) return ads;
  if (!vkToken || communityId !== EMALIS_COMMUNITY_ID) return ads.map((ad) => ({
    ...ad, matched: false, lookupUnavailable: true,
    lookupReason: communityId !== EMALIS_COMMUNITY_ID ? "Для этого сообщества рекламный кабинет ещё не подключён" : "Ключ кабинета VK Ads не настроен на сервере",
  }));
  try {
    const sourceIds = [...new Set(ads.map((ad) => ad.adId).filter((id) => /^\d+$/.test(id)))];
    if (!sourceIds.length) return ads.map((ad) => ({ ...ad, matched: false }));
    const [banners, groups, plans] = await Promise.all([
      vkList("banners", "id,name,status,ad_group_id", vkToken, sourceIds),
      vkList("ad_groups", "id,name,status,ad_plan_id", vkToken, sourceIds),
      vkList("ad_plans", "id,name,status", vkToken, sourceIds),
    ]);
    const parentGroupIds = [...new Set(banners.map((banner) => String(banner.ad_group_id || "")).filter(Boolean))];
    const parentGroups = parentGroupIds.length ? await vkList("ad_groups", "id,name,status,ad_plan_id", vkToken, parentGroupIds) : [];
    const allGroups = [...new Map([...groups, ...parentGroups].map((item) => [String(item.id), item])).values()];
    const parentPlanIds = [...new Set(allGroups.map((group) => String(group.ad_plan_id || "")).filter(Boolean))];
    const parentPlans = parentPlanIds.length ? await vkList("ad_plans", "id,name,status", vkToken, parentPlanIds) : [];
    const bannerById = new Map(banners.map((item) => [String(item.id), item]));
    const groupById = new Map(allGroups.map((item) => [String(item.id), item]));
    const planById = new Map([...plans, ...parentPlans].map((item) => [String(item.id), item]));
    return ads.map((ad) => {
      const banner = bannerById.get(ad.adId);
      const directGroup = groupById.get(ad.adId);
      const directPlan = planById.get(ad.adId);
      if (!banner && !directGroup && !directPlan) return { ...ad, matched: false };
      const groupId = banner ? String(banner.ad_group_id || "") : directGroup ? ad.adId : "";
      const group = groupById.get(groupId);
      const campaignId = directPlan ? ad.adId : String(group?.ad_plan_id || "");
      const plan = planById.get(campaignId);
      return {
        ...ad,
        matched: true,
        matchType: banner ? "banner" as const : directGroup ? "group" as const : "campaign" as const,
        adName: banner?.name || undefined,
        groupId: groupId || undefined,
        groupName: group?.name,
        campaignId: campaignId || undefined,
        campaignName: plan?.name,
      };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "VK Ads не ответил";
    return ads.map((ad) => ({ ...ad, matched: false, lookupUnavailable: true, lookupReason: reason }));
  }
}

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const communityId = new URL(request.url).searchParams.get("communityId");
  if (!token || !url || !key || !communityId) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await client.auth.getUser(token);
  if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const { data, error } = await client.from("dialogika_connections")
    .select("latest_analysis")
    .eq("user_id", user.id).eq("kind", "vk").eq("external_id", communityId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const analysis = data?.latest_analysis as { stats?: { dialogs?: number; ads?: AdStat[] } } | null;
  const ads = Array.isArray(analysis?.stats?.ads) ? analysis.stats.ads : [];
  return Response.json({
    ads: await enrichWithVkAds(ads, communityId),
    dialogs: analysis?.stats?.dialogs || 0,
    cabinet: {
      connected: communityId === EMALIS_COMMUNITY_ID && Boolean(process.env.VK_ADS_EMALIS_TOKEN),
      accountId: communityId === EMALIS_COMMUNITY_ID ? process.env.VK_ADS_EMALIS_ACCOUNT_ID || "29867480" : null,
    },
  });
}
