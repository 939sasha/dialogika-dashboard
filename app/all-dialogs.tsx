"use client";

import { useState } from "react";

type Row = { peerId: number; messages: number; clientReplied: boolean; interestSignal: boolean; lastDate: number };
type Message = { role: "Клиент" | "Менеджер"; text: string; date: string };
type Period = "30" | "60" | "90";

export default function AllDialogs({ communityId, accessToken }: { communityId: number | null; accessToken: string }) {
  const [period, setPeriod] = useState<Period>("30");
  const [rows, setRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  function changePeriod(value: Period) {
    setPeriod(value); setRows([]); setOffset(0); setTotal(0); setDone(false); setError(""); setSelected(null);
  }

  async function scan() {
    if (!communityId || !accessToken || busy || done) return;
    setBusy(true); setError("");
    let next = offset;
    try {
      for (let batch = 0; batch < 20; batch++) {
        const response = await fetch("/api/vk/all-dialogs", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ communityId: String(communityId), days: Number(period), offset: next }) });
        const data = await response.json() as { rows?: Row[]; nextOffset?: number; totalAvailable?: number; done?: boolean; error?: string };
        if (!response.ok || !Array.isArray(data.rows) || !Number.isSafeInteger(data.nextOffset) || ((data.nextOffset || 0) <= next && !data.done)) {
          throw new Error(data.error || "Не удалось получить следующую пачку");
        }
        setRows((current) => [...current, ...(data.rows || [])]);
        next = data.nextOffset as number; setOffset(next); setTotal(data.totalAvailable || 0);
        if (data.done) { setDone(true); break; }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить диалоги"); }
    finally { setBusy(false); }
  }

  async function open(peerId: number) {
    if (!communityId) return;
    setSelected(peerId); setMessages([]); setDetailError(""); setDetailBusy(true);
    try {
      const response = await fetch(`/api/vk/senler-dialogs?communityId=${communityId}&peerId=${peerId}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const data = await response.json() as { messages?: Message[]; truncated?: boolean; error?: string };
      if (!response.ok || !Array.isArray(data.messages)) throw new Error(data.error || "VK не вернул переписку");
      setMessages(data.messages); setTruncated(Boolean(data.truncated));
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : "Переписка недоступна"); }
    finally { setDetailBusy(false); }
  }

  const replied = rows.filter((row) => row.clientReplied).length;
  const interested = rows.filter((row) => row.interestSignal).length;
  return <article className="card allDialogs">
    <div className="allDialogsHead"><div><p className="eyebrow">ВСЕ ОБРАЩЕНИЯ</p><h2>Все диалоги сообщества</h2><p>Рекламные и нерекламные переписки за выбранный период. Для всех подключённых сообществ.</p></div>
      <div className="period" aria-label="Период всех диалогов">{(["30", "60", "90"] as Period[]).map((value) => <button key={value} disabled={busy} className={period === value ? "selected" : ""} onClick={() => changePeriod(value)}>{value} дней</button>)}</div></div>
    {!communityId ? <p>Выберите сообщество в настройках.</p> : <>
      <div className="allDialogsMetrics"><span><b>{rows.length}</b> диалогов в периоде</span><span><b>{replied}</b> с сообщением клиента</span><span><b>{interested}</b> с признаками интереса</span></div>
      <p className="securityNote">Признаки интереса определяются по словам клиента и требуют проверки переписки. Номера телефонов и ссылки в просмотре скрыты.</p>
      <button className="primary" disabled={busy || done} onClick={scan}>{busy ? `Сканирование: ${offset} из ${total || "…"}` : done ? "Проверка завершена" : offset ? "Продолжить проверку →" : "Проверить все диалоги →"}</button>
      {error && <p role="alert" className="adDialogLoading error">{error} · Проверенные пачки сохранены. Повторите запуск.</p>}
      {!!rows.length && <div className="allDialogsList">{rows.map((row) => <div className="allDialogsRow" key={row.peerId}><div><b>Диалог #{row.peerId}</b><small>{new Date(row.lastDate * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} · {row.messages} сообщений за период</small></div><span className={row.clientReplied ? "allDialogsYes" : "allDialogsNo"}>{row.clientReplied ? "Клиент написал" : "Нет сообщения клиента"}</span><span>{row.interestSignal ? "Есть признаки интереса" : "Интерес не найден"}</span><button className="adDialogOpen" onClick={() => open(row.peerId)}>Открыть переписку →</button></div>)}</div>}
      {selected !== null && <div className="adDialogOverlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><aside className="adDialogPanel"><div className="adDialogPanelHead"><div><span>ВСЕ ДИАЛОГИ</span><h3>Диалог #{selected}</h3><p>Просмотр сообщений сообщества VK. Контактные данные скрыты.</p></div><button onClick={() => setSelected(null)} aria-label="Закрыть">×</button></div>{detailBusy && <div className="adDialogLoading">Загружаю переписку…</div>}{detailError && <div className="adDialogLoading error">{detailError}</div>}{!detailBusy && !detailError && <div className="conversationTranscript"><strong>Переписка · {messages.length} сообщений</strong>{truncated && <p>Показаны последние 1000 сообщений.</p>}{messages.map((message, index) => <div className="conversationEntry" key={index}><b>{message.role} · {message.date}</b><p>{message.text}</p></div>)}</div>}</aside></div>}
    </>}
  </article>;
}
