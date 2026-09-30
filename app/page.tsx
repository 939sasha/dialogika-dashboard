"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import AllDialogs from "./all-dialogs";

type Period = "30" | "60" | "90";
type Community = { id: number; name: string; photo: string | null };
type StoredAnalysis = { stats: LiveStats; dialogs: LiveDialog[]; senlerConversations?: SenlerConversation[]; period: Period; accountId?: string; savedAt?: string; version?: 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 };
type SenlerAttribution = { totalSubscriptions: number; withAdMarker: number; outsideAccount: number; withSenlerTagNoAdId: number; withoutMarker: number; accountAdSubscriptions: number; linkedToDialog: number; vkResultsTotal?: number; vkResultsError?: string | null; pageGroups?: Array<{ subscriptionId: string; adIds: string[]; events: number; vkResults: number; sources: Record<string, number> }>; pageCandidates?: number; pageConversations?: number; recentPageConversations?: number; clientRepliedPageConversations?: number };
type SenlerEvent = { peerId: number | null; adId: string; date: string };
type SenlerPageCandidate = { peerId: number; subscriptionId: string; date: string; source: string };
type SenlerConversation = SenlerPageCandidate & { recent: boolean; clientReplied?: boolean; adId?: string | null };
type Attribution = { recentConversations: number; historiesLoaded: number; withVkMarker: number; withSenlerMarker: number; matchedToAccount: number; taggedOutsideAccount: number; withoutMarker: number };
const emptyAttribution = (): Attribution => ({ recentConversations: 0, historiesLoaded: 0, withVkMarker: 0, withSenlerMarker: 0, matchedToAccount: 0, taggedOutsideAccount: 0, withoutMarker: 0 });
type AnalysisCheckpoint = {
  version: 1; savedAt: number; offset: number; totalAvailable: number | null; dialogs: LiveDialog[];
  reusedPeerIds: number[]; changedPeerIds: number[]; scannedCount: number; preferredModel: string;
  objectionLabels: Record<string, string>; aiAnalyzedCount: number; fallbackCount: number;
  aiFailureReason: string; aiUsage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number };
  attribution?: Attribution;
  senlerRecentPeerIds?: number[];
  senlerClientRepliedPeerIds?: number[];
};
type SavedCommunity = Community & { token: string; credentialAvailable?: boolean; latestAnalysis?: StoredAnalysis | LiveStats | null };
type SavedSenlerConnection = { communityId: number; name: string; photo: string | null; key: string; credentialAvailable?: boolean };
type DashboardAccount = { projectId: string; accountId: string; name: string; sourcesAvailable: boolean; adDetailAvailable: boolean };
type AdCabinet = { connected: boolean; accountId: string | null; source?: "api" | "dashboard" | "dashboard-groups"; cachedMatches?: number };
type DialogMetrics = { hasPhone: boolean; hasInterest: boolean; responseSum: number; responseCount: number; slowResponse: boolean; noNextStep: boolean; unanswered: boolean; firstEverDate: number | null; objectionKeys: string[] };
type EvidenceMessage = { role: "Клиент" | "Менеджер"; text: string; date: string };
type LiveDialog = { peerId: number; adId?: string | null; hasClientMessage?: boolean; score: number; status: string; issue: string; intent?: string; goal?: string; goalReached?: boolean; purchase?: boolean; nuance?: string; recommendation?: string; betterReply?: string; confidence?: number; objections?: string[]; revision?: string; lastMessageId?: number; lastMessageDate?: number; metrics?: DialogMetrics; aiAnalyzed?: boolean; aiModel?: string; evidence?: EvidenceMessage[] };
type AdStat = { adId: string; dialogs: number; subscriptions?: number; vkResults?: number; replies?: number; leads: number; targets: number; purchases?: number | null; phones?: number | null; lost: number; scoreSum: number; matched?: boolean; lookupUnavailable?: boolean; lookupReason?: string; matchType?: "banner" | "group" | "campaign"; adName?: string; groupId?: string; groupName?: string; campaignId?: string; campaignName?: string };
type AdDialogDetail = { peerId: number; status: string; score: number; issue: string; goal?: string; purchase: boolean | null; phone: boolean | null; messages: EvidenceMessage[]; messagesUnavailable?: boolean };
type LiveStats = {
  dialogs: number; replies?: number; leads: number; contacts: number; targets: number; lost: number;
  averageResponse: number; recoverableLow: number; recoverableHigh: number;
  goal: string; growth: number | null; slowResponse: number; noNextStep: number; unanswered: number;
  responseMeasured: boolean;
  objections: Array<{ key: string; label: string; count: number }>;
  objectionDialogs: number;
  dailyNew: Array<{ date: string; count: number }>;
  ads: AdStat[];
  priority: "speed" | "objections" | "balanced";
  ai: { model: string; analyzedCount: number; fallbackCount: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; nuances: string[]; recommendations: string[]; reusedCount?: number; changedCount?: number };
  attribution?: Attribution;
  senler?: SenlerAttribution;
};

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [period, setPeriod] = useState<Period>("30");
  const [tab, setTab] = useState("Обзор");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [token, setToken] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [senlerConnections, setSenlerConnections] = useState<SavedSenlerConnection[]>([]);
  const [adAccounts, setAdAccounts] = useState<DashboardAccount[]>([]);
  const [sourceProfile, setSourceProfile] = useState<{ miniAppAds: number; senlerConnected: boolean; dashboardSenlerConnected: boolean } | null>(null);
  const [adAssignments, setAdAssignments] = useState<Record<string, string | null>>({});
  const [serverAds, setServerAds] = useState<AdStat[]>([]);
  const [serverAdDialogTotal, setServerAdDialogTotal] = useState(0);
  const [adCabinet, setAdCabinet] = useState<AdCabinet | null>(null);
  const [serverAdsStatus, setServerAdsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [serverAdsError, setServerAdsError] = useState("");
  const [community, setCommunity] = useState<Community | null>(null);
  const [connections, setConnections] = useState<SavedCommunity[]>([]);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [liveDialogs, setLiveDialogs] = useState<LiveDialog[]>([]);
  const [senlerConversations, setSenlerConversations] = useState<SenlerConversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active && window.location.hash === "#ads") setTab("Объявления"); });
    fetch("/api/auth/config").then((response) => response.json()).then(async (config: { url?: string; publishableKey?: string }) => {
      if (!active || !config.url || !config.publishableKey) throw new Error("Авторизация не настроена");
      const client = createClient(config.url, config.publishableKey);
      setSupabase(client);
      const { data } = await client.auth.getSession();
      setUser(data.session?.user || null);
      setAccessToken(data.session?.access_token || "");
      setAuthReady(true);
      client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null);
        setAccessToken(session?.access_token || "");
      });
    }).catch(() => { setNotice("Не удалось подключить авторизацию."); setAuthReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/settings", { headers: { authorization: `Bearer ${accessToken}` } });
      const result = await response.json() as { communities?: SavedCommunity[]; routerKey?: string; routerCredentialAvailable?: boolean; senlerConnections?: SavedSenlerConnection[]; adAccounts?: DashboardAccount[]; adAssignments?: Record<string, string | null>; credentialRecoveryNeeded?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить подключения");
      let saved = result.communities || [];
      const local = JSON.parse(localStorage.getItem("dialogika.communities.v1") || "[]") as SavedCommunity[];
      const localRouter = localStorage.getItem("dialogika.routerCheapKey.v1") || "";
      if (!saved.length && local.length) {
        for (const item of local.filter((entry) => entry?.id && entry?.token)) {
          let latestAnalysis = item.latestAnalysis || null;
          try {
            const localAnalysis = localStorage.getItem(`dialogika.analysis.${item.id}.v1`);
            if (localAnalysis) latestAnalysis = JSON.parse(localAnalysis) as LiveStats;
          } catch {}
          item.latestAnalysis = latestAnalysis;
          await saveSetting({ kind: "vk", externalId: String(item.id), name: item.name, photo: item.photo, credential: item.token, latestAnalysis }, accessToken);
          localStorage.removeItem(`dialogika.analysis.${item.id}.v1`);
        }
        saved = local;
      }
      if (!result.routerKey && localRouter) await saveSetting({ kind: "router", externalId: "default", credential: localRouter }, accessToken);
      if (cancelled) return;
      setConnections(saved);
      setOpenaiKey(result.routerKey || localRouter);
      setSenlerConnections(result.senlerConnections || []);
      setAdAccounts(result.adAccounts || []);
      setAdAssignments(result.adAssignments || {});
      if (result.credentialRecoveryNeeded) {
        setNotice("Подключения найдены, но серверный ключ шифрования недоступен. Сохранённые данные и последний анализ восстановлены; ключи VK, Router Cheap и Senler пока нельзя использовать.");
      }
      const activeId = Number(localStorage.getItem("dialogika.activeCommunity.v1"));
      const selected = saved.find((item) => item.id === activeId) || saved[0];
      if (selected) {
        setCommunity({ id: selected.id, name: selected.name, photo: selected.photo });
        setToken(selected.token);
        restoreAnalysis(newerAnalysis(selected.latestAnalysis, cachedAnalysis(selected.id), result.adAssignments?.[String(selected.id)], selected.id));
      }
      localStorage.removeItem("dialogika.communities.v1");
      localStorage.removeItem("dialogika.routerCheapKey.v1");
    })().catch((error) => setNotice(error instanceof Error ? error.message : "Ошибка загрузки подключений"));
    return () => { cancelled = true; };
  }, [accessToken]);
  useEffect(() => {
    if (tab !== "Объявления" || !accessToken || !community) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setServerAds([]); setServerAdDialogTotal(0); setAdCabinet(null); setServerAdsStatus("loading"); setServerAdsError(""); } });
    fetch(`/api/ads?communityId=${community.id}`, { headers: { authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не удалось загрузить объявления");
        return result;
      })
      .then((result: { ads?: AdStat[]; dialogs?: number; cabinet?: AdCabinet }) => {
        if (cancelled) return;
        setServerAds(Array.isArray(result.ads) ? result.ads : []);
        setServerAdDialogTotal(Number(result.dialogs) || 0);
        setAdCabinet(result.cabinet || null);
        setServerAdsStatus("ready");
      })
      .catch((error) => { if (!cancelled) { setServerAdsError(error instanceof Error ? error.message : "Не удалось загрузить объявления"); setServerAdsStatus("error"); } });
    return () => { cancelled = true; };
  }, [tab, accessToken, community]);
  useEffect(() => {
    queueMicrotask(() => setSourceProfile(null));
    if (!accessToken || !community || !adAssignments[String(community.id)]) return;
    let cancelled = false;
    fetch(`/api/ads/sources?communityId=${community.id}`, { headers: { authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Источники недоступны");
        return response.json() as Promise<{ miniAppAds?: number; senlerConnected?: boolean; dashboardSenlerConnected?: boolean }>;
      })
      .then((result) => { if (!cancelled) setSourceProfile({ miniAppAds: result.miniAppAds || 0, senlerConnected: Boolean(result.senlerConnected), dashboardSenlerConnected: Boolean(result.dashboardSenlerConnected) }); })
      .catch(() => { if (!cancelled) setSourceProfile(null); });
    return () => { cancelled = true; };
  }, [accessToken, community, adAssignments]);
  const data = liveStats ? {
    dialogs: liveStats.dialogs,
    leads: liveStats.leads,
    contacts: liveStats.contacts,
    measurements: liveStats.targets,
    lost: liveStats.lost,
    response: !liveStats.responseMeasured ? "нет данных" : liveStats.averageResponse < 60
      ? `${liveStats.averageResponse} сек`
      : `${Math.round(liveStats.averageResponse / 60)} мин`,
  } : null;
  const filteredDialogs = useMemo(
    () => liveDialogs.filter((d) => `${d.peerId} ${d.status} ${d.issue}`.toLowerCase().includes(query.toLowerCase())),
    [query, liveDialogs],
  );

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(`Файл «${file.name}» принят. В рабочей версии диалоги будут обезличены перед анализом.`);
    event.target.value = "";
  }

  async function connectCommunity(value: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/vk/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const result = await response.json() as { community?: Community; error?: string };
      if (!response.ok || !result.community) throw new Error(result.error || "Не удалось подключить сообщество");
      setToken(value);
      setCommunity(result.community);
      const savedConnection = { ...result.community, token: value };
      const nextConnections = [...connections.filter((item) => item.id !== result.community!.id), savedConnection];
      setConnections(nextConnections);
      await saveSetting({ kind: "vk", externalId: String(result.community.id), name: result.community.name, photo: result.community.photo, credential: value }, accessToken);
      localStorage.setItem("dialogika.activeCommunity.v1", String(result.community.id));
      setLiveStats(null);
      setLiveDialogs([]);
      setNotice(`Подключено сообщество «${result.community.name}». Оно сохранено в вашем аккаунте и восстановится на любом устройстве.`);
      setTab("Обзор");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка подключения");
    } finally {
      setBusy(false);
    }
  }

  async function connectOpenAI(value: string) {
    setBusy(true);
    setNotice("");
    try {
      const normalizedKey = value.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
      const response = await fetch("/api/openai/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: normalizedKey }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось подключить Router Cheap");
      setOpenaiKey(normalizedKey);
      await saveSetting({ kind: "router", externalId: "default", credential: normalizedKey }, accessToken);
      setNotice("Router Cheap подключён. Ключ зашифрован и сохранён в вашем аккаунте.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка подключения Router Cheap");
    } finally {
      setBusy(false);
    }
  }

  async function connectSenler(value: string, groupId: string) {
    if (!community) { setNotice("Сначала выберите сообщество VK."); return; }
    setBusy(true);
    setNotice("");
    try {
      const normalizedKey = value.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
      const response = await fetch("/api/senler/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: normalizedKey, groupId: groupId.trim(), vkGroupId: String(community.id) }),
      });
      const result = await response.json() as { ok?: boolean; channel?: { name?: string; photo?: string }; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось подключить Senler");
      const connection = { communityId: community.id, name: result.channel?.name || community.name, photo: result.channel?.photo || community.photo, key: normalizedKey };
      await saveSetting({ kind: "senler", externalId: String(community.id), name: connection.name, photo: connection.photo, credential: JSON.stringify({ accessToken: normalizedKey, groupId: groupId.trim() }) }, accessToken);
      setSenlerConnections((current) => [...current.filter((item) => item.communityId !== community.id), connection]);
      setNotice(`Senler подключён к сообществу «${community.name}». Ключ зашифрован и сохранён в вашем аккаунте.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка подключения Senler");
    } finally {
      setBusy(false);
    }
  }

  async function connectVkAds(accountId: string) {
    if (!community) return;
    setBusy(true);
    setNotice("");
    try {
      await saveSetting({ kind: "vk", externalId: String(community.id), adAccountId: accountId || null }, accessToken);
      if (!accountId) {
        setAdAssignments((current) => ({ ...current, [String(community.id)]: null }));
        setLiveStats(null); setLiveDialogs([]);
        setNotice(`Рекламный кабинет отключён от сообщества «${community.name}».`);
        return;
      }
      setAdAssignments((current) => ({ ...current, [String(community.id)]: accountId }));
      const saved = connections.find((item) => item.id === community.id)?.latestAnalysis;
      restoreAnalysis(newerAnalysis(saved, cachedAnalysis(community.id), accountId, community.id));
      const selectedAccount = adAccounts.find((item) => item.accountId === accountId);
      setNotice(`Кабинет «${selectedAccount?.name || accountId}» сохранён для сообщества «${community.name}».${selectedAccount?.adDetailAvailable ? "" : " Сейчас доступны ID групп; метки отдельных объявлений появятся после синхронизации."}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось подключить VK Ads");
    } finally {
      setBusy(false);
    }
  }

  function selectCommunity(item: SavedCommunity) {
    setCommunity({ id: item.id, name: item.name, photo: item.photo });
    setToken(item.token);
    restoreAnalysis(newerAnalysis(item.latestAnalysis, cachedAnalysis(item.id), adAssignments[String(item.id)], item.id));
    localStorage.setItem("dialogika.activeCommunity.v1", String(item.id));
    setNotice(`Выбрано сообщество «${item.name}».`);
  }

  function restoreAnalysis(saved: SavedCommunity["latestAnalysis"]) {
    if (!saved) { setLiveStats(null); setLiveDialogs([]); setSenlerConversations([]); return; }
    if ("stats" in saved) {
      setLiveStats(saved.stats);
      setLiveDialogs(saved.dialogs || []);
      setSenlerConversations(saved.senlerConversations || []);
      setPeriod(saved.period || "30");
      return;
    }
    setLiveStats(saved);
    setLiveDialogs([]);
    setSenlerConversations([]);
  }

  const ACCOUNT_ANALYSIS_MAX_CHARS = 1_500_000;
  const LOCAL_ANALYSIS_MAX_CHARS = 4_000_000;

  function fitStoredAnalysis(analysis: StoredAnalysis, maxChars: number): StoredAnalysis {
    const serialized = JSON.stringify(analysis);
    if (serialized.length <= maxChars) return analysis;
    const base: StoredAnalysis = { ...analysis, dialogs: [] };
    let used = JSON.stringify(base).length;
    const dialogs: LiveDialog[] = [];
    for (const dialog of analysis.dialogs) {
      const size = JSON.stringify(dialog).length + 1;
      if (used + size > maxChars) break;
      dialogs.push(dialog);
      used += size;
    }
    return { ...analysis, dialogs };
  }

  function cacheAnalysis(communityId: number, analysis: StoredAnalysis) {
    try {
      const cached = fitStoredAnalysis(analysis, LOCAL_ANALYSIS_MAX_CHARS);
      localStorage.setItem(`dialogika.analysis.${communityId}.v2`, JSON.stringify(cached));
    } catch {
      // Local cache is best-effort only. The account copy is still saved below.
    }
  }

  function cachedAnalysis(communityId: number) {
    try {
      const raw = localStorage.getItem(`dialogika.analysis.${communityId}.v2`);
      return raw ? JSON.parse(raw) as StoredAnalysis : null;
    } catch {
      return null;
    }
  }

  async function syncMissingAdIds() {
    const missing = adAccounts.filter((item) => !item.adDetailAvailable);
    if (!missing.length || !accessToken) return;
    setSyncingAccounts(true);
    const failures: string[] = [];
    let completed = 0;
    for (const account of missing) {
      setNotice(`Обновляю ID объявлений: ${completed + failures.length + 1} из ${missing.length} · ${account.name}`);
      try {
        const response = await fetch("/api/ads/sources", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ projectId: account.projectId }),
        });
        const result = await response.json() as { error?: string; counts?: { ads?: number } };
        if (!response.ok) throw new Error(result.error || "Синхронизация не удалась");
        if (!result.counts?.ads) throw new Error("В кабинете не найдены отдельные объявления");
        completed += 1;
        setAdAccounts((current) => current.map((item) => item.projectId === account.projectId ? { ...item, adDetailAvailable: true } : item));
      } catch (error) {
        failures.push(`${account.name}: ${error instanceof Error ? error.message : "ошибка"}`);
      }
    }
    setSyncingAccounts(false);
    setNotice(`ID объявлений обновлены в ${completed} из ${missing.length} кабинетов.${failures.length ? ` Не удалось: ${failures.join("; ")}` : ""}`);
  }

  function newerAnalysis(server: SavedCommunity["latestAnalysis"], local: StoredAnalysis | null, accountId?: string | null, communityId?: number) {
    const matches = (analysis: SavedCommunity["latestAnalysis"]) => Boolean(accountId && analysis &&
      ("stats" in analysis ? (analysis.accountId || (communityId === 109534321 ? "29867480" : "")) === accountId :
        communityId === 109534321 && accountId === "29867480"));
    if (!matches(server)) server = null;
    if (!matches(local)) local = null;
    if (!local) return server;
    if (!server || !("stats" in server)) return local;
    const serverTime = Date.parse(server.savedAt || "");
    const localTime = Date.parse(local.savedAt || "");
    if (!Number.isFinite(serverTime)) return local;
    if (!Number.isFinite(localTime)) return server;
    return localTime >= serverTime ? local : server;
  }

  async function disconnectCommunity() {
    if (!community) return;
    await deleteSetting("vk", String(community.id), accessToken);
    const nextConnections = connections.filter((item) => item.id !== community.id);
    setConnections(nextConnections);
    const next = nextConnections[0];
    if (next) {
      selectCommunity(next);
    } else {
      setCommunity(null);
      setToken("");
      localStorage.removeItem("dialogika.activeCommunity.v1");
    }
    localStorage.removeItem("dialogika.analysis." + community.id + ".v2");
    setLiveStats(null);
    setLiveDialogs([]);
    setNotice("Сообщество удалено из вашего аккаунта.");
  }

  async function runAnalysis() {
    if (!community) {
      setTab("Настройки");
      setNotice("Сначала подключите сообщество ВКонтакте.");
      return;
    }
    if (!token) {
      setTab("Настройки");
      setNotice("Сообщество найдено, но его токен сейчас недоступен для расшифровки. Подключение не удалено.");
      return;
    }
    if (!openaiKey) {
      setTab("Настройки");
      setNotice("Подключите Router Cheap в разделе «Настройки», затем запустите анализ ещё раз.");
      return;
    }

    let verifiedAdIds: Set<string> | null = null;
    let dashboardSenlerConnected = false;
    if (adAssignments[String(community.id)]) {
      try {
        let response = await fetch(`/api/ads/sources?communityId=${community.id}`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        let result = await response.json() as { accountId?: string; source?: "api" | "dashboard" | "dashboard-groups"; sources?: Array<{ adId: string }>; dashboardSenlerConnected?: boolean; error?: string };
        if (response.ok && result.accountId === adAssignments[String(community.id)] && result.source === "dashboard-groups") {
          setNotice("Получаем ID объявлений выбранного кабинета…");
          const syncResponse = await fetch("/api/ads/sources", {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({ communityId: String(community.id) }),
          });
          const syncResult = await syncResponse.json() as { error?: string };
          if (!syncResponse.ok) throw new Error(syncResult.error || "Не удалось обновить объявления кабинета");
          response = await fetch(`/api/ads/sources?communityId=${community.id}`, {
            headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store",
          });
          result = await response.json();
        }
        if (!response.ok || result.accountId !== adAssignments[String(community.id)] || !result.sources?.length) {
          throw new Error(result.error || "Не удалось подтвердить источники выбранного кабинета");
        }
        if (result.source === "dashboard-groups") {
          throw new Error("В выбранном кабинете доступны только ID групп, а метки переписок указывают на объявления. Анализ остановлен: нужен действующий API-доступ для синхронизации объявлений. Предыдущий отчёт сохранён.");
        }
        verifiedAdIds = new Set(result.sources.map((source) => source.adId));
        dashboardSenlerConnected = Boolean(result.dashboardSenlerConnected);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "VK Ads недоступен. Предыдущий отчёт сохранён.");
        return;
      }
    } else { setTab("Настройки"); setNotice("Выберите рекламный кабинет для этого сообщества."); return; }

    const savedFromAccount = connections.find((item) => item.id === community.id)?.latestAnalysis;
    const previous = newerAnalysis(savedFromAccount, cachedAnalysis(community.id), adAssignments[String(community.id)], community.id);
    // Scan each recent VK conversation so the attribution audit has complete denominators.
    const knownRevisions = {};
    const incremental = false;
    const checkpointKey = `dialogika-analysis-checkpoint-v7:${user?.id || ""}:${community.id}:${period}`;
    let checkpoint: AnalysisCheckpoint | null = null;
    try {
      const saved = sessionStorage.getItem(checkpointKey);
      if (saved) {
        const parsed = JSON.parse(saved) as AnalysisCheckpoint;
        if (parsed.version === 1 && Number.isInteger(parsed.offset) && parsed.offset >= 0 &&
            Array.isArray(parsed.dialogs) && Date.now() - parsed.savedAt < 24 * 60 * 60 * 1000) checkpoint = parsed;
        else sessionStorage.removeItem(checkpointKey);
      }
    } catch { /* An unavailable browser store only disables resume. */ }

    setBusy(true);
    setLiveStats(null);
    setLiveDialogs([]);
    setSenlerConversations([]);
    setProgress({ processed: checkpoint?.scannedCount || 0, total: checkpoint?.totalAvailable || 0 });
    setNotice(checkpoint ? `Продолжаю анализ с пачки ${checkpoint.offset}…` : incremental
      ? "Проверяю новые и изменённые переписки сообщества «" + community.name + "» за " + period + " дней…"
      : "Загружаю все переписки сообщества «" + community.name + "» за " + period + " дней…");

    try {
      let senler: SenlerAttribution | undefined;
      let senlerEvents: SenlerEvent[] = [];
      let pageCandidates: SenlerPageCandidate[] = [];
      let pageConversations: SenlerConversation[] = [];
      let vkResults: Array<{ adId: string; results: number }> = [];
      if (dashboardSenlerConnected) {
        setNotice("Сверяю подписки Senler с ID объявлений выбранного кабинета…");
        const response = await fetch("/api/senler/attribution", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ communityId: String(community.id), days: Number(period) }),
        });
        const result = await response.json() as Omit<Partial<SenlerAttribution>, "pageCandidates" | "pageGroups"> & { events?: SenlerEvent[]; pageCandidates?: SenlerPageCandidate[]; pageGroups?: Array<{ subscriptionId: string; adIds: string[]; events: number }>; vkResults?: Array<{ adId: string; results: number }>; vkResultsError?: string | null; error?: string };
        if (!response.ok || !Array.isArray(result.events)) throw new Error(result.error || "Подписки Senler не удалось проверить. Предыдущий отчёт сохранён.");
        senlerEvents = result.events.filter((event) => verifiedAdIds?.has(event.adId));
        pageCandidates = (result.pageCandidates || []).filter((event) => Number.isSafeInteger(event.peerId) && event.peerId > 0);
        vkResults = (result.vkResults || []).filter((row) => verifiedAdIds?.has(row.adId) && Number.isFinite(row.results));
        senler = { totalSubscriptions: result.totalSubscriptions || 0, withAdMarker: result.withAdMarker || 0,
          outsideAccount: result.outsideAccount || 0, withSenlerTagNoAdId: result.withSenlerTagNoAdId || 0,
          withoutMarker: result.withoutMarker || 0, accountAdSubscriptions: result.accountAdSubscriptions || 0, linkedToDialog: 0,
          vkResultsTotal: vkResults.reduce((sum, row) => sum + row.results, 0), vkResultsError: result.vkResultsError || null,
          pageGroups: (result.pageGroups || []).map((group) => ({ ...group,
            vkResults: vkResults.filter((row) => group.adIds.includes(row.adId)).reduce((sum, row) => sum + row.results, 0),
            sources: pageCandidates.filter((event) => event.subscriptionId === group.subscriptionId)
              .reduce<Record<string, number>>((counts, event) => { const source = event.source || "не указан"; counts[source] = (counts[source] || 0) + 1; return counts; }, {}),
          })), pageCandidates: new Set(pageCandidates.map((event) => event.peerId)).size,
          pageConversations: 0, recentPageConversations: 0, clientRepliedPageConversations: 0 };
        if (senlerEvents.length !== senler.accountAdSubscriptions) throw new Error("Сверка подписок и ID объявлений не сошлась. Предыдущий отчёт сохранён.");
        if (pageCandidates.length) {
          setNotice("Ищу переписки подписчиков Senler в сообщениях сообщества…");
          const peerIds = [...new Set(pageCandidates.map((event) => event.peerId))];
          const matchResponse = await fetch("/api/vk/senler-dialogs", { method: "POST",
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({ communityId: String(community.id), peerIds }) });
          const matches = await matchResponse.json() as { matchedPeerIds?: number[]; error?: string };
          if (!matchResponse.ok || !Array.isArray(matches.matchedPeerIds)) throw new Error(matches.error || "Не удалось проверить переписки подписчиков. Предыдущий отчёт сохранён.");
          const matched = new Set(matches.matchedPeerIds.filter((id) => peerIds.includes(id)));
          const seen = new Set<number>();
          pageConversations = pageCandidates.filter((event) => {
            if (!matched.has(event.peerId) || seen.has(event.peerId)) return false;
            seen.add(event.peerId); return true;
          }).map((event) => ({ ...event, recent: false }));
          senler.pageConversations = pageConversations.length;
        }
      }
      const senlerAdByPeer: Record<string, string> = {};
      for (const event of senlerEvents) if (event.peerId && !senlerAdByPeer[String(event.peerId)]) senlerAdByPeer[String(event.peerId)] = event.adId;
      const PAGE_SIZE = 3;
      let offset = checkpoint?.offset || 0;
      let done = false;
      let totalAvailable: number | null = checkpoint?.totalAvailable ?? null;
      const parallelPages = 1;
      let preferredModel = checkpoint?.preferredModel || (previous && "stats" in previous ? previous.stats.ai.model?.split(",")[0]?.trim() : "") || "";
      let objectionLabels: Record<string, string> = checkpoint?.objectionLabels || {};
      const dialogMap = new Map<number, LiveDialog>((checkpoint?.dialogs || []).map((dialog) => [dialog.peerId, dialog]));
      const reusedPeerIds = new Set<number>(checkpoint?.reusedPeerIds || []);
      const changedPeerIds = new Set<number>(checkpoint?.changedPeerIds || []);
      let scannedCount = checkpoint?.scannedCount || 0;
      const visitedOffsets = new Set<number>();
      let newAiAnalyzedCount = checkpoint?.aiAnalyzedCount || 0;
      let newFallbackCount = checkpoint?.fallbackCount || 0;
      let aiFailureReason = checkpoint?.aiFailureReason || "";
      const aiUsage = checkpoint?.aiUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
      const attribution = checkpoint?.attribution || emptyAttribution();
      const senlerRecentPeerIds = new Set<number>(checkpoint?.senlerRecentPeerIds || []);
      const senlerClientRepliedPeerIds = new Set<number>(checkpoint?.senlerClientRepliedPeerIds || []);

      const fetchPage = async (pageOffset: number, model: string) => {
        let response: Response | null = null;
        let responseText = "";
        const maxAttempts = 4;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            response = await fetch("/api/vk/analyze", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                token,
                openaiKey,
                senlerCredential: senlerConnections.find((item) => item.communityId === community.id)?.key || "",
                preferredModel: model,
                groupId: community.id,
                communityName: community.name,
                days: Number(period),
                offset: pageOffset,
                knownRevisions,
                verifiedAdIds: verifiedAdIds ? [...verifiedAdIds] : undefined,
                senlerAdByPeer,
                senlerCandidatePeerIds: pageConversations.map((item) => item.peerId),
              }),
            });
            responseText = await response.text();
            if (response.ok || response.status < 500 || attempt === maxAttempts - 1) break;
          } catch (error) {
            if (attempt === maxAttempts - 1) {
              throw new Error(error instanceof Error && error.message === "Failed to fetch"
                ? "Соединение с сервером анализа оборвалось. Запустите анализ ещё раз — предыдущий результат сохранён."
                : error instanceof Error ? error.message : "Сервер анализа не ответил");
            }
          }
          setNotice("Сервер задержал пачку. Повторная попытка " + (attempt + 2) + " из " + maxAttempts + "…");
          await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
        }
        if (!response) throw new Error("Сервер анализа не ответил");

        let result: {
          stats?: { dialogs: number; leads: number; contacts: number; targets: number; lost: number; responseSum: number; responseCount: number };
          objectionLabels?: Record<string, string>;
          ai?: { enabled: boolean; model: string; analyzedCount: number; fallbackCount: number; failureReason?: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number } };
          dialogs?: LiveDialog[];
          unchangedPeerIds?: number[];
          pageDialogs?: number;
          attribution?: Attribution;
          senlerRecentPeerIds?: number[];
          senlerClientRepliedPeerIds?: number[];
          changedDialogs?: number;
          done?: boolean;
          nextOffset?: number;
          totalConversations?: number;
          error?: string;
        };
        try {
          result = JSON.parse(responseText) as typeof result;
        } catch {
          const cloudflareCode = responseText.match(/error code:\s*(\d+)/i)?.[1];
          throw new Error(cloudflareCode === "524"
            ? "Сервер не успел обработать пачку диалогов. Повторите запуск — размер пачек уже уменьшен."
            : "Сервер вернул некорректный ответ" + (response.status ? " (" + response.status + ")" : "") + ".");
        }
        if (!response.ok || !result.stats) throw new Error(`Пачка ${pageOffset}: ${result.error || "анализ не завершён"}`);
        return result;
      };

      while (!done) {
        if (totalAvailable !== null && offset >= totalAvailable) break;

        const pageOffsets = Array.from({ length: parallelPages }, (_, index) => offset + index * PAGE_SIZE)
          .filter((pageOffset) => totalAvailable === null || pageOffset < totalAvailable);
        if (!pageOffsets.length) break;
        if (pageOffsets.every((pageOffset) => visitedOffsets.has(pageOffset))) {
          throw new Error("Анализ остановлен: сервер повторно вернул уже обработанную страницу диалогов.");
        }
        pageOffsets.forEach((pageOffset) => visitedOffsets.add(pageOffset));

        const pageResults = await Promise.all(pageOffsets.map((pageOffset) => fetchPage(pageOffset, preferredModel)));
        let nextOffset = offset;

        for (const result of pageResults) {
          objectionLabels = result.objectionLabels || objectionLabels;
          scannedCount += result.pageDialogs ?? ((result.unchangedPeerIds?.length || 0) + (result.dialogs?.length || 0));
          if (!result.attribution) throw new Error("Сервер не вернул сверку рекламных меток; отчёт не сохранён.");
          for (const key of Object.keys(attribution) as Array<keyof Attribution>) attribution[key] += result.attribution[key] || 0;
          for (const peerId of result.senlerRecentPeerIds || []) senlerRecentPeerIds.add(peerId);
          for (const peerId of result.senlerClientRepliedPeerIds || []) senlerClientRepliedPeerIds.add(peerId);

          if (result.unchangedPeerIds?.length) throw new Error("Сервер пропустил переписки при полной сверке; отчёт не сохранён.");

          for (const dialog of result.dialogs || []) {
            if (verifiedAdIds && !verifiedAdIds.has(dialog.adId || "")) continue;
            dialogMap.set(dialog.peerId, dialog);
            changedPeerIds.add(dialog.peerId);
            reusedPeerIds.delete(dialog.peerId);
          }

          if (!result.ai?.enabled) throw new Error("ИИ-анализ не запущен: не подключён API Router Cheap.");
          if (result.ai.analyzedCount && result.ai.model && result.ai.model !== "резервный алгоритм") {
            preferredModel = result.ai.model.split(",")[0].trim();
          }
          newAiAnalyzedCount += result.ai.analyzedCount || 0;
          newFallbackCount += result.ai.fallbackCount || 0;
          if (result.ai.failureReason) aiFailureReason = result.ai.failureReason;
          aiUsage.inputTokens += result.ai.usage.inputTokens || 0;
          aiUsage.outputTokens += result.ai.usage.outputTokens || 0;
          aiUsage.totalTokens += result.ai.usage.totalTokens || 0;
          aiUsage.estimatedCostUsd += result.ai.usage.estimatedCostUsd || 0;

          nextOffset = Math.max(nextOffset, result.nextOffset ?? nextOffset);
          done = done || Boolean(result.done);
          totalAvailable = result.totalConversations ?? totalAvailable;
        }

        if (!done && nextOffset <= offset) {
          throw new Error("Анализ остановлен: позиция загрузки диалогов перестала изменяться.");
        }
        if (totalAvailable !== null && nextOffset >= totalAvailable) done = true;
        offset = nextOffset;
        try {
          const nextCheckpoint = {
            version: 1, savedAt: Date.now(), offset, totalAvailable, dialogs: [...dialogMap.values()],
            reusedPeerIds: [...reusedPeerIds], changedPeerIds: [...changedPeerIds], scannedCount,
            preferredModel, objectionLabels, aiAnalyzedCount: newAiAnalyzedCount,
            fallbackCount: newFallbackCount, aiFailureReason, aiUsage,
            attribution,
            senlerRecentPeerIds: [...senlerRecentPeerIds],
            senlerClientRepliedPeerIds: [...senlerClientRepliedPeerIds],
          } satisfies AnalysisCheckpoint;
          sessionStorage.setItem(checkpointKey, JSON.stringify(nextCheckpoint));
          checkpoint = nextCheckpoint;
        } catch { /* Keep the active run even if browser storage is unavailable. */ }
        const safeScannedCount = totalAvailable === null ? scannedCount : Math.min(scannedCount, totalAvailable);
        setProgress({ processed: safeScannedCount, total: totalAvailable || 0 });
        setNotice(incremental
          ? "Проверено " + safeScannedCount + " диалогов: " + reusedPeerIds.size + " без повторного ИИ-анализа, " + changedPeerIds.size + " обновлено…"
          : "Анализ продолжается: найдено " + dialogMap.size + " диалогов из " + (totalAvailable || "…") + "…");
      }

      if (newFallbackCount > 0 && newAiAnalyzedCount === 0) {
        throw new Error(`Router Cheap не обработал рекламные диалоги: ${aiFailureReason || "проверьте доступ к моделям"}. Предыдущий отчёт сохранён.`);
      }

      const analyzedDialogs = [...dialogMap.values()]
        .filter((dialog) => Boolean(dialog.metrics && dialog.adId && (!verifiedAdIds || verifiedAdIds.has(dialog.adId))))
        .sort((a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0));
      if (analyzedDialogs.length !== attribution.matchedToAccount ||
          attribution.historiesLoaded !== attribution.matchedToAccount + attribution.taggedOutsideAccount + attribution.withoutMarker ||
          attribution.withVkMarker + attribution.withSenlerMarker !== attribution.matchedToAccount + attribution.taggedOutsideAccount) {
        throw new Error("Сверка рекламных меток не сошлась; отчёт не сохранён. Повторите полный анализ.");
      }
      const cutoff = Math.floor(Date.now() / 1000) - Number(period) * 86400;
      const totals = { dialogs: analyzedDialogs.length, replies: 0, leads: 0, contacts: 0, targets: 0, lost: 0, responseSum: 0, responseCount: 0, slowResponse: 0, noNextStep: 0, unanswered: 0 };
      const objectionTotals: Record<string, number> = {};
      const dailyTotals: Record<string, number> = {};
      const adTotals: Record<string, AdStat> = {};
      let objectionDialogs = 0;

      for (const dialog of analyzedDialogs) {
        const metrics = dialog.metrics as DialogMetrics;
        const replied = dialog.hasClientMessage !== false;
        const lead = replied && (dialog.aiAnalyzed === false ? metrics.hasInterest : dialog.status !== "Не лид");
        const target = replied && (dialog.goalReached ?? dialog.status === "Успешно");
        const purchase = replied && (dialog.purchase ?? (Boolean(target) && /(покуп|оплат|билет|приобр)/i.test(`${dialog.goal || ""} ${dialog.issue || ""}`)));
        const lost = replied && dialog.status === "Потерян";

        totals.replies += Number(replied);
        totals.leads += Number(lead);
        totals.contacts += Number(metrics.hasPhone);
        totals.targets += Number(target);
        totals.lost += Number(lost);
        totals.responseSum += metrics.responseSum || 0;
        totals.responseCount += metrics.responseCount || 0;
        totals.slowResponse += Number(metrics.slowResponse);
        totals.noNextStep += Number(metrics.noNextStep);
        totals.unanswered += Number(metrics.unanswered);

        if (metrics.objectionKeys.length) objectionDialogs += 1;
        for (const key of metrics.objectionKeys) objectionTotals[key] = (objectionTotals[key] || 0) + 1;

        if (metrics.firstEverDate && metrics.firstEverDate >= cutoff) {
          const day = new Date((metrics.firstEverDate + 3 * 3600) * 1000).toISOString().slice(0, 10);
          dailyTotals[day] = (dailyTotals[day] || 0) + 1;
        }

        if (dialog.adId) {
          const current = adTotals[dialog.adId] || { adId: dialog.adId, dialogs: 0, replies: 0, leads: 0, targets: 0, purchases: 0, phones: 0, lost: 0, scoreSum: 0 };
          current.dialogs += 1;
          current.replies = (current.replies || 0) + Number(replied);
          current.leads += Number(lead);
          current.targets += Number(target);
          current.purchases = (current.purchases || 0) + Number(purchase);
          current.phones = (current.phones || 0) + Number(metrics.hasPhone);
          current.lost += Number(lost);
          current.scoreSum += dialog.score || 0;
          adTotals[dialog.adId] = current;
        }
      }

      if (senler) {
        const exactAdsByPeer = new Map(analyzedDialogs.map((dialog) => [dialog.peerId, dialog.adId]));
        pageConversations = pageConversations.map((item) => ({ ...item, recent: senlerRecentPeerIds.has(item.peerId),
          clientReplied: senlerClientRepliedPeerIds.has(item.peerId),
          adId: exactAdsByPeer.get(item.peerId) || null }));
        senler.recentPageConversations = pageConversations.filter((item) => item.recent).length;
        senler.clientRepliedPageConversations = pageConversations.filter((item) => item.clientReplied).length;
        const dialogPeers = new Set(analyzedDialogs.map((dialog) => dialog.peerId));
        senler.linkedToDialog = senlerEvents.filter((event) => event.peerId && dialogPeers.has(event.peerId)).length;
        for (const event of senlerEvents) {
          const current = adTotals[event.adId] || { adId: event.adId, dialogs: 0, replies: 0, leads: 0, targets: 0, purchases: 0, phones: 0, lost: 0, scoreSum: 0 };
          current.subscriptions = (current.subscriptions || 0) + 1;
          adTotals[event.adId] = current;
        }
        for (const row of vkResults) {
          const current = adTotals[row.adId] || { adId: row.adId, dialogs: 0, replies: 0, leads: 0, targets: 0, purchases: 0, phones: 0, lost: 0, scoreSum: 0 };
          current.vkResults = row.results;
          adTotals[row.adId] = current;
        }
      }

      const recoverableLow = Math.round(totals.lost * 0.25);
      const recoverableHigh = Math.round(totals.lost * 0.55);
      const midpoint = (recoverableLow + recoverableHigh) / 2;
      const growth = totals.targets ? Math.round(midpoint / totals.targets * 100) : null;
      const priority = totals.slowResponse > objectionDialogs * 1.2
        ? "speed" as const
        : objectionDialogs > totals.slowResponse * 1.2
          ? "objections" as const
          : "balanced" as const;
      const aiModels = new Set<string>();
      for (const dialog of analyzedDialogs) {
        if (!dialog.aiAnalyzed || !dialog.aiModel) continue;
        dialog.aiModel.split(",").map((model) => model.trim()).filter(Boolean).forEach((model) => aiModels.add(model));
      }
      const totalAiAnalyzed = analyzedDialogs.filter((dialog) => dialog.hasClientMessage !== false && dialog.aiAnalyzed !== false).length;
      const totalFallback = totals.replies - totalAiAnalyzed;

      const completedStats: LiveStats = {
        dialogs: totals.dialogs,
        replies: totals.replies,
        leads: totals.leads,
        contacts: totals.contacts,
        targets: totals.targets,
        lost: totals.lost,
        averageResponse: totals.responseCount ? Math.round(totals.responseSum / totals.responseCount) : 0,
        recoverableLow,
        recoverableHigh,
        goal: "Запись или покупка",
        growth,
        slowResponse: totals.slowResponse,
        noNextStep: totals.noNextStep,
        unanswered: totals.unanswered,
        responseMeasured: totals.responseCount > 0,
        objections: Object.entries(objectionTotals)
          .map(([key, count]) => ({ key, label: objectionLabels[key] || key, count }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count),
        objectionDialogs,
        dailyNew: Object.entries(dailyTotals).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        ads: Object.values(adTotals).sort((a, b) => b.dialogs - a.dialogs),
        priority,
        ai: {
          model: [...aiModels].join(", ") || "резервный алгоритм",
          analyzedCount: totalAiAnalyzed,
          fallbackCount: totalFallback,
          inputTokens: aiUsage.inputTokens,
          outputTokens: aiUsage.outputTokens,
          totalTokens: aiUsage.totalTokens,
          estimatedCostUsd: aiUsage.estimatedCostUsd,
          nuances: [...new Set(analyzedDialogs.map((dialog) => dialog.nuance).filter((value): value is string => Boolean(value)))].slice(0, 6),
          recommendations: [...new Set(analyzedDialogs.map((dialog) => dialog.recommendation).filter((value): value is string => Boolean(value)))].slice(0, 6),
          reusedCount: reusedPeerIds.size,
          changedCount: changedPeerIds.size,
        },
        attribution,
        senler,
      };

      setLiveStats(completedStats);
      setLiveDialogs(analyzedDialogs);
      setSenlerConversations(pageConversations);
      setTab("Обзор");

      const storedAnalysis: StoredAnalysis = {
        stats: completedStats,
        dialogs: analyzedDialogs,
        senlerConversations: pageConversations,
        period,
        accountId: adAssignments[String(community.id)] || undefined,
        savedAt: new Date().toISOString(),
        version: 13,
      };
      setConnections((current) => current.map((item) => item.id === community.id ? { ...item, latestAnalysis: storedAnalysis } : item));
      cacheAnalysis(community.id, storedAnalysis);

      let saveWarning = "";
      try {
        const accountAnalysis = fitStoredAnalysis(storedAnalysis, ACCOUNT_ANALYSIS_MAX_CHARS);
        await saveSetting({ kind: "vk", externalId: String(community.id), name: community.name, photo: community.photo, latestAnalysis: accountAnalysis }, accessToken);
        if (accountAnalysis.dialogs.length < storedAnalysis.dialogs.length) {
          saveWarning = " В аккаунте сохранена статистика и " + accountAnalysis.dialogs.length + " из " + storedAnalysis.dialogs.length + " карточек диалогов; полный текущий результат оставлен в этом браузере.";
        }
      } catch {
        saveWarning = " Анализ завершён и показан, но сервер не смог сохранить копию результата в аккаунт. В этом браузере результат сохранён локально.";
      }

      let successMessage = "";
      if (incremental && changedPeerIds.size === 0) {
        successMessage = "Готово: проверено " + totals.dialogs + " диалогов. Изменений нет — повторный ИИ-анализ не понадобился, токены Router Cheap не потрачены.";
      } else if (incremental) {
        successMessage = "Готово: проверено " + totals.dialogs + " диалогов; " + reusedPeerIds.size + " использовано из кэша, " + changedPeerIds.size + " обновлено. В последнем запуске использовано " + aiUsage.totalTokens.toLocaleString("ru-RU") + " токенов.";
      } else {
        successMessage = "Готово: учтено " + totals.dialogs + " переписок с рекламной меткой; " + totals.replies + " с ответом клиента, " + totalAiAnalyzed + " разобрано ИИ. Использовано " + aiUsage.totalTokens.toLocaleString("ru-RU") + " токенов.";
      }
      if (newFallbackCount > 0) {
        successMessage += " Для " + newFallbackCount + " изменённых диалогов применены формальные признаки; эти выводы требуют проверки.";
      }
      setNotice(successMessage + saveWarning);
      try { sessionStorage.removeItem(checkpointKey); } catch { /* The result is already saved. */ }
    } catch (error) {
      restoreAnalysis(previous);
      setNotice((error instanceof Error ? error.message : "Ошибка анализа") + (checkpoint ? " Повторный запуск продолжит с последней завершённой пачки." : ""));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!liveStats || !community) {
      setNotice("Сначала завершите полный анализ — PDF формируется только по фактическим данным.");
      return;
    }
    setReportBusy(true);
    setNotice("Формирую расширенный отчёт на 5 страниц…");
    try {
      const { downloadDetailedReport } = await import("./reportPdf");
      await downloadDetailedReport({
        community: community.name,
        period: Number(period),
        generatedAt: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date()),
        ...liveStats,
      });
      setNotice("PDF-отчёт сформирован и отправлен на скачивание.");
    } catch {
      setNotice("Не удалось сформировать PDF. Обновите страницу и повторите попытку.");
    } finally {
      setReportBusy(false);
    }
  }

  if (!authReady) return <div className="authPage"><div className="authCard"><b>Загружаю Диалогику…</b></div></div>;
  if (!user || !supabase) return <Login client={supabase} />;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brandMark">Д</span><span>Диалогика</span></div>
        <nav aria-label="Основная навигация">
          {["Обзор", "Объявления", "Диалоги", "Качество", "ИИ-бот", "Настройки"].map((item) => (
            <button key={item} onClick={() => setTab(item)} className={tab === item ? "navItem active" : "navItem"}>
              <span className="navIcon">{item === "Обзор" ? "⌁" : item === "Объявления" ? "◎" : item === "Диалоги" ? "◫" : item === "Качество" ? "◇" : item === "Настройки" ? "⚙" : "✦"}</span>{item}
            </button>
          ))}
        </nav>
        <div className="sideBottom">
          <div className="community"><span className="communityIcon">VK</span><div><b>{community?.name || "Не подключено"}</b><small>{community ? "Сообщество подключено" : "Реальные данные не загружены"}</small></div><i className={community ? "" : "offline"}>●</i></div>
          <button onClick={() => setTab("Настройки")} className="navItem"><span className="navIcon">⚙</span>Настройки</button>
          <button onClick={() => supabase.auth.signOut()} className="navItem"><span className="navIcon">↪</span>Выйти</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">АНАЛИТИКА ПЕРЕПИСОК</p><h1>{tab}</h1></div>
          <div className="actions">
            <label className="importButton">↑ Импорт JSON / CSV<input type="file" accept=".json,.csv" onChange={importFile} /></label>
            {liveStats && <button className="reportButton" disabled={reportBusy} onClick={downloadPdf}>{reportBusy ? "Готовлю PDF…" : "↓ Скачать отчёт PDF"}</button>}
            <button className="primary" disabled={busy} onClick={runAnalysis}>{busy ? "Обрабатываю…" : "Запустить анализ"} <span>→</span></button>
          </div>
        </header>

        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Закрыть">×</button></div>}

        {tab === "Обзор" && <>
          <div className="introRow">
            <div><h2>Что происходит в ваших диалогах</h2><p>{liveStats ? `Отчёт по сообществу «${community?.name}» за ${period} дней.` : "Здесь появятся только фактические результаты после полного анализа."}</p></div>
            <div className="period" aria-label="Период анализа">
              {(["30", "60", "90"] as Period[]).map((p) => <button key={p} disabled={busy} onClick={() => setPeriod(p)} className={period === p ? "selected" : ""}>{p} дней</button>)}
            </div>
          </div>

          {!community && <EmptyState title="Сообщество не подключено" text="Тестовые показатели удалены. Подключите ВКонтакте, чтобы увидеть только реальные данные." action="Подключить ВКонтакте →" onClick={() => setTab("Настройки")} />}
          {community && !liveStats && !busy && <EmptyState title="Готово к анализу" text={`Подключено «${community.name}». Нажмите «Запустить анализ» — будут обработаны все диалоги за выбранные ${period} дней.`} action="Запустить полный анализ →" onClick={runAnalysis} />}
          {busy && <div className="analysisProgress"><div className="spinner">⌁</div><div><b>Идёт полный анализ</b><p>Обработано {progress.processed.toLocaleString("ru-RU")} диалогов. Не закрывайте вкладку до завершения.</p></div></div>}

          {data && liveStats && <>
            <div className="metrics">
              <Metric label="С рекламной меткой" value={data.dialogs.toLocaleString("ru-RU")} hint={`${(liveStats.replies ?? data.dialogs).toLocaleString("ru-RU")} с ответом клиента`} description="Все переписки с рекламной меткой и сообщением за период; отдельная доля показывает ответ клиента." />
              <Metric label="Интерес к предложению" value={data.leads.toLocaleString("ru-RU")} hint={`${pct(data.leads, liveStats.replies ?? data.dialogs)}% от ответивших`} description="Человек предметно спрашивал о товаре или услуге, цене, условиях, заказе или записи. Это ещё не покупка." />
              <Metric label="Клиент оставил телефон" value={data.contacts.toLocaleString("ru-RU")} hint={`${pct(data.contacts, liveStats.replies ?? data.dialogs)}% от ответивших`} description="Телефон найден в сообщении клиента. Номер, написанный менеджером, не учитывается." />
              <Metric label="Заказ, запись или покупка" value={data.measurements.toLocaleString("ru-RU")} hint={`${pct(data.measurements, data.leads)}% от заинтересованных`} description="В переписке подтверждены заказ, запись, договор, покупка или оплата. Один лишь вопрос о цене сюда не входит." />
              <Metric label="Среднее время ответа" value={data.response} danger={liveStats.responseMeasured && liveStats.averageResponse > 300} hint={liveStats.responseMeasured ? "между вопросом и ответом" : "в периоде нет пар вопрос–ответ"} description="Среднее время от первого входящего сообщения клиента до следующего ответа сообщества." />
            </div>
            {sourceProfile?.miniAppAds ? <article className="card attributionCard">
              <b>Подписки и переписки — разные события</b>
              <p>В выбранном кабинете {sourceProfile.miniAppAds} объявлений ведут в VK Mini App. Результат «Подписаться на рассылку» может появиться без сообщения в сообщество, поэтому число подписок нельзя считать числом переписок.</p>
              {!sourceProfile.senlerConnected && !sourceProfile.dashboardSenlerConnected && <p>Senler для этого сообщества не подключён. Подписки без сообщений сейчас нельзя сверить по людям и объявлениям. <button onClick={() => setTab("Настройки")}>Подключить Senler →</button></p>}
              {liveStats?.senler && <p>Senler: {liveStats.senler.totalSubscriptions} событий подписки; у {liveStats.senler.accountAdSubscriptions} есть точный ID объявления выбранного кабинета. Из них {liveStats.senler.linkedToDialog} связаны с перепиской. Без метки источника — {liveStats.senler.withoutMarker}, с меткой Senler без ID объявления — {liveStats.senler.withSenlerTagNoAdId}, с ID другого кабинета — {liveStats.senler.outsideAccount}. {liveStats.senler.vkResultsError ? `Статистика результатов VK Ads недоступна: ${liveStats.senler.vkResultsError}.` : `VK Ads показывает ${liveStats.senler.vkResultsTotal || 0} результатов объявлений Mini App; они приведены отдельно и могут не совпадать с событиями Senler.`} Подписка без сообщений не считается диалогом и не оценивается ИИ.</p>}
              {liveStats?.senler?.pageCandidates !== undefined && <><p>На подписных страницах, указанных в объявлениях этого кабинета: {liveStats.senler.pageGroups?.reduce((sum, item) => sum + item.events, 0) || 0} событий, {liveStats.senler.pageCandidates} пользователей. Переписка с сообществом найдена у {liveStats.senler.pageConversations || 0}; у {liveStats.senler.recentPageConversations || 0} из них были сообщения за выбранный период, у {liveStats.senler.clientRepliedPageConversations ?? "—"} есть ответ клиента. Совпадение подписной страницы подтверждает страницу, но без рекламной метки не определяет, какое объявление привело пользователя.</p><p>{liveStats.senler.pageGroups?.map((group) => `Страница Senler #${group.subscriptionId}: ${group.events} подписок, ${senlerConversations.filter((item) => item.subscriptionId === group.subscriptionId).length} переписок, ${senlerConversations.filter((item) => item.subscriptionId === group.subscriptionId && item.clientReplied).length} ответов клиента, ${group.vkResults ?? "—"} результатов VK Ads, ${group.adIds.length} объявлений; источник Senler: ${Object.entries(group.sources || {}).map(([source, count]) => `${source} — ${count}`).join(", ") || "не указан"}`).join(" · ")}</p></>}
            </article> : null}
            {liveStats.attribution && <article className="card attributionCard">
              <b>Сверка рекламных меток за {period} дней</b>
              <p>Переписок с сообщениями за период: {liveStats.attribution.recentConversations}. Историю удалось прочитать у {liveStats.attribution.historiesLoaded}. Метка VK найдена у {liveStats.attribution.withVkMarker}, метка Senler — у {liveStats.attribution.withSenlerMarker}. К выбранному кабинету относятся {liveStats.attribution.matchedToAccount}; метка другого или неизвестного объявления — у {liveStats.attribution.taggedOutsideAccount}; без рекламной метки — {liveStats.attribution.withoutMarker}.</p>
              <small>В сверку входят только диалоги, которые VK вернул с сообщением за период. Подписки в мини-приложении без сообщений сюда не входят.</small>
            </article>}

            {liveStats.senler?.pageCandidates !== undefined && <SenlerConversationList conversations={senlerConversations} communityId={community?.id || null} accessToken={accessToken} />}

            <div className="gridMain">
              <article className="card funnelCard">
                <div className="cardHead"><div><p className="eyebrow">ЭТАПЫ ДИАЛОГА</p><h3>От обращения до записи или покупки</h3></div><span className="confidence">По переписке, без данных о расходах</span></div>
                <div className="funnel">
                  <FunnelRow label="С рекламной меткой" value={data.dialogs} max={data.dialogs} color="#231f20" />
                  <FunnelRow label="Ответ клиента" value={liveStats.replies ?? data.dialogs} max={data.dialogs} color="#4a72d4" />
                  <FunnelRow label="Интерес к предложению" value={data.leads} max={data.dialogs} color="#775cff" />
                  <FunnelRow label="Клиент оставил телефон" value={data.contacts} max={data.dialogs} color="#a493ff" />
                  <FunnelRow label="Запись или покупка подтверждена" value={data.measurements} max={data.dialogs} color="#40b78a" />
                </div>
                <p className="funnelNote"><b>{data.lost} диалогов</b> отмечены как потерянные: интерес был, подтверждённой записи или покупки нет. Статус определён ИИ или резервным алгоритмом и требует проверки человеком.</p>
              </article>

              <article className="card lossCard">
                <p className="eyebrow">НАДЁЖНОСТЬ ОТЧЁТА</p><div className="lossNumber">{pct(liveStats.ai.analyzedCount ?? 0, liveStats.replies ?? liveStats.dialogs)}%</div>
                <h3>ответов клиентов разобрала нейросеть</h3>
                <p>Остальные {liveStats.ai.fallbackCount ?? 0} переписок с ответом оценены по формальным признакам. Без ответа клиента: {liveStats.dialogs - (liveStats.replies ?? liveStats.dialogs)} — они учтены в охвате без смысловой оценки.</p>
                <div className="estimate"><span>Нейросеть</span><b>{liveStats.ai.analyzedCount ?? 0} из {liveStats.replies ?? liveStats.dialogs}</b></div>
                <small>Числа в отчёте показывают признаки из переписки, а не подтверждённые продажи в кассе.</small>
              </article>
            </div>

            <div className="sectionHead"><div><p className="eyebrow">ОБРАБОТКА ОБРАЩЕНИЙ</p><h2>Где диалоги требуют внимания</h2></div></div>
            <div className="chartGrid">
              <LossChart stats={liveStats} />
              <OptimizationChart stats={liveStats} />
            </div>

            <div className="sectionHead"><div><p className="eyebrow">СПРОС И ВОЗРАЖЕНИЯ</p><h2>Новые диалоги и причины сомнений</h2></div></div>
            <div className="chartGrid">
              <NewDialogsChart stats={liveStats} />
              <ObjectionsChart stats={liveStats} />
            </div>

            <div className="sectionHead"><div><p className="eyebrow">СМЫСЛОВОЙ ИИ-АНАЛИЗ</p><h2>Нюансы и выводы, которых нет в обычной статистике</h2></div></div>
            <div className="aiInsightGrid">
              <article className="card aiInsight"><span>ЧТО ЗАМЕТИЛ ИИ</span>{liveStats.ai.nuances.map((item) => <p key={item}>✦ {item}</p>)}</article>
              <article className="card aiInsight recommendations"><span>ЧТО ИЗМЕНИТЬ</span>{liveStats.ai.recommendations.map((item) => <p key={item}>→ {item}</p>)}</article>
            </div>
            <div className="aiUsage">ИИ-модель: <b>{liveStats.ai.model}</b> · нейросеть обработала <b>{(liveStats.ai.analyzedCount ?? 0).toLocaleString("ru-RU")}</b> диалогов{(liveStats.ai.fallbackCount ?? 0) > 0 ? ` · по формальным признакам: ${liveStats.ai.fallbackCount.toLocaleString("ru-RU")}` : ""} · в успешных ответах учтено <b>{liveStats.ai.totalTokens.toLocaleString("ru-RU")}</b> токенов. Фактическое списание, включая неудачные запросы, смотрите в кабинете Router Cheap.</div>

            <div className="sectionHead"><div><p className="eyebrow">ГЛАВНЫЕ ПРОБЛЕМЫ</p><h2>Что именно требует исправления</h2></div></div>
            <div className="problemGrid liveProblems">
              <ProblemCard number="01" color="#ff6b4a" title="Долгий ответ" count={liveStats.slowResponse} total={liveStats.replies ?? liveStats.dialogs} text="Хотя бы один ответ менеджера занял больше 15 минут." />
              <ProblemCard number="02" color="#775cff" title="Нет следующего шага" count={liveStats.noNextStep} total={liveStats.replies ?? liveStats.dialogs} text="Коммерческий интерес есть, но диалог не доведён до найденной цели." />
              <ProblemCard number="03" color="#f5b82e" title="Последнее слово за клиентом" count={liveStats.unanswered} total={liveStats.replies ?? liveStats.dialogs} text="Последнее сообщение написал клиент, после него ответа сообщества не было." />
              <ProblemCard number="04" color="#40b78a" title="Потеря с высоким риском" count={liveStats.lost} total={liveStats.replies ?? liveStats.dialogs} text="Совпали интерес, отсутствие целевого действия и незакрытый вопрос клиента." />
            </div>
          </>}
        </>}

        {tab === "Объявления" && <AdsDashboard stats={liveStats} dialogs={liveDialogs} serverAds={serverAds} serverDialogTotal={serverAdDialogTotal} serverStatus={serverAdsStatus} serverError={serverAdsError} cabinet={adCabinet} accessToken={accessToken} communityId={community?.id || null} onAnalyze={runAnalysis} />}
        {tab === "Диалоги" && <><AllDialogs key={community?.id || "none"} communityId={community?.id || null} accessToken={accessToken} /><div className="sectionHead"><h2>Диалоги из рекламы</h2></div><DialogsTable key={community?.id || "none"} query={query} setQuery={setQuery} filteredDialogs={filteredDialogs} analyzed={Boolean(liveStats)} communityId={community?.id || null} accessToken={accessToken} /></>}
        {tab === "Качество" && <Quality stats={liveStats} />}
        {tab === "ИИ-бот" && <Bot goal={liveStats?.goal} />}
        {tab === "Настройки" && <Settings community={community} connections={connections} openaiConnected={Boolean(openaiKey)} senlerConnected={Boolean(community && senlerConnections.some((item) => item.communityId === community.id && Boolean(item.key)))} adAccounts={adAccounts} adAccountId={community ? adAssignments[String(community.id)] || "" : ""} busy={busy || syncingAccounts} onConnect={connectCommunity} onSelect={selectCommunity} onConnectOpenAI={connectOpenAI} onConnectSenler={connectSenler} onConnectVkAds={connectVkAds} onSyncMissingAdIds={syncMissingAdIds} syncingAccounts={syncingAccounts} onDisconnectOpenAI={async () => { await deleteSetting("router", "default", accessToken); setOpenaiKey(""); setNotice("Router Cheap отключён. Ключ удалён из вашего аккаунта."); }} onDisconnectSenler={async () => { if (!community) return; await deleteSetting("senler", String(community.id), accessToken); setSenlerConnections((current) => current.filter((item) => item.communityId !== community.id)); setNotice("Senler отключён. Ключ удалён из вашего аккаунта."); }} onDisconnect={disconnectCommunity} />}
      </section>
    </main>
  );
}

