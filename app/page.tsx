"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Period = "30" | "60" | "90";
type Community = { id: number; name: string; photo: string | null };
type LiveDialog = { peerId: number; score: number; status: string; issue: string; intent?: string; goal?: string; nuance?: string; recommendation?: string; betterReply?: string; confidence?: number; objections?: string[] };
type LiveStats = {
  dialogs: number; leads: number; contacts: number; targets: number; lost: number;
  averageResponse: number; recoverableLow: number; recoverableHigh: number;
  goal: string; growth: number | null; slowResponse: number; noNextStep: number; unanswered: number;
  responseMeasured: boolean;
  objections: Array<{ key: string; label: string; count: number }>;
  objectionDialogs: number;
  dailyNew: Array<{ date: string; count: number }>;
  priority: "speed" | "objections" | "balanced";
  ai: { model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; nuances: string[]; recommendations: string[] };
};

export default function Home() {
  const [period, setPeriod] = useState<Period>("30");
  const [tab, setTab] = useState("Обзор");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [token, setToken] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [community, setCommunity] = useState<Community | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [liveDialogs, setLiveDialogs] = useState<LiveDialog[]>([]);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
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
      setLiveStats(null);
      setLiveDialogs([]);
      setNotice(`Подключено сообщество «${result.community.name}». Токен используется только в текущей сессии и не записывается в GitHub.`);
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
      const response = await fetch("/api/openai/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: value }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось подключить OpenAI");
      setOpenaiKey(value);
      setNotice("OpenAI подключён. Ключ действует только в текущей вкладке и не сохраняется в GitHub или базе.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка подключения OpenAI");
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis() {
    if (!community || !token) {
      setTab("Настройки");
      setNotice("Сначала подключите сообщество ВКонтакте.");
      return;
    }
    if (!openaiKey) {
      setTab("Настройки");
      setNotice("Подключите OpenAI в разделе «Настройки», затем запустите анализ ещё раз.");
      return;
    }
    setBusy(true);
    setLiveStats(null);
    setLiveDialogs([]);
    setProgress({ processed: 0, total: 0 });
    setNotice(`Загружаю все переписки сообщества «${community.name}» за ${period} дней…`);
    try {
      let offset = 0;
      let done = false;
      const totals = { dialogs: 0, leads: 0, contacts: 0, targets: 0, lost: 0, responseSum: 0, responseCount: 0, slowResponse: 0, noNextStep: 0, unanswered: 0 };
      const goalTotals: Record<string, number> = {};
      const objectionTotals: Record<string, number> = {};
      const dailyTotals: Record<string, number> = {};
      let goalLabels: Record<string, string> = {};
      let objectionLabels: Record<string, string> = {};
      let objectionDialogs = 0;
      const analyzedDialogs: LiveDialog[] = [];
      const aiTotals = { model: "", inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, nuances: [] as string[], recommendations: [] as string[] };
      const aiGoalTotals: Record<string, number> = {};
      while (!done) {
        const response = await fetch("/api/vk/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, openaiKey, groupId: community.id, days: Number(period), offset }),
        });
        const result = await response.json() as {
          stats?: { dialogs: number; leads: number; contacts: number; targets: number; lost: number; responseSum: number; responseCount: number };
          problems?: { slowResponse: number; noNextStep: number; unanswered: number };
          goalCounts?: Record<string, number>; goalLabels?: Record<string, string>;
          objectionCounts?: Record<string, number>; objectionLabels?: Record<string, string>;
          objectionDialogs?: number; dailyNew?: Record<string, number>;
          ai?: { enabled: boolean; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number }; goals: Record<string, number>; nuances: string[]; recommendations: string[] };
          dialogs?: LiveDialog[];
          done?: boolean; nextOffset?: number; totalConversations?: number; error?: string;
        };
        if (!response.ok || !result.stats) throw new Error(result.error || "Анализ не завершён");
        totals.dialogs += result.stats.dialogs;
        totals.leads += result.stats.leads;
        totals.contacts += result.stats.contacts;
        totals.targets += result.stats.targets;
        totals.lost += result.stats.lost;
        totals.responseSum += result.stats.responseSum;
        totals.responseCount += result.stats.responseCount;
        totals.slowResponse += result.problems?.slowResponse || 0;
        totals.noNextStep += result.problems?.noNextStep || 0;
        totals.unanswered += result.problems?.unanswered || 0;
        for (const [key, count] of Object.entries(result.goalCounts || {})) goalTotals[key] = (goalTotals[key] || 0) + count;
        for (const [key, count] of Object.entries(result.objectionCounts || {})) objectionTotals[key] = (objectionTotals[key] || 0) + count;
        for (const [date, count] of Object.entries(result.dailyNew || {})) dailyTotals[date] = (dailyTotals[date] || 0) + count;
        goalLabels = result.goalLabels || goalLabels;
        objectionLabels = result.objectionLabels || objectionLabels;
        objectionDialogs += result.objectionDialogs || 0;
        if (!result.ai?.enabled) throw new Error("ИИ-анализ не запущен: на сервере не подключён OpenAI API.");
        aiTotals.model = result.ai.model;
        aiTotals.inputTokens += result.ai.usage.inputTokens;
        aiTotals.outputTokens += result.ai.usage.outputTokens;
        aiTotals.totalTokens += result.ai.usage.totalTokens;
        aiTotals.estimatedCostUsd += result.ai.usage.estimatedCostUsd;
        aiTotals.nuances.push(...result.ai.nuances);
        aiTotals.recommendations.push(...result.ai.recommendations);
        for (const [goal, count] of Object.entries(result.ai.goals)) aiGoalTotals[goal] = (aiGoalTotals[goal] || 0) + count;
        analyzedDialogs.push(...(result.dialogs || []));
        offset = result.nextOffset ?? offset;
        done = Boolean(result.done);
        setProgress({ processed: totals.dialogs, total: result.totalConversations || 0 });
        setNotice(`Анализ продолжается: обработано ${totals.dialogs} диалогов за выбранный период…`);
      }
      const goalKey = Object.entries(goalTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
      const aiGoal = Object.entries(aiGoalTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
      const recoverableLow = Math.round(totals.lost * 0.25);
      const recoverableHigh = Math.round(totals.lost * 0.55);
      const midpoint = (recoverableLow + recoverableHigh) / 2;
      const growth = totals.targets ? Math.round(midpoint / totals.targets * 100) : null;
      const priority = totals.slowResponse > objectionDialogs * 1.2
        ? "speed" as const
        : objectionDialogs > totals.slowResponse * 1.2
          ? "objections" as const
          : "balanced" as const;
      setLiveStats({
        dialogs: totals.dialogs, leads: totals.leads, contacts: totals.contacts, targets: totals.targets,
        lost: totals.lost, averageResponse: totals.responseCount ? Math.round(totals.responseSum / totals.responseCount) : 0,
        recoverableLow, recoverableHigh, goal: aiGoal || goalLabels[goalKey] || "Целевое действие",
        growth, slowResponse: totals.slowResponse, noNextStep: totals.noNextStep, unanswered: totals.unanswered,
        responseMeasured: totals.responseCount > 0,
        objections: Object.entries(objectionTotals)
          .map(([key, count]) => ({ key, label: objectionLabels[key] || key, count }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count),
        objectionDialogs,
        dailyNew: Object.entries(dailyTotals).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        priority,
        ai: { ...aiTotals, nuances: [...new Set(aiTotals.nuances)].slice(0, 6), recommendations: [...new Set(aiTotals.recommendations)].slice(0, 6) },
      });
      setLiveDialogs(analyzedDialogs);
      setNotice(`Готово: ИИ проанализировал все ${totals.dialogs} активных диалогов за ${period} дней. Использовано ${aiTotals.totalTokens.toLocaleString("ru-RU")} токенов.`);
      setTab("Обзор");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка анализа");
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brandMark">Д</span><span>Диалогика</span></div>
        <nav aria-label="Основная навигация">
          {["Обзор", "Диалоги", "Качество", "ИИ-бот", "Настройки"].map((item) => (
            <button key={item} onClick={() => setTab(item)} className={tab === item ? "navItem active" : "navItem"}>
              <span className="navIcon">{item === "Обзор" ? "⌁" : item === "Диалоги" ? "◫" : item === "Качество" ? "◇" : item === "Настройки" ? "⚙" : "✦"}</span>{item}
            </button>
          ))}
        </nav>
        <div className="sideBottom">
          <div className="community"><span className="communityIcon">VK</span><div><b>{community?.name || "Не подключено"}</b><small>{community ? "Сообщество подключено" : "Реальные данные не загружены"}</small></div><i className={community ? "" : "offline"}>●</i></div>
          <button onClick={() => setTab("Настройки")} className="navItem"><span className="navIcon">⚙</span>Настройки</button>
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
              {(["30", "60", "90"] as Period[]).map((p) => <button key={p} disabled={busy} onClick={() => { setPeriod(p); setLiveStats(null); }} className={period === p ? "selected" : ""}>{p} дней</button>)}
            </div>
          </div>

          {!community && <EmptyState title="Сообщество не подключено" text="Тестовые показатели удалены. Подключите ВКонтакте, чтобы увидеть только реальные данные." action="Подключить ВКонтакте →" onClick={() => setTab("Настройки")} />}
          {community && !liveStats && !busy && <EmptyState title="Готово к анализу" text={`Подключено «${community.name}». Нажмите «Запустить анализ» — будут обработаны все диалоги за выбранные ${period} дней.`} action="Запустить полный анализ →" onClick={runAnalysis} />}
          {busy && <div className="analysisProgress"><div className="spinner">⌁</div><div><b>Идёт полный анализ</b><p>Обработано {progress.processed.toLocaleString("ru-RU")} диалогов. Не закрывайте вкладку до завершения.</p></div></div>}

          {data && liveStats && <>
            <div className="metrics">
              <Metric label="Диалоги за период" value={data.dialogs.toLocaleString("ru-RU")} hint="100% обработанной выборки" description="Уникальные переписки, в которых было хотя бы одно сообщение за выбранный период." />
              <Metric label="Целевой интерес" value={data.leads.toLocaleString("ru-RU")} hint={`${pct(data.leads, data.dialogs)}% от диалогов`} description="Клиент обсуждал цену, товар, срок, макет, доставку или другое условие покупки." />
              <Metric label="Получен телефон" value={data.contacts.toLocaleString("ru-RU")} hint={`${pct(data.contacts, data.leads)}% от целевых`} description="В переписке найден российский номер телефона. Это промежуточный, а не обязательный этап продажи." />
              <Metric label={liveStats.goal} value={data.measurements.toLocaleString("ru-RU")} hint={`${pct(data.measurements, data.leads)}% от целевых`} description="Главное результативное действие определено автоматически по наиболее частому завершению успешных диалогов." />
              <Metric label="Среднее время ответа" value={data.response} danger={liveStats.responseMeasured && liveStats.averageResponse > 300} hint={liveStats.responseMeasured ? "между вопросом и ответом" : "в периоде нет пар вопрос–ответ"} description="Среднее время от первого входящего сообщения клиента до следующего ответа сообщества." />
            </div>

            <div className="gridMain">
              <article className="card funnelCard">
                <div className="cardHead"><div><p className="eyebrow">АВТОМАТИЧЕСКИ НАЙДЕННАЯ ЦЕЛЬ</p><h3>{liveStats.goal}</h3></div><span className="confidence">Определено по фактическим диалогам</span></div>
                <div className="funnel">
                  <FunnelRow label="Все диалоги за период" value={data.dialogs} max={data.dialogs} color="#231f20" />
                  <FunnelRow label="Есть целевой интерес" value={data.leads} max={data.dialogs} color="#775cff" />
                  <FunnelRow label="Передан номер телефона" value={data.contacts} max={data.dialogs} color="#a493ff" />
                  <FunnelRow label={liveStats.goal} value={data.measurements} max={data.dialogs} color="#40b78a" />
                </div>
                <p className="funnelNote"><b>{data.lost} диалогов</b> имеют одновременно три признака: был коммерческий интерес, целевое действие не достигнуто, последнее сообщение осталось за клиентом. Из них ориентировочно <b>{liveStats.recoverableLow}–{liveStats.recoverableHigh}</b> можно было вернуть в работу.</p>
              </article>

              <article className="card lossCard">
                <p className="eyebrow">РАСЧЁТНЫЙ ПОТЕНЦИАЛ</p><div className="lossNumber">{liveStats.growth === null ? "н/д" : `+${liveStats.growth}%`}</div>
                <h3>к текущим целевым действиям</h3>
                <p>За счёт ответа до 5 минут, обязательного следующего шага и повторного касания.</p>
                <div className="estimate"><span>Дополнительно</span><b>+{liveStats.recoverableLow}–{liveStats.recoverableHigh}</b></div>
                <small>{liveStats.growth === null ? "Процент нельзя рассчитать: в периоде не найдено ни одного подтверждённого целевого действия." : "Формула: средняя точка диапазона возвращаемых заявок ÷ текущие целевые действия × 100%. Это сценарная оценка, не гарантия."}</small>
              </article>
            </div>

            <div className="sectionHead"><div><p className="eyebrow">СРАВНЕНИЕ СЦЕНАРИЕВ</p><h2>Где теряются клиенты и что изменит оптимизация</h2></div></div>
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
            <div className="aiUsage">ИИ-модель: <b>{liveStats.ai.model}</b> · использовано <b>{liveStats.ai.totalTokens.toLocaleString("ru-RU")}</b> токенов ({liveStats.ai.inputTokens.toLocaleString("ru-RU")} входных + {liveStats.ai.outputTokens.toLocaleString("ru-RU")} выходных) · ориентировочная стоимость <b>${liveStats.ai.estimatedCostUsd.toFixed(3)}</b>. Итоговое списание смотрите в кабинете OpenAI.</div>

            <div className="sectionHead"><div><p className="eyebrow">ГЛАВНЫЕ ПРОБЛЕМЫ</p><h2>Что именно требует исправления</h2></div></div>
            <div className="problemGrid liveProblems">
              <ProblemCard number="01" color="#ff6b4a" title="Долгий ответ" count={liveStats.slowResponse} total={liveStats.dialogs} text="Хотя бы один ответ менеджера занял больше 15 минут." />
              <ProblemCard number="02" color="#775cff" title="Нет следующего шага" count={liveStats.noNextStep} total={liveStats.dialogs} text="Коммерческий интерес есть, но диалог не доведён до найденной цели." />
              <ProblemCard number="03" color="#f5b82e" title="Последнее слово за клиентом" count={liveStats.unanswered} total={liveStats.dialogs} text="Последнее сообщение написал клиент, после него ответа сообщества не было." />
              <ProblemCard number="04" color="#40b78a" title="Потеря с высоким риском" count={liveStats.lost} total={liveStats.dialogs} text="Совпали интерес, отсутствие целевого действия и незакрытый вопрос клиента." />
            </div>
          </>}
        </>}

        {tab === "Диалоги" && <DialogsTable query={query} setQuery={setQuery} filteredDialogs={filteredDialogs} analyzed={Boolean(liveStats)} />}
        {tab === "Качество" && <Quality stats={liveStats} />}
        {tab === "ИИ-бот" && <Bot goal={liveStats?.goal} />}
        {tab === "Настройки" && <Settings community={community} openaiConnected={Boolean(openaiKey)} busy={busy} onConnect={connectCommunity} onConnectOpenAI={connectOpenAI} onDisconnectOpenAI={() => { setOpenaiKey(""); setNotice("OpenAI отключён. Ключ удалён из текущей вкладки."); }} onDisconnect={() => { setCommunity(null); setToken(""); setLiveStats(null); setLiveDialogs([]); setNotice("Сообщество отключено. Токен удалён из текущей сессии."); }} />}
      </section>
    </main>
  );
}

function Settings({ community, openaiConnected, busy, onConnect, onConnectOpenAI, onDisconnectOpenAI, onDisconnect }: { community: Community | null; openaiConnected: boolean; busy: boolean; onConnect: (token: string) => void; onConnectOpenAI: (key: string) => void; onDisconnectOpenAI: () => void; onDisconnect: () => void }) {
  const [value, setValue] = useState("");
  const [aiValue, setAiValue] = useState("");
  return <div className="settingsPage">
    <div className="introRow"><div><h2>Подключение ВКонтакте</h2><p>Токен нужен для чтения истории сообщений от имени сообщества.</p></div></div>
    <div className="settingsGrid">
      <article className="card connectionCard">
        <div className="stepLabel">ШАГ 1 · ТОКЕН СООБЩЕСТВА</div>
        <h3>{community ? "Сообщество подключено" : "Вставьте токен доступа"}</h3>
        {community ? <>
          <div className="connectedBox"><span className="communityIcon">VK</span><div><b>{community.name}</b><small>ID {community.id}</small></div><i>●</i></div>
          <button className="dangerButton" onClick={onDisconnect}>Отключить сообщество</button>
        </> : <>
          <label className="tokenLabel">API-токен<input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="vk1.a.…" /></label>
          <button className="primary wide" disabled={busy || value.length < 10} onClick={() => onConnect(value.trim())}>{busy ? "Проверяю доступ…" : "Проверить и подключить →"}</button>
          <p className="securityNote">Токен передаётся по защищённому соединению, не сохраняется в браузере и не попадает в GitHub. После закрытия вкладки его нужно будет ввести снова.</p>
        </>}
      </article>
      <article className="card instructionCard">
        <div className="stepLabel">КАК ПОЛУЧИТЬ ТОКЕН</div>
        <ol><li>Откройте своё сообщество ВКонтакте.</li><li>Перейдите в <b>Управление → Работа с API</b>.</li><li>Создайте ключ доступа с правом <b>«Сообщения сообщества»</b>.</li><li>Скопируйте ключ и вставьте его в поле слева.</li></ol>
        <div className="warningBox"><b>Важно</b><span>Не отправляйте токен в сообщения и не добавляйте его в репозиторий. При подозрении на утечку удалите ключ в настройках VK.</span></div>
      </article>
      <article className="card connectionCard openaiCard">
        <div className="stepLabel">ШАГ 2 · OPENAI</div>
        <h3>{openaiConnected ? "OpenAI подключён" : "Подключите искусственный интеллект"}</h3>
        {openaiConnected ? <>
          <div className="connectedBox"><span className="openaiIcon">AI</span><div><b>Смысловой анализ активен</b><small>Намерения, цели, нюансы и рекомендации</small></div><i>●</i></div>
          <button className="dangerButton" onClick={onDisconnectOpenAI}>Отключить OpenAI</button>
        </> : <>
          <label className="tokenLabel">API-ключ OpenAI<input type="password" autoComplete="off" value={aiValue} onChange={(e) => setAiValue(e.target.value)} placeholder="sk-…" /></label>
          <button className="primary wide" disabled={busy || aiValue.length < 20} onClick={() => onConnectOpenAI(aiValue.trim())}>{busy ? "Проверяю ключ…" : "Проверить и подключить →"}</button>
          <p className="securityNote">Ключ передаётся по HTTPS и хранится только в памяти текущей вкладки. После закрытия страницы его потребуется ввести снова. Он не записывается в GitHub, базу или отчёт.</p>
        </>}
      </article>
    </div>
    <article className="card privacyCard"><div><b>Что именно передаётся в ИИ</b><p>До 40 последних сообщений каждого диалога, время и роль отправителя. Телефоны, email, ссылки и VK ID предварительно заменяются обезличенными маркерами.</p></div><div><b>Текущий режим анализа</b><p>Скорость и объём считаются точным алгоритмом, а намерения, цели, качество ответа, нюансы и рекомендации определяет OpenAI. Ключ хранится только в защищённом окружении сервера.</p></div></article>
  </div>;
}

function pct(value: number, total: number) {
  return total ? Math.round(value / total * 100) : 0;
}

function EmptyState({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) {
  return <div className="emptyState"><span>⌁</span><h3>{title}</h3><p>{text}</p>{action && onClick && <button className="primary" onClick={onClick}>{action}</button>}</div>;
}

function Metric({ label, value, hint, danger, description }: { label: string; value: string; hint?: string; danger?: boolean; description: string }) {
  return <article className="metric"><span>{label} <i className="infoTip" tabIndex={0}>?<em>{description}</em></i></span><strong className={danger ? "danger" : ""}>{value}</strong><small>{hint}</small></article>;
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
  return <article className="card chartCard"><div className="chartTitle"><div><span>ТЕКУЩИЕ ПОТЕРИ</span><h3>Причины риска</h3></div><b>{stats.lost}</b></div><div className="barChart">{values.map((item) => <div className="barItem" key={item.label}><div><span>{item.label}</span><b>{item.value} · {pct(item.value, stats.dialogs)}%</b></div><div><i style={{ width: `${item.value / max * 100}%`, background: item.color }} /></div></div>)}</div><p>Один диалог может попадать сразу в несколько категорий, поэтому проценты не складываются в 100%.</p></article>;
}

function OptimizationChart({ stats }: { stats: LiveStats }) {
  const optimized = stats.targets + Math.round((stats.recoverableLow + stats.recoverableHigh) / 2);
  return <article className="card chartCard optimization"><div className="chartTitle"><div><span>ПОСЛЕ ОПТИМИЗАЦИИ</span><h3>Сценарий роста</h3></div><b>{stats.growth === null ? "н/д" : `+${stats.growth}%`}</b></div><div className="comparisonBars"><div><span>Сейчас</span><i><em style={{ width: `${pct(stats.targets, optimized)}%` }} /></i><b>{stats.targets}</b></div><div><span>После изменений</span><i><em style={{ width: "100%" }} /></i><b>{optimized}</b></div></div><ul><li>ответ на входящее сообщение до 5 минут;</li><li>следующий шаг в каждом целевом обращении;</li><li>повторное касание, если клиент замолчал.</li></ul><p>{stats.growth === null ? "Недостаточно подтверждённых целевых действий для процентного сравнения." : `Для сценария используется середина расчётного диапазона ${stats.recoverableLow}–${stats.recoverableHigh} возвращаемых заявок.`}</p></article>;
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

function DialogsTable({ query, setQuery, filteredDialogs, analyzed }: { query: string; setQuery: (v: string) => void; filteredDialogs: LiveDialog[]; analyzed: boolean }) {
  if (!analyzed) return <div className="pageBlock"><EmptyState title="Диалоги ещё не анализировались" text="Сначала запустите полный анализ на странице «Обзор»." /></div>;
  return <div className="pageBlock">
    <div className="introRow"><div><h2>Разобранные диалоги</h2><p>Статус показывает риск по формальным признакам и не является подтверждённым исходом продажи.</p></div><input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, статус или причина" /></div>
    <div className="statusLegend">
      <span><i className="legendSuccess" /> <b>Успешно</b> — найдено целевое действие</span>
      <span><i className="legendRisk" /> <b>Риск</b> — интерес есть, цель не найдена</span>
      <span><i className="legendLost" /> <b>Потерян</b> — цель не найдена и последнее сообщение осталось без ответа</span>
    </div>
    <div className="tableCard">{filteredDialogs.map((d) => <div className="dialogRow liveRow aiDialogRow" key={d.peerId}><span className="avatar">VK</span><div><b>Диалог #{d.peerId}</b><small>{d.intent || "Намерение не определено"}</small></div><span className={`badge ${d.status}`}>{d.status}</span><div><small>Оценка ИИ · уверенность {d.confidence || 0}%</small><b>{d.score}/100</b></div><div className="issueCell"><small>Вывод ИИ</small><b>{d.issue}</b><small>{d.nuance}</small></div><div className="aiAdvice"><small>Как улучшить</small><b>{d.recommendation}</b>{d.betterReply && <em>Пример ответа: «{d.betterReply}»</em>}</div></div>)}</div>
  </div>;
}

function Quality({ stats }: { stats: LiveStats | null }) {
  if (!stats) return <div className="pageBlock"><EmptyState title="Оценка ещё не рассчитана" text="Раздел заполнится фактическими данными после полного анализа." /></div>;
  const speed = Math.max(0, 100 - pct(stats.slowResponse, stats.dialogs));
  const nextStep = Math.max(0, 100 - pct(stats.noNextStep, stats.leads));
  const replies = Math.max(0, 100 - pct(stats.unanswered, stats.dialogs));
  const total = Math.round((speed + nextStep + replies) / 3);
  return <div className="pageBlock"><div className="introRow"><div><h2>Качество обработки диалогов</h2><p>Расчёт основан на трёх проверяемых показателях. Тон и полнота ответов без смысловой ИИ-модели не оцениваются.</p></div></div><div className="qualityGrid"><div className="scoreCard"><span>Сводный индекс</span><b>{total}</b><small>из 100</small><div className="scoreRing">{total >= 80 ? "Хороший уровень" : "Нужно внимание"}</div></div><div className="card rubric">{[["Скорость ответа · доля без задержек свыше 15 минут", speed], ["Следующий шаг · доля целевых обращений без обрыва", nextStep], ["Ответ клиенту · доля диалогов без пропущенного последнего сообщения", replies]].map(([x, n]) => <FunnelRow key={x} label={String(x)} value={Number(n)} max={100} color={Number(n) > 80 ? "#40b78a" : Number(n) > 65 ? "#775cff" : "#ff6b4a"} />)}</div></div></div>;
}

function Bot({ goal }: { goal?: string }) {
  return <div className="pageBlock"><div className="botHero"><div><p className="eyebrow">ЧЕСТНАЯ РЕКОМЕНДАЦИЯ</p><h2>Бот снимет рутину.<br/>Сложные решения оставит людям.</h2><p>Он отвечает без задержки, квалифицирует клиента, собирает исходные данные и передаёт менеджеру диалог вместе с кратким резюме.</p><button className="primary">Настроить пилот →</button></div><div className="botOrb">✦<span>ИИ</span></div></div><div className="splitCards"><article className="card can"><span>МОЖЕТ ЗАКРЫТЬ</span>{["Ответ 24/7 за несколько секунд", "FAQ и типовые возражения", "Сбор необходимых данных клиента", goal ? `Доведение до этапа «${goal}»` : "Доведение до найденного целевого действия", "Повторное касание по инструкции"].map(x => <p key={x}>✓ {x}</p>)}</article><article className="card cannot"><span>ПЕРЕДАЁТ ЧЕЛОВЕКУ</span>{["Уникальные технические расчёты", "Конфликтные и юридические ситуации", "Нестандартные скидки и условия", "Вопросы с низкой уверенностью ИИ", "Сверхиндивидуальная консультация"].map(x => <p key={x}>→ {x}</p>)}</article></div></div>;
}
