import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST } from "./route.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("не загружает историю и не вызывает ИИ для неизменившегося диалога", async () => {
  const now = Math.floor(Date.now() / 1000);
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/messages.getConversations")) {
      return Response.json({
        response: {
          count: 1,
          items: [{
            conversation: { peer: { id: 101 } },
            last_message: { id: 55, date: now, from_id: 101, peer_id: 101, out: 0, text: "Здравствуйте" },
          }],
        },
      });
    }
    throw new Error("Unexpected request: " + url);
  };

  const response = await POST(new Request("https://dashboard.test/api/vk/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "vk-token",
      groupId: 109534321,
      days: 30,
      offset: 0,
      knownRevisions: { "101": "55:" + now },
    }),
  }));

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.unchangedPeerIds, [101]);
  assert.equal(data.pageDialogs, 1);
  assert.equal(data.changedDialogs, 0);
  assert.deepEqual(data.dialogs, []);
  assert.equal(data.ai.analyzedCount, 0);
  assert.equal(calls.length, 1);
});