async function saveSetting(values: Record<string, unknown>, accessToken: string) {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(values),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Не удалось сохранить подключение");
}

async function deleteSetting(kind: "vk" | "router" | "senler", externalId: string, accessToken: string) {
  const response = await fetch(`/api/settings?kind=${kind}&externalId=${encodeURIComponent(externalId)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Не удалось удалить подключение");
}

function Login({ client }: { client: SupabaseClient | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!client) return setMessage("Авторизация временно недоступна");
    setBusy(true); setMessage("");
    const credentials = { email, password };
    const { error } = mode === "login" ? await client.auth.signInWithPassword(credentials) : await client.auth.signUp(credentials);
    setBusy(false);
    if (error) setMessage(error.message);
    else if (mode === "signup") setMessage("Проверьте почту и подтвердите регистрацию.");
  }
  return <main className="authPage"><section className="authCard">
    <div className="brand authBrand"><span className="brandMark">Д</span><span>Диалогика</span></div>
    <p className="eyebrow">ЕДИНЫЙ АККАУНТ</p><h1>{mode === "login" ? "Вход" : "Регистрация"}</h1>
    <p className="authHint">Используйте тот же email и пароль, что и в VK Ads Dashboard.</p>
    <form onSubmit={submit} className="authForm">
      <label className="tokenLabel">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="tokenLabel">Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      {message && <div className="authMessage">{message}</div>}
      <button className="primary wide" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти →" : "Создать аккаунт →"}</button>
    </form>
    <button className="authSwitch" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>{mode === "login" ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Войти"}</button>
  </section></main>;
}

function Settings({ community, connections, openaiConnected, senlerConnected, adAccounts, adAccountId, busy, onConnect, onSelect, onConnectOpenAI, onConnectSenler, onConnectVkAds, onSyncMissingAdIds, syncingAccounts, onDisconnectOpenAI, onDisconnectSenler, onDisconnect }: { community: Community | null; connections: SavedCommunity[]; openaiConnected: boolean; senlerConnected: boolean; adAccounts: DashboardAccount[]; adAccountId: string; busy: boolean; onConnect: (token: string) => void; onSelect: (community: SavedCommunity) => void; onConnectOpenAI: (key: string) => void; onConnectSenler: (key: string, groupId: string) => void; onConnectVkAds: (accountId: string) => void; onSyncMissingAdIds: () => void; syncingAccounts: boolean; onDisconnectOpenAI: () => void; onDisconnectSenler: () => void; onDisconnect: () => void }) {
  const [value, setValue] = useState("");
  const [aiValue, setAiValue] = useState("");
  const [senlerValue, setSenlerValue] = useState("");
  const [senlerGroupId, setSenlerGroupId] = useState("");
  const [vkAdsValue, setVkAdsValue] = useState("");
  useEffect(() => { setVkAdsValue(adAccountId); }, [adAccountId, community?.id]);
  const selectedConnection = community ? connections.find((item) => item.id === community.id) : null;
  const vkCredentialNeedsRecovery = selectedConnection?.credentialAvailable === false;
  return <div className="settingsPage">
    <div className="introRow"><div><h2>Подключение ВКонтакте</h2><p>Токен нужен для чтения истории сообщений от имени сообщества.</p></div></div>
    <div className="settingsGrid">
      <article className="card connectionCard">
        <div className="stepLabel">ШАГ 1 · ТОКЕН СООБЩЕСТВА</div>
        <h3>{connections.length ? "Подключённые сообщества" : "Вставьте токен доступа"}</h3>
        {connections.length > 0 && <div className="connectedList">
          {connections.map((item) => <button key={item.id} className={community?.id === item.id ? "connectedChoice active" : "connectedChoice"} onClick={() => onSelect(item)}>
            <span className="communityIcon">VK</span><span><b>{item.name}</b><small>ID {item.id}{item.credentialAvailable === false ? " · токен требует восстановления" : ""}</small></span><i>{item.credentialAvailable === false ? "!" : community?.id === item.id ? "●" : "○"}</i>
          </button>)}
        </div>}
        {vkCredentialNeedsRecovery && <div className="warningBox"><b>Нужно восстановить токен VK</b><span>Старое сообщество и отчёт сохранены. Вставьте новый или прежний токен этого же сообщества — после этого можно сразу открывать сообщения старых диалогов.</span></div>}
        <label className="tokenLabel">{vkCredentialNeedsRecovery ? "Токен выбранного сообщества" : connections.length ? "Добавить ещё одно сообщество" : "API-токен"}<input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="vk1.a.…" /></label>
        <button className="primary wide" disabled={busy || value.length < 10} onClick={() => onConnect(value.trim())}>{busy ? "Проверяю доступ…" : vkCredentialNeedsRecovery ? "Восстановить подключение →" : connections.length ? "Добавить сообщество →" : "Проверить и подключить →"}</button>
        {community && <button className="dangerButton" onClick={onDisconnect}>Удалить выбранное сообщество</button>}
        <p className="securityNote">Токен шифруется и сохраняется в вашем аккаунте. Подключение восстановится после входа с другого устройства. Данные не попадают в GitHub.</p>
      </article>
      <article className="card instructionCard">
        <div className="stepLabel">КАК ПОЛУЧИТЬ ТОКЕН</div>
        <ol><li>Откройте своё сообщество ВКонтакте.</li><li>Перейдите в <b>Управление → Работа с API</b>.</li><li>Создайте ключ доступа с правом <b>«Сообщения сообщества»</b>.</li><li>Скопируйте ключ и вставьте его в поле слева.</li></ol>
        <div className="warningBox"><b>Важно</b><span>Не отправляйте токен в сообщения и не добавляйте его в репозиторий. При подозрении на утечку удалите ключ в настройках VK.</span></div>
      </article>
      <article className="card connectionCard openaiCard">
        <div className="stepLabel">ШАГ 2 · ROUTER CHEAP</div>
        <h3>{openaiConnected ? "Router Cheap подключён" : "Подключите искусственный интеллект"}</h3>
        {openaiConnected ? <>
          <div className="connectedBox"><span className="openaiIcon">AI</span><div><b>Смысловой анализ активен</b><small>Намерения, цели, нюансы и рекомендации</small></div><i>●</i></div>
          <button className="dangerButton" onClick={onDisconnectOpenAI}>Отключить Router Cheap</button>
        </> : <>
          <label className="tokenLabel">API-ключ Router Cheap<input type="password" autoComplete="off" value={aiValue} onChange={(e) => setAiValue(e.target.value)} placeholder="Вставьте ключ из router.cheap" /></label>
          <button className="primary wide" disabled={busy || aiValue.length < 20} onClick={() => onConnectOpenAI(aiValue.trim())}>{busy ? "Проверяю ключ…" : "Проверить и подключить →"}</button>
          <p className="securityNote">Вставьте API-ключ из кабинета router.cheap — без слова Bearer и без кавычек. Ключ хранится в базе только в зашифрованном виде и доступен после входа в ваш аккаунт.</p>
        </>}
      </article>
      <article className="card connectionCard">
        <div className="stepLabel">РЕКЛАМНЫЙ КАБИНЕТ VK ADS</div>
        <h3>{adAccountId ? "Кабинет подключён к выбранному сообществу" : "Выберите кабинет из дашборда"}</h3>
        <p>Для каждого сообщества можно выбрать свой кабинет. В отчёт попадут только диалоги с метками его объявлений.</p>
        <label className="tokenLabel">Кабинет для {community?.name || "сообщества"}<select value={vkAdsValue} onChange={(e) => setVkAdsValue(e.target.value)} disabled={!community || busy}>
          <option value="">Не выбран</option>
          {adAccounts.map((item) => <option key={item.projectId} value={item.accountId} disabled={!item.sourcesAvailable}>{item.name} · ID {item.accountId}{item.adDetailAvailable ? "" : " · пока только группы"}</option>)}
        </select></label>
        <button className="primary wide" disabled={busy || !community || vkAdsValue === adAccountId} onClick={() => onConnectVkAds(vkAdsValue)}>{busy ? "Сохраняю выбор…" : vkAdsValue === adAccountId && community ? "Выбор сохранён ✓" : "Сохранить выбор →"}</button>
        <p className="securityNote">Все кабинеты берутся из вашего дашборда. Если там пока сохранены только группы, метки отдельных объявлений появятся в сверке после синхронизации их ID.</p>
        {adAccounts.some((item) => !item.adDetailAvailable) && <button className="primary wide" disabled={busy} onClick={onSyncMissingAdIds}>{syncingAccounts ? "Обновляю ID объявлений…" : "Обновить ID объявлений всех кабинетов →"}</button>}
      </article>
      <article className="card connectionCard">
        <div className="stepLabel">ШАГ 3 · SENLER</div>
        <h3>{senlerConnected ? "Senler подключён" : "Подключите Senler"}</h3>
        {senlerConnected ? <>
          <div className="connectedBox"><span className="openaiIcon">S</span><div><b>Источник рекламы подключён</b><small>{community?.name || "Выбранное сообщество"}</small></div><i>●</i></div>
          <button className="dangerButton" onClick={onDisconnectSenler}>Отключить Senler</button>
        </> : <>
          <label className="tokenLabel">ID канала Senler<input type="text" inputMode="numeric" autoComplete="off" value={senlerGroupId} onChange={(e) => setSenlerGroupId(e.target.value.replace(/\D/g, ""))} placeholder="Например, 123456" /></label>
          <label className="tokenLabel">API-ключ Senler<input type="password" autoComplete="off" value={senlerValue} onChange={(e) => setSenlerValue(e.target.value)} placeholder="Вставьте ключ из Senler" /></label>
          <button className="primary wide" disabled={busy || !community || !senlerGroupId || senlerValue.length < 10} onClick={() => onConnectSenler(senlerValue.trim(), senlerGroupId)}>{busy ? "Проверяю ключ…" : "Проверить и подключить →"}</button>
          <p className="securityNote">ID канала Senler — внутренний номер канала, а не ID сообщества VK. Его можно скопировать из адресной строки открытого канала в кабинете Senler. Ключ создаётся в Senler: Настройки → Работа с API. Оба значения сохраняются только в зашифрованном виде.</p>
        </>}
      </article>
    </div>
    <article className="card privacyCard"><div><b>Что именно передаётся в ИИ</b><p>До 40 последних сообщений каждого диалога, время и роль отправителя. Телефоны, email, ссылки и VK ID предварительно заменяются обезличенными маркерами.</p></div><div><b>Текущий режим анализа</b><p>Скорость и объём считаются точным алгоритмом, а намерения, цели, качество ответа, нюансы и рекомендации определяет модель через Router Cheap. Ключ хранится в зашифрованном виде.</p></div></article>
  </div>;
}

function pct(value: number, total: number) {
  return total ? Math.round(value / total * 100) : 0;
}

function EmptyState({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) {
  return <div className="emptyState"><span>⌁</span><h3>{title}</h3><p>{text}</p>{action && onClick && <button className="primary" onClick={onClick}>{action}</button>}</div>;
}

function Metric({ label, value, hint, danger, description }: { label: string; value: string; hint?: string; danger?: boolean; description: string }) {
  return <article className="metric"><span>{label}</span><strong className={danger ? "danger" : ""}>{value}</strong><small>{hint}</small><p className="metricDescription">{description}</p></article>;
}

function FunnelRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return <div className="funnelRow"><div><span>{label}</span><b>{value.toLocaleString("ru-RU")} · {pct(value, max)}%</b></div><div className="track"><span style={{ width: `${max ? value / max * 100 : 0}%`, background: color }} /></div></div>;
}

function LossChart({ stats }: { stats: LiveStats }) {
  const values = [
    { label: "Долгий ответ", value: stats.slowResponse, color: "#ff6b4a" },
    { label: "Нет следующего шага", value: stats.noNextStep, color: "#775cff" },
    { label: "Нет ответа клиенту", value: stats.unanswered, color: "#f5b82e" },
  ];
  const max = Math.max(1, ...values.map((item) => item.value));
  return <article className="card chartCard"><div className="chartTitle"><div><span>ТЕКУЩИЕ ПОТЕРИ</span><h3>Причины риска</h3></div><b>{stats.lost}</b></div><div className="barChart">{values.map((item) => <div className="barItem" key={item.label}><div><span>{item.label}</span><b>{item.value} · {pct(item.value, stats.replies ?? stats.dialogs)}%</b></div><div><i style={{ width: `${item.value / max * 100}%`, background: item.color }} /></div></div>)}</div><p>Доли рассчитаны от переписок с ответом клиента. Один диалог может попадать сразу в несколько категорий.</p></article>;
}

function OptimizationChart({ stats }: { stats: LiveStats }) {
  return <article className="card chartCard optimization"><div className="chartTitle"><div><span>ЧТО ПРОВЕРИТЬ</span><h3>Действия для команды</h3></div></div><ul><li>ответить на {stats.unanswered} сообщений, оставшихся без ответа;</li><li>проверить {stats.slowResponse} диалогов с ответом дольше 15 минут;</li><li>добавить следующий шаг в {stats.noNextStep} диалогах с интересом.</li></ul><p>Это количество диалогов с признаками риска. Рост продаж из него автоматически не следует.</p></article>;
}

function NewDialogsChart({ stats }: { stats: LiveStats }) {
  const points = stats.dailyNew;
  const max = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  return <article className="card chartCard dailyChart"><div className="chartTitle"><div><span>ДИНАМИКА ПО ДНЯМ</span><h3>Новые диалоги</h3></div><b>{total}</b></div>
    {points.length ? <div className="dailyBars">{points.map((point) => <div key={point.date} title={`${point.date}: ${point.count}`}><i style={{ height: `${Math.max(5, point.count / max * 100)}%` }} /><span>{new Date(`${point.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span></div>)}</div> : <div className="noChartData">В выбранном периоде не найдено диалогов, начатых впервые.</div>}
    <p>Новым считается диалог, первое сообщение за всю историю которого попало в выбранный период.</p>
  </article>;
}

