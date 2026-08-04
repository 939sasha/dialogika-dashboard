const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";

type VkError = { error_code?: number; error_msg?: string };

async function vkMethod(method: string, token: string, params: Record<string, string>) {
  const body = new URLSearchParams({ ...params, access_token: token, v: VK_VERSION });
  const response = await fetch(`${VK_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("ВКонтакте временно не отвечает");
  const payload = await response.json() as { response?: unknown; error?: VkError };
  if (payload.error) {
    const message = payload.error.error_code === 15
      ? "У токена нет доступа к сообщениям сообщества"
      : payload.error.error_msg || "Ошибка API ВКонтакте";
    throw new Error(message);
  }
  return payload.response;
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json() as { token?: string };
    if (!token?.trim() || token.length > 512) {
      return Response.json({ error: "Введите корректный токен сообщества" }, { status: 400 });
    }

    const permissions = await vkMethod("groups.getTokenPermissions", token.trim(), {}) as {
      group_id?: number;
      permissions?: Array<{ name?: string }>;
    };
    if (!permissions?.permissions?.some((permission) => permission.name === "messages")) {
      throw new Error("У ключа не включено право «Сообщения сообщества»");
    }
    // Some valid community tokens omit group_id here. For those tokens,
    // groups.getById without group_ids returns the owning community.
    const groupsResponse = await vkMethod("groups.getById", token.trim(), {
      ...(permissions.group_id ? { group_ids: String(permissions.group_id) } : {}),
      fields: "photo_50",
    });
    const groups = Array.isArray(groupsResponse)
      ? groupsResponse
      : (groupsResponse as { groups?: unknown[] } | undefined)?.groups;
    const group = groups?.[0] as { id?: number; name?: string; photo_50?: string } | undefined;
    if (!group?.id) throw new Error("Не удалось определить сообщество по токену");

    await vkMethod("messages.getConversations", token.trim(), {
      count: "1",
      filter: "all",
      group_id: String(group.id),
    });

    return Response.json({
      community: {
        id: group.id,
        name: group.name || `Сообщество ${group.id}`,
        photo: group.photo_50 || null,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось проверить подключение" },
      { status: 400 },
    );
  }
}
