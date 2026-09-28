import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../../lib/supabaseConfig";
import { dashboardAccounts } from "../../lib/communityAds";

async function authorizedClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const { url, publishableKey: key } = publicSupabaseConfig();
  if (!token) return null;
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await client.auth.getUser(token);
  return user ? { client, user } : null;
}

export async function GET(request: Request) {
  const auth = await authorizedClient(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });

  const { data, error } = await auth.client.rpc("dialogika_get_connections");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data || []) as Array<{
    kind: "vk" | "router" | "senler" | "vk_ads";
    external_id: string;
    name: string;
    photo: string | null;
    credential: string | null;
    credential_available: boolean;
    latest_analysis: unknown;
  }>;
  const communities = rows.filter((row) => row.kind === "vk").map((row) => ({
    id: Number(row.external_id),
    name: row.name,
    photo: row.photo,
    token: row.credential || "",
    credentialAvailable: Boolean(row.credential_available),
    latestAnalysis: row.latest_analysis,
  }));
  const router = rows.find((row) => row.kind === "router");
  const accounts = await dashboardAccounts(auth.client, auth.user.id);
  const { data: assignments, error: assignmentError } = await auth.client.from("dialogika_connections")
    .select("external_id,ad_account_id").eq("user_id", auth.user.id).eq("kind", "vk");
  if (assignmentError) return Response.json({ error: assignmentError.message }, { status: 500 });
  const senlerConnections = rows.filter((row) => row.kind === "senler").map((row) => ({
    communityId: Number(row.external_id),
    name: row.name,
    photo: row.photo,
    key: row.credential || "",
    credentialAvailable: Boolean(row.credential_available),
  }));
  const credentialRecoveryNeeded =
    communities.some((item) => !item.credentialAvailable) ||
    Boolean(router && !router.credential_available) ||
    senlerConnections.some((item) => !item.credentialAvailable);

  return Response.json({
    communities,
    routerKey: router?.credential || "",
    routerCredentialAvailable: Boolean(router?.credential_available),
    senlerConnections,
    adAccounts: accounts,
    adAssignments: Object.fromEntries((assignments || []).map((item) => [item.external_id, item.ad_account_id])),
    credentialRecoveryNeeded,
  });
}

export async function PUT(request: Request) {
  const auth = await authorizedClient(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });

  const body = await request.json().catch(() => null) as null | {
    kind?: "vk" | "router" | "senler" | "vk_ads";
    externalId?: string;
    name?: string;
    photo?: string | null;
    credential?: string;
    latestAnalysis?: unknown;
    adAccountId?: string | null;
  };
  if (!body?.kind || !body.externalId || (body.kind === "vk_ads" && body.externalId !== "29867480")) {
    return Response.json({ error: "Некорректные данные" }, { status: 400 });
  }

  if (body.adAccountId !== undefined) {
    if (body.kind !== "vk") return Response.json({ error: "Некорректные данные" }, { status: 400 });
    if (body.adAccountId) {
      const accounts = await dashboardAccounts(auth.client, auth.user.id);
      if (!accounts.some((item) => item.accountId === body.adAccountId && item.sourcesAvailable)) {
        return Response.json({ error: "Кабинет не найден или объявления ещё не синхронизированы в дашборде" }, { status: 400 });
      }
    }
    const { data, error } = await auth.client.from("dialogika_connections")
      .update({ ad_account_id: body.adAccountId || null, updated_at: new Date().toISOString() })
      .eq("user_id", auth.user.id).eq("kind", "vk").eq("external_id", body.externalId)
      .select("id").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Сообщество не найдено" }, { status: 404 });
  }

  if (body.credential) {
    const { error } = await auth.client.rpc("dialogika_save_credential", {
      p_kind: body.kind,
      p_external_id: body.externalId,
      p_name: body.name || (body.kind === "router" ? "Router Cheap" : body.kind === "senler" ? "Senler" : body.kind === "vk_ads" ? "VK Ads Эмалис" : "Сообщество VK"),
      p_photo: body.photo || "",
      p_credential: body.credential,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  if (body.latestAnalysis !== undefined) {
    const { error } = await auth.client.from("dialogika_connections")
      .update({ latest_analysis: body.latestAnalysis, updated_at: new Date().toISOString() })
      .eq("user_id", auth.user.id)
      .eq("kind", body.kind)
      .eq("external_id", body.externalId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await authorizedClient(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const externalId = url.searchParams.get("externalId");
  if ((kind !== "vk" && kind !== "router" && kind !== "senler") || !externalId) {
    return Response.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const { error } = await auth.client.rpc("dialogika_delete_connection", {
    p_kind: kind,
    p_external_id: externalId,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
