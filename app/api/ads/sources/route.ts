import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../../lib/supabaseConfig";
import { verifiedSources } from "../../../lib/communityAds";

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
    return Response.json(await verifiedSources(client, user.id, communityId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "VK Ads недоступен" }, { status: 503 });
  }
}