function ObjectionsChart({ stats }: { stats: LiveStats }) {
  const max = Math.max(1, ...stats.objections.map((item) => item.count));
  const priorityText = stats.priority === "speed"
    ? "Главный приоритет — скорость: задержек больше, чем диалогов с распознанными возражениями."
    : stats.priority === "objections"
      ? "Главный приоритет — отработка возражений: они встречаются чаще длительных задержек."
      : "Приоритеты равны: скорость ответа и отработку возражений нужно улучшать параллельно.";
  return <article className="card chartCard objectionChart"><div className="chartTitle"><div><span>ГЛАВНЫЕ ВОЗРАЖЕНИЯ</span><h3>Что останавливает клиентов</h3></div><b>{stats.objectionDialogs}</b></div>
    {stats.objections.length ? <div className="objectionBars">{stats.objections.slice(0, 5).map((item) => <div key={item.key}><span>{item.label}</span><i><em style={{ width: `${item.count / max * 100}%` }} /></i><b>{item.count}</b></div>)}</div> : <div className="noChartData">Явные типовые возражения в текстах не найдены.</div>}
    <div className={`priorityNote ${stats.priority}`}><b>Что важнее сейчас</b><span>{priorityText}</span></div>
  </article>;
}

function ProblemCard({ number, color, title, count, total, text }: { number: string; color: string; title: string; count: number; total: number; text: string }) {
  return <article className="problem"><span className="problemNo">{number}</span><div className="problemDot" style={{ background: color }} /><h3>{title}</h3><p>{text}</p><div><b>{count}</b><span>диалогов</span><b>{pct(count, total)}%</b><span>от всех диалогов</span></div></article>;
}

