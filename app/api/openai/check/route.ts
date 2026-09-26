const ROUTER_CHEAP_BASE_URL = "https://router.cheap/v1";

function normalizeApiKey(value?: string) {
  return (value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export async function POST(request: Request) {
  try {
    const { apiKey } = await request.json() as { apiKey?: string };
    const key = normalizeApiKey(apiKey);
    if (key.length < 10) return Response.json({ error: "Введите API-ключ Router Cheap целиком" }, { status: 400 });
    const response = await fetch(`${ROUTER_CHEAP_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) {
      const providerMessage = payload.error?.message || "Router Cheap отклонил ключ";
      const error = response.status === 401
        ? "Router Cheap не принял ключ. Скопируйте API-ключ из кабинета router.cheap целиком, без слова Bearer. Ключ OpenAI здесь не подойдёт."
        : providerMessage;
      return Response.json({ error }, { status: 400 });
    }
    return Response.json({ ok: true, provider: "router.cheap" });
  } catch {
    return Response.json({ error: "Не удалось проверить подключение Router Cheap" }, { status: 400 });
  }
}
