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

test("не анализирует переписку без рекламного источника", async () => {
  const now = Math.floor(Date.now() / 1000);
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("/messages.getConversations")) {
      return Response.json({ response: { count: 1, items: [{
        conversation: { peer: { id: 101 } },
        last_message: { id: 55, date: now, from_id: 101, peer_id: 101, out: 0, text: "Здравствуйте" },
      }] } });
    }
    if (url.pathname.endsWith("/messages.getHistory")) {
      return Response.json({ response: { count: 1, items: [
        { id: 55, date: now, from_id: 101, peer_id: 101, out: 0, text: "Здравствуйте" },
      ] } });
    }
    throw new Error("Unexpected request: " + url);
  };

  const response = await POST(new Request("https://dashboard.test/api/vk/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "vk-token", openaiKey: "router-key", groupId: 109534321, days: 30 }),
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pageDialogs, 1);
  assert.equal(data.changedDialogs, 0);
  assert.deepEqual(data.dialogs, []);
  assert.equal(data.ai.analyzedCount, 0);
  assert.equal(calls.length, 2);
});

test("включает рекламную рассылку в охват, но не считает её обращением и не вызывает ИИ", async () => {
  const now = Math.floor(Date.now() / 1000);
  const outbound = { id: 77, date: now, from_id: -109534321, peer_id: 101, out: 1,
    text: "Купите билет на экскурсию", ref: "179422256", ref_source: "vk_ads" };
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("/messages.getConversations")) {
      return Response.json({ response: { count: 1, items: [{ conversation: { peer: { id: 101 } }, last_message: outbound }] } });
    }
    if (url.pathname.endsWith("/messages.getHistory")) return Response.json({ response: { count: 1, items: [outbound] } });
    throw new Error("Unexpected request: " + url);
  };
  const response = await POST(new Request("https://dashboard.test/api/vk/analyze", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "vk-token", openaiKey: "router-key", groupId: 109534321, days: 30 }),
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.changedDialogs, 1);
  assert.equal(data.ai.analyzedCount, 0);
  assert.equal(data.stats.dialogs, 1);
  assert.equal(data.stats.leads, 0);
  assert.equal(data.dialogs[0].adId, "179422256");
  assert.equal(data.dialogs[0].hasClientMessage, false);
  assert.equal(data.dialogs[0].status, "Нет ответа клиента");
  assert.equal(data.dialogs[0].purchase, false);
  assert.equal(data.dialogs[0].metrics.hasPhone, false);
  assert.equal(calls.length, 2);
});

test("не считает метку размещения ID рекламного объявления", async () => {
  const now = Math.floor(Date.now() / 1000);
  const inbound = { id: 88, date: now, from_id: 101, peer_id: 101, out: 0,
    text: "Здравствуйте", ref: "feed_top", ref_source: "vk_ads" };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages.getConversations")) {
      return Response.json({ response: { count: 1, items: [{ conversation: { peer: { id: 101 } }, last_message: inbound }] } });
    }
    if (url.pathname.endsWith("/messages.getHistory")) return Response.json({ response: { count: 1, items: [inbound] } });
    throw new Error("Unexpected request: " + url);
  };
  const response = await POST(new Request("https://dashboard.test/api/vk/analyze", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "vk-token", openaiKey: "router-key", groupId: 109534321, days: 30 }),
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.changedDialogs, 0);
  assert.deepEqual(data.dialogs, []);
});
