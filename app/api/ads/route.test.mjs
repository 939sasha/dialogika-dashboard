import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET } from "./route.ts";

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VK_ADS_EMALIS_TOKEN", "VK_ADS_EMALIS_ACCOUNT_ID"].map((key) => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("сопоставляет метку с объявлением, группой и кампанией по точным ID", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable";
  process.env.VK_ADS_EMALIS_TOKEN = "test-vk-token";
  process.env.VK_ADS_EMALIS_ACCOUNT_ID = "29867480";
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "user-1", aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/dialogika_connections") return Response.json({ latest_analysis: { stats: { dialogs: 4, ads: [11, 22, 33, 44].map((id) => ({ adId: String(id), dialogs: 1, leads: 1, targets: 0, lost: 0, scoreSum: 70 })) }, dialogs: [{ adId: "11", purchase: true, metrics: { hasPhone: true } }, { adId: "22", goalReached: true, goal: "Покупка билета", metrics: { hasPhone: false } }] } });
    if (url.pathname === "/api/v2/banners.json") return Response.json({ items: [{ id: 11, name: "Билет", ad_group_id: 22 }] });
    if (url.pathname === "/api/v2/ad_groups.json") return Response.json({ items: [{ id: 22, name: "Москва", ad_plan_id: 33 }] });
    if (url.pathname === "/api/v2/ad_plans.json") return Response.json({ items: [{ id: 33, name: "Посещения" }] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const response = await GET(new Request("https://dashboard.test/api/ads?communityId=109534321", { headers: { authorization: "Bearer user-token" } }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.cabinet, { connected: true, accountId: "29867480" });
  assert.deepEqual(data.ads.map((ad) => ad.matchType || "unmatched"), ["banner", "group", "campaign", "unmatched"]);
  assert.equal(data.ads[0].adName, "Билет");
  assert.equal(data.ads[0].campaignName, "Посещения");
  assert.equal(data.ads[0].purchases, 1);
  assert.equal(data.ads[0].phones, 1);
  assert.equal(data.ads[1].purchases, 1);
  assert.equal(data.ads[1].phones, 0);
  assert.ok(calls.some((url) => url.pathname === "/api/v2/banners.json" && url.searchParams.get("_id__in") === "11,22,33,44"));
});
