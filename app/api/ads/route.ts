import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../lib/supabaseConfig";
import { verifiedSources } from "../../lib/communityAds";

type AdStat = {
  adId: string; dialogs: number; replies?: number; leads: number; targets: number;
  purchases?: number | null; phones?: number | null; lost: number; scoreSum: number;
};
type AnalysisDialog = {
  adId?: string | null; purchase?: boolean; goalReached?: boolean; goal?: string;
  issue?: string; metrics?: { hasPhone?: boolean };
};

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const communityId = new URL(request.url).searchParams.get("communityId");
  if (!token || !communityId) {
    return Response.json({ error: "Для этого сообщества кабинет VK Ads не подключён" }, { status: 400 });
  }
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await client.auth.getUser(token);
  if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });

  try {
    const { sources, accountId, accountName, source: sourceType } = await verifiedSources(client, user.id, communityId);
    const byId = new Map(sources.map((source) => [source.adId, source]));
    const { data, error } = await client.from("dialogika_connections")
      .select("latest_analysis").eq("user_id", user.id).eq("kind", "vk")
      .eq("external_id", communityId).maybeSingle();
    if (error) throw error;
    const analysis = data?.latest_analysis as { stats?: { ads?: AdStat[] }; dialogs?: AnalysisDialog[] } | null;
    const evidence = new Map<string, { purchases: number; phones: number }>();
    for (const dialog of analysis?.dialogs || []) {
      if (!dialog.adId || !byId.has(dialog.adId)) continue;
      const row = evidence.get(dialog.adId) || { purchases: 0, phones: 0 };
      const purchase = dialog.purchase ?? (Boolean(dialog.goalReached) && /(покуп|оплат|билет|приобр)/i.test(`${dialog.goal || ""} ${dialog.issue || ""}`));
      row.purchases += Number(purchase);
      row.phones += Number(Boolean(dialog.metrics?.hasPhone));
      evidence.set(dialog.adId, row);
    }
    const storedAds = Array.isArray(analysis?.stats?.ads) ? analysis.stats.ads : [];
    const ads = storedAds.filter((ad) => byId.has(ad.adId)).map((ad) => {
      const source = byId.get(ad.adId)!;
      const fallback = evidence.get(ad.adId);
      return {
        ...ad, ...source, matched: true, lookupUnavailable: false,
        purchases: ad.purchases ?? fallback?.purchases ?? null,
        phones: ad.phones ?? fallback?.phones ?? null,
      };
    });
    return Response.json({
      ads,
      dialogs: ads.reduce((sum, ad) => sum + ad.dialogs, 0),
      excludedSources: storedAds.length - ads.length,
      cabinet: { connected: true, accountId, accountName, source: sourceType, cachedMatches: ads.length },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VK Ads недоступен" }, { status: 503 });
  }
}
