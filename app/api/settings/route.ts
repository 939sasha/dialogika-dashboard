import { createClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "../../lib/credentials";

type StoredRow = {
  kind: "vk" | "router" | "senler";
  external_id: string;
  name: string;
  photo: string | null;
  credential_ciphertext: string;
  latest_analysis: unknown;
};

async function authorizedClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
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
  const { data, error } = await auth.client.from("dialogika_connections")
    .select("kind,external_id,name,photo,credential_ciphertext,latest_analysis")
    .eq("user_id", auth.user.id).order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  try {
    const rows = (data || []) as StoredRow[];
    const communities = await Promise.all(rows.filter((row) => row.kind === "vk").map(async (row) => ({
      id: Number(row.external_id), name: row.name, photo: row.photo,
      token: await decryptCredential(row.credential_ciphertext), latestAnalysis: row.latest_analysis,
    })));
    const router = rows.find((row) => row.kind === "router");
    const senlerConnections = await Promise.all(rows.filter((row) => row.kind === "senler").map(async (row) => ({
      communityId: Number(row.external_id), name: row.name, photo: row.photo,
      key: await decryptCredential(row.credential_ciphertext),
    })));
    return Response.json({ communities, routerKey: router ? await decryptCredential(router.credential_ciphertext) : "", senlerConnections });
  } catch {
    return Response.json({ error: "Не удалось расшифровать сохранённые подключения" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorizedClient(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    kind?: "vk" | "router" | "senler"; externalId?: string; name?: string; photo?: string | null;
    credential?: string; latestAnalysis?: unknown;
  };
  if (!body?.kind || !body.externalId) return Response.json({ error: "Некорректные данные" }, { status: 400 });
  const values: Record<string, unknown> = {
    user_id: auth.user.id, kind: body.kind, external_id: body.externalId,
    name: body.name || (body.kind === "router" ? "Router Cheap" : body.kind === "senler" ? "Senler" : "Сообщество VK"),
    photo: body.photo || null, updated_at: new Date().toISOString(),
  };
  if (body.credential) values.credential_ciphertext = await encryptCredential(body.credential);
  if (body.latestAnalysis !== undefined) values.latest_analysis = body.latestAnalysis;
  const query = !body.credential && body.latestAnalysis !== undefined
    ? auth.client.from("dialogika_connections").update({ latest_analysis: body.latestAnalysis, updated_at: values.updated_at })
      .eq("user_id", auth.user.id).eq("kind", body.kind).eq("external_id", body.externalId)
    : auth.client.from("dialogika_connections").upsert(values, { onConflict: "user_id,kind,external_id" });
  const { error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await authorizedClient(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const externalId = url.searchParams.get("externalId");
  if ((kind !== "vk" && kind !== "router" && kind !== "senler") || !externalId) return Response.json({ error: "Некорректные данные" }, { status: 400 });
  const { error } = await auth.client.from("dialogika_connections").delete()
    .eq("user_id", auth.user.id).eq("kind", kind).eq("external_id", externalId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
