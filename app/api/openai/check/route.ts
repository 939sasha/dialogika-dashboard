export async function POST(request: Request) {
  try {
    const { apiKey } = await request.json() as { apiKey?: string };
    if (!apiKey?.startsWith("sk-")) return Response.json({ error: "Введите корректный API-ключ OpenAI" }, { status: 400 });
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) return Response.json({ error: payload.error?.message || "OpenAI отклонил ключ" }, { status: 400 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось проверить подключение OpenAI" }, { status: 400 });
  }
}
