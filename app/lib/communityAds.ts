import type { SupabaseClient } from "@supabase/supabase-js";
import { EMALIS_ACCOUNT_ID, verifiedEmalisSources, type VerifiedSource } from "./vkAdsAccount";

export async function dashboardAccounts(client: SupabaseClient, userId: string) {
  const { data: projects, error } = await client.from("projects")
    .select("id,name,vk_account_id,connection_type")
    .eq("user_id", userId).eq("connection_type", "api").not("vk_account_id", "is", null);
  if (error) throw error;
  const available = new Set<string>();
  if (projects?.length) {
    for (let offset = 0; offset < 5000; offset += 1000) {
      const { data: entities, error: entityError } = await client.from("ad_entities")
        .select("project_id").in("project_id", projects.map((item) => item.id))
        .eq("platform", "vk").in("entity_type", ["ad", "ad_group"])
        .range(offset, offset + 999);
      if (entityError) throw entityError;
      for (const item of entities || []) available.add(item.project_id);
      if ((entities || []).length < 1000) break;
    }
  }
  return (projects || []).map((item) => ({
    projectId: item.id, accountId: String(item.vk_account_id), name: item.name,
    sourcesAvailable: available.has(item.id) || String(item.vk_account_id) === EMALIS_ACCOUNT_ID,
  }));
}

export async function assignedAccount(client: SupabaseClient, userId: string, communityId: string) {
  const { data, error } = await client.from("dialogika_connections")
    .select("ad_account_id").eq("user_id", userId).eq("kind", "vk")
    .eq("external_id", communityId).maybeSingle();
  if (error) throw error;
  return data?.ad_account_id ? String(data.ad_account_id) : null;
}

export async function verifiedSources(client: SupabaseClient, userId: string, communityId: string) {
  const accountId = await assignedAccount(client, userId, communityId);
  if (!accountId) throw new Error("Выберите рекламный кабинет для этого сообщества в настройках");
  const accounts = await dashboardAccounts(client, userId);
  const project = accounts.find((item) => item.accountId === accountId);
  if (!project) throw new Error("Выбранный кабинет отсутствует в вашем дашборде");
  if (accountId === EMALIS_ACCOUNT_ID) {
    return { accountId, accountName: project.name, sources: await verifiedEmalisSources(client), source: "api" as const };
  }
  const { data, error } = await client.from("ad_entities")
    .select("external_id,entity_type,name,parent_external_id")
    .eq("project_id", project.projectId).eq("platform", "vk").range(0, 4999);
  if (error) throw error;
  const typeOf = (type: string) => type === "campaign" || type === "ad_plan" ? "campaign" :
    type === "group" || type === "ad_group" ? "group" :
    type === "ad" || type === "banner" ? "banner" : null;
  const sources: VerifiedSource[] = (data || []).flatMap((item) => {
    const matchType = typeOf(item.entity_type);
    if (!matchType || !/^\d+$/.test(String(item.external_id))) return [];
    return [{ adId: String(item.external_id), matchType, ...(matchType === "banner" ? { adName: item.name } :
      matchType === "group" ? { groupId: String(item.external_id), groupName: item.name } :
      { campaignId: String(item.external_id), campaignName: item.name }) }];
  });
  if (!sources.length) throw new Error("Для этого кабинета в дашборде ещё нет синхронизированных объявлений");
  return { accountId, accountName: project.name, sources, source: "dashboard" as const };
}