function DialogsTable({ query, setQuery, filteredDialogs, analyzed, communityId, accessToken }: { query: string; setQuery: (v: string) => void; filteredDialogs: LiveDialog[]; analyzed: boolean; communityId: number | null; accessToken: string }) {
  const [selected, setSelected] = useState<LiveDialog | null>(null);
  const [messages, setMessages] = useState<EvidenceMessage[]>([]);
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detailError, setDetailError] = useState("");
  const [truncated, setTruncated] = useState(false);
  async function openDialog(dialog: LiveDialog) {
    if (!communityId || !accessToken) return;
    setSelected(dialog); setMessages([]); setDetailStatus("loading"); setDetailError("");
    try {
      const response = await fetch(`/api/vk/senler-dialogs?communityId=${communityId}&peerId=${dialog.peerId}`, {
        headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const result = await response.json() as { messages?: EvidenceMessage[]; truncated?: boolean; error?: string };
      if (!response.ok || !Array.isArray(result.messages)) throw new Error(result.error || "VK не вернул переписку");
      setMessages(result.messages); setTruncated(Boolean(result.truncated)); setDetailStatus("ready");
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Переписка недоступна"); setDetailStatus("error");
    }
  }
  if (!analyzed) return <div className="pageBlock"><EmptyState title="Диалоги ещё не анализировались" text="Сначала запустите полный анализ на странице «Обзор»." /></div>;
  return <div className="pageBlock">
    <div className="introRow"><div><h2>Разобранные диалоги</h2><p>Статус показывает риск по формальным признакам и не является подтверждённым исходом продажи.</p></div><input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, статус или причина" /></div>
    <div className="statusLegend">
      <span><i className="legendSuccess" /> <b>Успешно</b> — найдено целевое действие</span>
      <span><i className="legendRisk" /> <b>Риск</b> — интерес есть, цель не найдена</span>
      <span><i className="legendLost" /> <b>Потерян</b> — цель не найдена и последнее сообщение осталось без ответа</span>
    </div>
    <div className="tableCard">{filteredDialogs.map((d) => <div className="dialogRow liveRow aiDialogRow clickableDialogRow" key={d.peerId} role="button" tabIndex={0} aria-label={`Открыть переписку, диалог ${d.peerId}`} onClick={() => openDialog(d)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDialog(d); } }}><span className="avatar">VK</span><div><b>Диалог #{d.peerId}</b><small>{d.adId ? `Рекламная метка: ${d.adId}` : d.intent || "Намерение не определено"}</small><small className="dialogOpenHint">Открыть переписку →</small></div><span className={`badge ${d.status}`}>{d.status}</span><div><small>Оценка ИИ · уверенность {d.confidence || 0}%</small><b>{d.score}/100</b></div><div className="issueCell"><small>Вывод ИИ</small><b>{d.issue}</b><small>{d.nuance}</small></div><div className="aiAdvice"><small>Как улучшить</small><b>{d.recommendation}</b>{d.betterReply && <em>Пример ответа: «{d.betterReply}»</em>}</div></div>)}</div>
    {selected && <div className="adDialogOverlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
      <aside className="adDialogPanel" role="dialog" aria-modal="true" aria-label={`Диалог ${selected.peerId}`}><div className="adDialogPanelHead"><div><span>ПРОВЕРКА КЛАССИФИКАЦИИ</span><h3>Диалог #{selected.peerId}</h3><p>{selected.issue} Контактные данные скрыты.</p></div><button onClick={() => setSelected(null)} aria-label="Закрыть переписку">×</button></div>
        {detailStatus === "loading" && <div className="adDialogLoading">Загружаю переписку из VK…</div>}
        {detailStatus === "error" && <div className="adDialogLoading error">{detailError}</div>}
        {detailStatus === "ready" && <div className="conversationTranscript"><strong>Переписка · {messages.length} сообщений</strong>{truncated && <p>Показаны последние 1000 сообщений.</p>}{messages.map((message, index) => <div className="conversationEntry" key={index}><b>{message.role} · {message.date}</b><p>{message.text}</p></div>)}</div>}
      </aside>
    </div>}
  </div>;
}

function SenlerConversationList({ conversations, communityId, accessToken }: { conversations: SenlerConversation[]; communityId: number | null; accessToken: string }) {
  const [selected, setSelected] = useState<SenlerConversation | null>(null);
  const [messages, setMessages] = useState<EvidenceMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  async function openConversation(item: SenlerConversation) {
    if (!communityId || !accessToken) return;
    setSelected(item); setMessages([]); setStatus("loading"); setError("");
    try {
      const response = await fetch(`/api/vk/senler-dialogs?communityId=${communityId}&peerId=${item.peerId}`, {
        headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const result = await response.json() as { messages?: EvidenceMessage[]; truncated?: boolean; error?: string };
      if (!response.ok || !Array.isArray(result.messages)) throw new Error(result.error || "VK не вернул переписку");
      setMessages(result.messages); setTruncated(Boolean(result.truncated)); setStatus("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Переписка недоступна"); setStatus("error"); }
  }
  const groups = [...conversations.reduce((byPage, item) => {
    const group = byPage.get(item.subscriptionId) || [];
    group.push(item);
    byPage.set(item.subscriptionId, group);
    return byPage;
  }, new Map<string, SenlerConversation[]>())].sort((a, b) => b[1].length - a[1].length);
  return <article className="card attributionCard">
    <b>Переписки подписчиков Senler</b>
    <p>Показаны люди, подписавшиеся на страницу, которая указана в объявлениях выбранного кабинета, и имеющие переписку с сообществом. Если у подписки нет ID объявления, её источник остаётся неподтверждённым.</p>
    {!conversations.length && <p>Переписки таких подписчиков в VK не найдены.</p>}
    {!!groups.length && <div className="senlerPageGroups">{groups.map(([subscriptionId, pageConversations]) => <details className="senlerPageGroup" key={subscriptionId}>
      <summary><span>Страница Senler #{subscriptionId}</span><span>{pageConversations.length} переписок · {pageConversations.filter((item) => item.clientReplied).length} с ответом клиента</span></summary>
      <div className="adDialogList">{pageConversations.map((item) => <article className={`adDialogCard ${item.clientReplied === true ? "senlerWithReply" : item.clientReplied === false ? "senlerWithoutReply" : ""}`} key={item.peerId}>
      <div className="adDialogMeta"><div><b>Диалог #{item.peerId}</b><small>Подписка {item.date || "дата неизвестна"}</small></div>{item.clientReplied !== undefined && <span className="senlerReplyStatus">{item.clientReplied ? "Клиент ответил" : "Клиент не ответил"}</span>}</div>
      <p>{item.adId ? `Метка объявления VK: ${item.adId}.` : "ID объявления в подписке и переписке не подтверждён."} {item.recent ? "В периоде есть сообщения." : "Последняя активность могла быть раньше выбранного периода."}</p>
      <button className="adDialogOpen" onClick={() => openConversation(item)}>Открыть переписку →</button>
      </article>)}</div>
    </details>)}</div>}
    {selected && <div className="adDialogOverlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
      <aside className="adDialogPanel"><div className="adDialogPanelHead"><div><span>ПРОВЕРКА ПОДПИСКИ SENLER</span><h3>Диалог #{selected.peerId}</h3><p>Страница Senler #{selected.subscriptionId}. Телефоны и ссылки скрыты. Источник объявления указан только при подтверждённой метке.</p></div><button onClick={() => setSelected(null)}>×</button></div>
        {status === "loading" && <div className="adDialogLoading">Загружаю переписку из VK…</div>}
        {status === "error" && <div className="adDialogLoading error">{error}</div>}
        {status === "ready" && <div className="conversationTranscript"><strong>Переписка · {messages.length} сообщений</strong>{truncated && <p>Показаны последние 1000 сообщений.</p>}{messages.map((message, index) => <div className="conversationEntry" key={index}><b>{message.role} · {message.date}</b><p>{message.text}</p></div>)}</div>}
      </aside>
    </div>}
  </article>;
}

function AdsDashboard({ stats, dialogs, serverAds, serverDialogTotal, serverStatus, serverError, cabinet, accessToken, communityId, onAnalyze }: { stats: LiveStats | null; dialogs: LiveDialog[]; serverAds: AdStat[]; serverDialogTotal: number; serverStatus: "idle" | "loading" | "ready" | "error"; serverError: string; cabinet: AdCabinet | null; accessToken: string; communityId: number | null; onAnalyze: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailDialogs, setDetailDialogs] = useState<AdDialogDetail[]>([]);
  const [detailLoadingMore, setDetailLoadingMore] = useState(false);
  const [expandedPeerId, setExpandedPeerId] = useState<number | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<EvidenceMessage[]>([]);
  const [expandedStatus, setExpandedStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [expandedError, setExpandedError] = useState("");
  const [expandedTruncated, setExpandedTruncated] = useState(false);

  const purchaseOf = (dialog: LiveDialog) => dialog.purchase ?? (Boolean(dialog.goalReached ?? dialog.status === "Успешно") && /(покуп|оплат|билет|приобр)/i.test(`${dialog.goal || ""} ${dialog.issue || ""}`));
  const derivedAds = dialogs.reduce<Record<string, AdStat>>((result, dialog) => {
    if (!dialog.adId) return result;
    const current = result[dialog.adId] || { adId: dialog.adId, dialogs: 0, replies: 0, leads: 0, targets: 0, purchases: 0, phones: 0, lost: 0, scoreSum: 0 };
    current.dialogs += 1;
    current.replies = (current.replies || 0) + Number(dialog.hasClientMessage !== false);
    current.leads += Number(dialog.hasClientMessage !== false && dialog.status !== "Не лид");
    current.targets += Number(dialog.goalReached ?? dialog.status === "Успешно");
    current.purchases = (current.purchases || 0) + Number(purchaseOf(dialog));
    current.phones = (current.phones || 0) + Number(Boolean(dialog.metrics?.hasPhone));
    current.lost += Number(dialog.status === "Потерян");
    current.scoreSum += dialog.hasClientMessage === false ? 0 : dialog.score || 0;
    result[dialog.adId] = current;
    return result;
  }, {});
  const ads = serverStatus === "ready" ? serverAds : serverStatus === "error" ? [] : Array.isArray(stats?.ads) && stats.ads.length ? stats.ads : Object.values(derivedAds).sort((a,b)=>b.dialogs-a.dialogs);
  const selectedAd = selectedAdId ? ads.find((ad)=>ad.adId===selectedAdId) : null;

  function sourceTitle(ad: AdStat) {
    if (ad.adId.startsWith("vk_ads:")) return `Рекламная метка «${ad.adId.slice(7)}»`;
    if (!ad.matched) return `Метка ${ad.adId}`;
    if (ad.matchType === "campaign") return `Кампания «${ad.campaignName || ad.adId}»`;
    if (ad.matchType === "group") return `Группа «${ad.groupName || ad.adId}»`;
    return ad.adName || `Объявление #${ad.adId}`;
  }

  async function openAdDialogs(adId: string) {
    setSelectedAdId(adId); setDetailStatus("loading"); setDetailError(""); setDetailDialogs([]); setDetailTotal(0); setExpandedPeerId(null);
    if (!communityId || !accessToken) {
      setDetailError("Не удалось определить активное сообщество или вход в аккаунт. Обновите страницу.");
      setDetailStatus("error");
      return;
    }
    try {
      const response = await fetch(`/api/ads/dialogs?communityId=${communityId}&adId=${encodeURIComponent(adId)}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const result = await response.json() as { dialogs?: AdDialogDetail[]; total?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить примеры диалогов");
      setDetailDialogs(result.dialogs || []); setDetailTotal(result.total || 0); setDetailStatus("ready");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Не удалось загрузить примеры диалогов"); setDetailStatus("error");
    }
  }

  async function loadMoreDialogs() {
    if (!communityId || !accessToken || !selectedAdId || detailLoadingMore) return;
    setDetailLoadingMore(true);
    try {
      const response = await fetch(`/api/ads/dialogs?communityId=${communityId}&adId=${encodeURIComponent(selectedAdId)}&offset=${detailDialogs.length}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const result = await response.json() as { dialogs?: AdDialogDetail[]; total?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить диалоги");
      setDetailDialogs((current) => [...current, ...(result.dialogs || [])]);
      setDetailTotal(result.total || 0);
      setDetailError("");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Не удалось загрузить диалоги");
    } finally {
      setDetailLoadingMore(false);
    }
  }

  async function openFullDialog(peerId: number) {
    if (!communityId || !accessToken || !selectedAdId) return;
    panelRef.current?.scrollTo(0, 0);
    setExpandedPeerId(peerId); setExpandedMessages([]); setExpandedStatus("loading"); setExpandedError("");
    try {
      const response = await fetch(`/api/ads/dialogs?communityId=${communityId}&adId=${encodeURIComponent(selectedAdId)}&peerId=${peerId}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const result = await response.json() as { messages?: EvidenceMessage[]; truncated?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить переписку");
      setExpandedMessages(result.messages || []); setExpandedTruncated(Boolean(result.truncated)); setExpandedStatus("ready");
    } catch (error) {
      setExpandedError(error instanceof Error ? error.message : "Не удалось загрузить переписку"); setExpandedStatus("error");
    }
  }

  const selectedDialog = expandedPeerId === null ? null : detailDialogs.find((dialog) => dialog.peerId === expandedPeerId) || null;
  const visibleMessages = selectedDialog && expandedStatus === "ready" && expandedMessages.length ? expandedMessages : selectedDialog?.messages || [];
  const messageList = (messages: EvidenceMessage[]) => <div className="conversationMessages">{messages.map((message, index) => <div className={message.role === "Менеджер" ? "conversationMessage manager" : "conversationMessage client"} key={index}><div><b>{message.role}</b><small>{message.date}</small></div><p>{message.text}</p></div>)}</div>;
  const panel = selectedAdId && <div className="adDialogOverlay" onMouseDown={(e)=>{ if(e.currentTarget===e.target) setSelectedAdId(null); }}>
    <aside className="adDialogPanel" ref={panelRef}>
      <div className="adDialogPanelHead"><div><span>ПРОВЕРКА КЛАССИФИКАЦИИ</span><h3>{selectedAd ? sourceTitle(selectedAd) : selectedAdId}</h3><p>Откройте переписку, чтобы проверить вывод по сообщениям. Телефоны и ссылки скрыты.</p></div><button onClick={()=>setSelectedAdId(null)}>×</button></div>
      {selectedDialog ? <div className="adFullDialog">
        <button className="adDialogBack" onClick={() => { setExpandedPeerId(null); panelRef.current?.scrollTo(0, 0); }}>← К списку диалогов</button>
        <h3>Диалог #{selectedDialog.peerId}</h3>
        <p>{selectedDialog.status} · качество {selectedDialog.score}/100 · покупка: {selectedDialog.purchase ? "да" : "нет"} · телефон: {selectedDialog.phone ? "да" : "нет"}</p>
        <div className="adDialogConclusion">
          <b>Классификация:</b> {[selectedDialog.goal, selectedDialog.issue].filter(Boolean).join(" · ") || "Не определена"}
          <div className="conversationTranscript">
            <strong>Переписка · {visibleMessages.length} сообщений</strong>
            {expandedStatus === "loading" && <p>Загружаю полную историю из VK; сохранённые сообщения уже показаны.</p>}
            {expandedStatus === "error" && <p>{expandedError} Показаны сохранённые сообщения.</p>}
            {expandedStatus === "ready" && expandedTruncated && <p>Показаны последние 1000 сообщений. Более ранние сообщения не загружены.</p>}
            {visibleMessages.length ? visibleMessages.map((message, index) => <div className="conversationEntry" key={index}><b>{message.role} · {message.date}</b><p>{message.text}</p></div>) : <p>В VK и сохранённом отчёте нет доступных сообщений этой переписки.</p>}
          </div>
        </div>
      </div> : <>
      {detailStatus==="loading" && <div className="adDialogLoading">Загружаю фрагменты переписок из VK…</div>}
      {detailStatus==="error" && <div className="adDialogLoading error">{detailError}</div>}
      {detailStatus==="ready" && !detailDialogs.length && <div className="adDialogLoading">Связанные диалоги не найдены.</div>}
      {detailStatus==="ready" && detailDialogs.length>0 && <><div className="adDialogCount">Показано {detailDialogs.length} из {detailTotal} связанных диалогов</div><div className="adDialogList">{detailDialogs.map((d)=><article className="adDialogCard" key={d.peerId}>
        <div className="adDialogMeta"><div><b>Диалог #{d.peerId}</b><small>{d.status}{d.status === "Нет ответа клиента" ? " · качество не оценивается" : ` · качество ${d.score}/100`}</small></div><div className="adDialogFlags"><span className={d.purchase == null ? "unknown" : d.purchase ? "yes" : "no"}>Покупка по анализу: {d.purchase == null ? "нет данных" : d.purchase ? "да" : "нет"}</span><span className={d.phone == null ? "unknown" : d.phone ? "yes" : "no"}>Телефон по анализу: {d.phone == null ? "нет данных" : d.phone ? "да" : "нет"}</span></div></div>
        {(d.goal||d.issue)&&<div className="adDialogConclusion"><b>Классификация:</b> {[d.goal,d.issue].filter(Boolean).join(" · ")}</div>}
        <button className="adDialogOpen" onClick={()=>openFullDialog(d.peerId)}>Открыть переписку →</button>
        {d.messages.length ? messageList(d.messages) : <div className="adEvidenceMissing">Фрагмент отсутствует в сохранённом отчёте. Откройте переписку, чтобы загрузить её из VK.</div>}
      </article>)}</div>{detailError && <div className="adDialogLoading error">{detailError}</div>}{detailDialogs.length < detailTotal && <button className="adDialogOpen" disabled={detailLoadingMore} onClick={loadMoreDialogs}>{detailLoadingMore ? "Загружаю…" : "Показать ещё диалоги"}</button>}</>}
      </>}
    </aside>
  </div>;

  if (serverStatus === "loading" || serverStatus === "error" || serverStatus === "ready") return <div className="pageBlock adsPage">
    <div className="introRow"><div><p className="eyebrow">АТРИБУЦИЯ VK РЕКЛАМЫ · v3.1</p><h2>Какие источники привели обращения</h2><p>Нажмите на источник, чтобы открыть примеры диалогов и проверить классификацию.</p></div></div>
    {serverStatus==="ready"&&<div className="adDataState">Кабинет VK Ads · ID {cabinet?.accountId}. В таблице только его источники.{cabinet?.source === "dashboard-groups" ? " В дашборде пока есть только ID групп: метки отдельных объявлений не удастся подтвердить до их синхронизации." : ""}</div>}
    {serverStatus==="loading"&&<div className="adDataState">Загружаю статистику объявлений…</div>}
    {serverStatus==="error"&&<div className="adDataState error">Не удалось сверить источники: {serverError}. Сохранённые числа доступны ниже.</div>}
    {ads.length>0&&serverStatus!=="loading"&&<>
      <div className="adDataState success">Загружено: {ads.length} рекламных источников · {ads.reduce((s,a)=>s+a.dialogs,0)} переписок с меткой · {ads.reduce((s,a)=>s+(a.replies ?? a.dialogs),0)} с ответом клиента · {ads.reduce((s,a)=>s+(a.subscriptions || 0),0)} подписок Senler с точным ID объявления · {ads.reduce((s,a)=>s+(a.vkResults || 0),0)} результатов VK Ads Mini App</div>
      <p className="adDefinitions">Все переписки с рекламной меткой включены. «Ответ клиента» отделяет реальные обращения от рассылок без отклика; ИИ оценивает содержание только после ответа. Покупка и телефон подтверждаются перепиской. Качество рассчитано по перепискам с ответом клиента.</p>
      <div className="simpleAdsTable"><table><thead><tr><th>Источник / объявление VK</th><th>С меткой</th><th>Подписки Senler</th><th>Результаты VK Ads</th><th>Ответ клиента</th><th>Интерес</th><th>Запись / покупка</th><th>Покупка</th><th>Телефон</th><th>Потеряны</th><th>Качество</th></tr></thead><tbody>
      {ads.map((ad)=>{const replied=ad.replies ?? ad.dialogs;const q=replied?Math.round(ad.scoreSum/replied):0;return <tr key={ad.adId}><td className="adIdentity"><button className="adIdentityButton" onClick={()=>openAdDialogs(ad.adId)}><b>{sourceTitle(ad)}</b><small>{ad.matched?(ad.matchType==="campaign"?`ID кампании: ${ad.adId}`:ad.matchType==="group"?`ID группы: ${ad.adId}`:`ID объявления: ${ad.adId}${ad.groupId?` · группа ${ad.groupName || ad.groupId}`:""}${ad.campaignId?` · кампания ${ad.campaignName || ad.campaignId}`:""}`):(ad.lookupUnavailable?ad.lookupReason||"Кабинет VK Ads не ответил":"ID не найден в выбранном кабинете VK Ads.")}</small><em>{ad.dialogs ? "Открыть диалоги →" : "Переписок пока нет"}</em></button></td><td>{ad.dialogs}</td><td>{ad.subscriptions || 0}</td><td>{ad.vkResults ?? "—"}</td><td>{replied} · {pct(replied,ad.dialogs)}%</td><td>{ad.leads} · {pct(ad.leads,replied)}%</td><td>{ad.targets} · {pct(ad.targets,replied)}%</td><td>{ad.purchases == null ? "—" : `${ad.purchases} · ${pct(ad.purchases,replied)}%`}</td><td>{ad.phones == null ? "—" : `${ad.phones} · ${pct(ad.phones,replied)}%`}</td><td>{ad.lost} · {pct(ad.lost,replied)}%</td><td>{replied?<b>{q}/100</b>:"—"}</td></tr>})}
      </tbody></table></div>
    </>}
    {panel}
  </div>;

  if (!stats && !ads.length) return <div className="pageBlock adsPage"><div className="introRow"><div><p className="eyebrow">АТРИБУЦИЯ VK РЕКЛАМЫ · v3.1</p><h2>Качество диалогов по объявлениям</h2></div><button className="primary" onClick={onAnalyze}>Запустить анализ →</button></div></div>;

  return <div className="pageBlock adsPage"><div className="introRow"><div><p className="eyebrow">АТРИБУЦИЯ VK РЕКЛАМЫ · v3.1</p><h2>Качество диалогов по объявлениям</h2></div></div><div className="adsTable card">
    <div className="adsHead"><span>Источник VK</span><span>Диалоги</span><span>Интерес</span><span>Покупка</span><span>Телефон</span><span>Потеряны</span><span>Качество</span></div>
    {ads.map((ad)=>{const q=ad.dialogs?Math.round(ad.scoreSum/ad.dialogs):0;return <div className="adsRow" key={ad.adId}><button className="adSourceCell" onClick={()=>openAdDialogs(ad.adId)}><span className="adSource">Из VK Рекламы</span><b>#{ad.adId}</b><small>Открыть диалоги →</small></button><strong>{ad.dialogs}</strong><div><b>{ad.leads}</b><small>{pct(ad.leads,ad.dialogs)}%</small></div><div><b>{ad.purchases == null ? "—" : ad.purchases}</b><small>{ad.purchases == null ? "старый отчёт" : `${pct(ad.purchases,ad.dialogs)}%`}</small></div><div><b>{ad.phones == null ? "—" : ad.phones}</b><small>{ad.phones == null ? "старый отчёт" : `${pct(ad.phones,ad.dialogs)}%`}</small></div><div className={ad.lost?"adLost":""}><b>{ad.lost}</b><small>{pct(ad.lost,ad.dialogs)}%</small></div><div className="qualityCell"><b>{q}/100</b><i><em style={{width:`${q}%`}} /></i></div></div>})}
  </div>{panel}</div>;
}

function Quality({ stats }: { stats: LiveStats | null }) {
  if (!stats) return <div className="pageBlock"><EmptyState title="Оценка ещё не рассчитана" text="Раздел заполнится фактическими данными после полного анализа." /></div>;
  const speed = Math.max(0, 100 - pct(stats.slowResponse, stats.replies ?? stats.dialogs));
  const nextStep = Math.max(0, 100 - pct(stats.noNextStep, stats.leads));
  const replies = Math.max(0, 100 - pct(stats.unanswered, stats.replies ?? stats.dialogs));
  const total = Math.round((speed + nextStep + replies) / 3);
  return <div className="pageBlock"><div className="introRow"><div><h2>Качество обработки диалогов</h2><p>Расчёт основан на трёх проверяемых показателях. Тон и полнота ответов без смысловой ИИ-модели не оцениваются.</p></div></div><div className="qualityGrid"><div className="scoreCard"><span>Сводный индекс</span><b>{total}</b><small>из 100</small><div className="scoreRing">{total >= 80 ? "Хороший уровень" : "Нужно внимание"}</div></div><div className="card rubric">{[["Скорость ответа · доля без задержек свыше 15 минут", speed], ["Следующий шаг · доля целевых обращений без обрыва", nextStep], ["Ответ клиенту · доля диалогов без пропущенного последнего сообщения", replies]].map(([x, n]) => <FunnelRow key={x} label={String(x)} value={Number(n)} max={100} color={Number(n) > 80 ? "#40b78a" : Number(n) > 65 ? "#775cff" : "#ff6b4a"} />)}</div></div></div>;
}

function Bot({ goal }: { goal?: string }) {
  return <div className="pageBlock"><div className="botHero"><div><p className="eyebrow">ЧЕСТНАЯ РЕКОМЕНДАЦИЯ</p><h2>Бот снимет рутину.<br/>Сложные решения оставит людям.</h2><p>Он отвечает без задержки, квалифицирует клиента, собирает исходные данные и передаёт менеджеру диалог вместе с кратким резюме.</p><button className="primary">Настроить пилот →</button></div><div className="botOrb">✦<span>ИИ</span></div></div><div className="splitCards"><article className="card can"><span>МОЖЕТ ЗАКРЫТЬ</span>{["Ответ 24/7 за несколько секунд", "FAQ и типовые возражения", "Сбор необходимых данных клиента", goal ? `Доведение до этапа «${goal}»` : "Доведение до найденного целевого действия", "Повторное касание по инструкции"].map(x => <p key={x}>✓ {x}</p>)}</article><article className="card cannot"><span>ПЕРЕДАЁТ ЧЕЛОВЕКУ</span>{["Уникальные технические расчёты", "Конфликтные и юридические ситуации", "Нестандартные скидки и условия", "Вопросы с низкой уверенностью ИИ", "Сверхиндивидуальная консультация"].map(x => <p key={x}>→ {x}</p>)}</article></div></div>;
}
