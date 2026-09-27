import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { analyzeDialogsWithAi, checkRouterModels } from "./openaiAnalysis.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const dialogs = [1, 2, 3].map((peerId) => ({ peerId, transcript: `КЛИЕНТ: билет ${peerId}`, averageResponse: null, slow: false, unanswered: false }));
const result = (peerId) => ({ peerId, intent: "посещение", goal: "запись", goalReached: false, status: "Риск", objections: [], score: 70, issue: "Нет записи", nuance: "", recommendation: "Предложить дату", betterReply: "", confidence: 80 });
const answer = (ids) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ dialogs: ids.map(result) }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });

test("сохраняет частичный ответ и передаёт следующей модели только пропущенный диалог", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const ids = JSON.parse(body.messages[1].content).dialogs.map((dialog) => dialog.peerId);
    requests.push(ids);
    return answer(requests.length === 1 ? [1, 2] : [3]);
  };
  const analysis = await analyzeDialogsWithAi(dialogs, "test-key");
  assert.deepEqual(requests, [[1, 2, 3], [3]]);
  assert.equal(analysis.analyzedCount, 3);
  assert.equal(analysis.fallbackCount, 0);
  assert.equal(analysis.usage.totalTokens, 300);
});

test("не выдаёт резервный алгоритм за результат нейросети", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 });
  const analysis = await analyzeDialogsWithAi(dialogs, "test-key");
  assert.equal(analysis.analyzedCount, 0);
  assert.equal(analysis.fallbackCount, 3);
  assert.equal(analysis.model, "резервный алгоритм");
  assert.match(analysis.failureReason, /upstream unavailable/);
});

test("сообщает, когда ключ действителен, но маршрутизация моделей запрещена", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Access to model deepseek-v4-flash is disabled. Enable automatic conversion in Routing or switch your balance type." } }), { status: 403 });
  const check = await checkRouterModels("test-key");
  assert.equal(check.ok, false);
  assert.match(check.error, /Routing/);
});
