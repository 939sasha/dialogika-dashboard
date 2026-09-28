import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";
import { EMALIS_ACCOUNT_ID, EMALIS_COMMUNITY_ID, verifiedEmalisSources } from "../../../lib/vkAdsAccount";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const communityId = new URL(request.url).searchParams.get("communityId");
  if (!token || communityId !== EMALIS_COMMUNITY_ID) {
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
    const sources = await verifiedEmalisSources(client);
    return Response.json({ accountId: EMALIS_ACCOUNT_ID, sources });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VK Ads недоступен" }, { status: 503 });
  }
}
