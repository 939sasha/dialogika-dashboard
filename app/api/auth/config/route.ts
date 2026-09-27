import { publicSupabaseConfig } from "../../../lib/supabaseConfig";

export async function GET() {
  const { url, publishableKey } = publicSupabaseConfig();
  return Response.json({ url, publishableKey }, { headers: { "cache-control": "no-store" } });
}
