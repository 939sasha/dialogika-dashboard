import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportDefinition } from "./reportPdf.ts";

test("PDF-отчёт объясняет показатели без неподтверждённого прогноза", () => {
  const definition = buildReportDefinition({
    community: "Эмалис", period: 30, generatedAt: "2026-09-26T12:00:00Z",
    dialogs: 10, leads: 5, contacts: 2, targets: 1, lost: 2,
    averageResponse: 60, responseMeasured: true, goal: "Запись или покупка",
    growth: 108, recoverableLow: 1, recoverableHigh: 2,
    slowResponse: 2, noNextStep: 3, unanswered: 1,
    objections: [], objectionDialogs: 0, dailyNew: [], priority: "speed",
  });
  const content = JSON.stringify(definition.content);
  assert.match(content, /Интерес к посещению/);
  assert.match(content, /Запись или покупка/);
  assert.doesNotMatch(content, /Расчётный сценарий|Как рассчитан прогноз|\+108%/);
});
