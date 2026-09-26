type SenlerGroup = {
  group_id?: string;
  name?: string;
  type_id?: string;
  type_name?: string;
  photo?: string;
  external_id?: string;
  workspace_id?: string;
};

type SenlerResponse = {
  success?: boolean;
  item?: SenlerGroup;
  error?: string;
  error_message?: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { accessToken?: string; groupId?: string; vkGroupId?: string } | null;
  const accessToken = body?.accessToken?.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
  const groupId = body?.groupId?.trim();
  const vkGroupId = body?.vkGroupId?.trim();
  if (!accessToken || !groupId || !vkGroupId) return Response.json({ error: "Укажите ключ и ID канала Senler, затем выберите сообщество VK." }, { status: 400 });

  try {
    const response = await fetch("https://senler.ru/api/groups/get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group_id: groupId, access_token: accessToken, v: 2 }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let result: SenlerResponse;
    try { result = JSON.parse(text) as SenlerResponse; }
    catch { return Response.json({ error: "Senler вернул некорректный ответ. Повторите попытку." }, { status: 502 }); }
    if (!response.ok || !result.success || !result.item) {
      const apiError = result.error_message || result.error || "Ключ Senler не принят.";
      return Response.json({ error: /group not found/i.test(apiError) ? "Канал Senler не найден. Проверьте ID канала Senler — это не ID сообщества VK." : apiError }, { status: 400 });
    }
    if (result.item.external_id && String(result.item.external_id) !== vkGroupId) {
      return Response.json({ error: "Этот ключ Senler относится к другому сообществу VK." }, { status: 400 });
    }
    return Response.json({ ok: true, channel: result.item });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Senler отвечает слишком долго. Повторите попытку."
      : "Не удалось связаться с Senler.";
    return Response.json({ error: message }, { status: 502 });
  }
}
