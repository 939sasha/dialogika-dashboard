import type { SupabaseClient } from "@supabase/supabase-js";

export const EMALIS_ACCOUNT_ID = "29867480";
export const EMALIS_COMMUNITY_ID = "109534321";

type Entity = { id?: number | string; name?: string; ad_group_id?: number | string; ad_plan_id?: number | string };
export type VerifiedSource = {
  adId: string;
  matchType: "banner" | "group" | "campaign";
  adName?: string;
  groupId?: string;
  groupName?: string;
  campaignId?: string;
  campaignName?: string;
};

async function listEntities(path: string, fields: string, token: string): Promise<Entity[]> {
  const result: Entity[] = [];
  for (let offset = 0; offset < 5000; offset += 250) {
    const query = new URLSearchParams({
      limit: "250", offset: String(offset), fields, _user_id: EMALIS_ACCOUNT_ID,
    });
    const response = await fetch(`https://ads.vk.com/api/v2/${path}.json?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`VK Ads ${path}: HTTP ${response.status}`);
    const payload = await response.json() as { items?: Entity[]; count?: number };
    if (!Array.isArray(payload.items)) throw new Error(`VK Ads ${path}: некорректный ответ`);
    result.push(...payload.items);
    if (payload.items.length < 250 || result.length >= Number(payload.count || 0)) return result;
  }
  throw new Error(`VK Ads ${path}: список превышает безопасный предел`);
}

export async function verifiedEmalisSources(client: SupabaseClient): Promise<VerifiedSource[]> {
  const { data: credential, error } = await client.rpc("dialogika_get_credential", {
    p_kind: "vk_ads", p_external_id: EMALIS_ACCOUNT_ID,
  });
  if (error || typeof credential !== "string" || !credential) {
    throw new Error("Кабинет VK Ads «Эмалис» не подключён");
  }
  const [plans, groups, banners] = await Promise.all([
    listEntities("ad_plans", "id,name,status", credential),
    listEntities("ad_groups", "id,name,status,ad_plan_id", credential),
    listEntities("banners", "id,name,status,ad_group_id", credential),
  ]);
  const plansById = new Map(plans.map((item) => [String(item.id), item]));
  const validGroups = groups.filter((item) => plansById.has(String(item.ad_plan_id || "")));
  const groupsById = new Map(validGroups.map((item) => [String(item.id), item]));
  const sources: VerifiedSource[] = [];
  for (const plan of plans) {
    if (!plan.id) continue;
    sources.push({ adId: String(plan.id), matchType: "campaign", campaignId: String(plan.id), campaignName: plan.name });
  }
  for (const group of validGroups) {
    if (!group.id) continue;
    const plan = plansById.get(String(group.ad_plan_id));
    sources.push({ adId: String(group.id), matchType: "group", groupId: String(group.id), groupName: group.name,
      campaignId: String(plan?.id), campaignName: plan?.name });
  }
  for (const banner of banners) {
    if (!banner.id) continue;
    const group = groupsById.get(String(banner.ad_group_id || ""));
    if (!group) continue;
    const plan = plansById.get(String(group.ad_plan_id));
    sources.push({ adId: String(banner.id), matchType: "banner", adName: banner.name,
      groupId: String(group.id), groupName: group.name,
      campaignId: String(plan?.id), campaignName: plan?.name });
  }
  if (!sources.length) throw new Error("VK Ads не вернул источники кабинета «Эмалис»");
  return sources;
}
