"use client";

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type PdfReportData = {
  community: string;
  period: number;
  generatedAt: string;
  dialogs: number;
  replies?: number;
  leads: number;
  contacts: number;
  targets: number;
  lost: number;
  averageResponse: number;
  responseMeasured: boolean;
  goal: string;
  growth: number | null;
  recoverableLow: number;
  recoverableHigh: number;
  slowResponse: number;
  noNextStep: number;
  unanswered: number;
  objections: Array<{ key: string; label: string; count: number }>;
  objectionDialogs: number;
  dailyNew: Array<{ date: string; count: number }>;
  priority: "speed" | "objections" | "balanced";
};

const purple = "#775CFF";
const ink = "#211E20";
const muted = "#6F686C";
const line = "#E7E2DE";
const green = "#40B78A";
const orange = "#FF6B4A";
const yellow = "#F5B82E";

const pct = (value: number, total: number) => total ? Math.round(value / total * 100) : 0;
const number = (value: number) => value.toLocaleString("ru-RU");

function title(kicker: string, heading: string, text?: string): Content {
  return {
    stack: [
      { text: kicker.toUpperCase(), style: "kicker" },
      { text: heading, style: "pageTitle", margin: [0, 5, 0, text ? 8 : 18] as [number, number, number, number] },
      ...(text ? [{ text, style: "lead", margin: [0, 0, 0, 18] as [number, number, number, number] }] : []),
    ],
  };
}

function kpi(label: string, value: string, note: string): Content {
  return {
    table: {
      widths: ["*"],
      body: [[{
        stack: [
          { text: label, style: "smallLabel" },
          { text: value, style: "kpi" },
          { text: note, style: "muted" },
        ],
        margin: [9, 8, 9, 8],
      }]],
    },
    layout: {
      hLineColor: () => line, vLineColor: () => line,
      hLineWidth: () => 1, vLineWidth: () => 1,
    },
  };
}

function bar(label: string, value: number, max: number, color: string): Content {
  const width = Math.max(1, pct(value, max));
  return {
    stack: [
      {
        columns: [
          { text: label, style: "body" },
          { text: `${number(value)} · ${pct(value, max)}%`, style: "bodyBold", alignment: "right" },
        ],
      },
      {
        margin: [0, 5, 0, 11],
        table: {
          widths: [`${width}%`, `${100 - width}%`],
          heights: 8,
          body: [[{ text: "", fillColor: color }, { text: "", fillColor: "#EEEAE7" }]],
        },
        layout: "noBorders",
      },
    ],
  };
}

function pageBreak(): Content {
  return { text: "", pageBreak: "before" };
}

function statusTable(): Content {
  return {
    table: {
      headerRows: 1,
      widths: [70, 150, "*"],
      body: [
        [{ text: "Статус", style: "th" }, { text: "Формальное условие", style: "th" }, { text: "Как интерпретировать", style: "th" }],
        [{ text: "Успешно", color: green, bold: true }, "Найдено целевое действие", "Диалог дошёл до автоматически определённого результата."],
        [{ text: "Риск", color: "#9A7110", bold: true }, "Есть интерес, цель не найдена", "Клиент потенциально активен, но следующий коммерческий шаг не подтверждён."],
        [{ text: "Потерян", color: orange, bold: true }, "Есть интерес, цели нет, последнее сообщение клиента без ответа", "Высокий риск потери. Это модельный статус, а не подтверждённый отказ."],
      ],
    },
    layout: {
      fillColor: (row) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
      hLineColor: () => line, vLineColor: () => line,
    },
  };
}

export function buildReportDefinition(data: PdfReportData): TDocumentDefinitions {
  const response = data.responseMeasured
    ? data.averageResponse < 60 ? `${data.averageResponse} сек` : `${Math.round(data.averageResponse / 60)} мин`
    : "нет данных";
  const dailyMax = Math.max(1, ...data.dailyNew.map((item) => item.count));
  const dailyPoints = data.dailyNew.map((item, index) => ({
    x: data.dailyNew.length > 1 ? index / (data.dailyNew.length - 1) * 480 : 240,
    y: 85 - item.count / dailyMax * 75,
  }));
  const priorityText = data.priority === "speed"
    ? "Скорость ответа сейчас важнее: задержки встречаются заметно чаще распознанных возражений."
    : data.priority === "objections"
      ? "Отработка возражений сейчас важнее: сомнения клиентов встречаются заметно чаще длительных задержек."
      : "Скорость и отработка возражений сопоставимы по влиянию, поэтому их нужно улучшать параллельно.";
  const problems = [
    ["Долгий ответ", data.slowResponse, "Хотя бы один ответ занял больше 15 минут.", "Установить SLA 5 минут и уведомления о новых обращениях."],
    ["Нет следующего шага", data.noNextStep, `Интерес есть, но этап «${data.goal}» не достигнут.`, "Каждый содержательный ответ завершать одним понятным действием для клиента."],
    ["Нет ответа клиенту", data.unanswered, "Последнее сообщение осталось за клиентом.", "Назначить владельца диалога и контроль необработанных сообщений."],
    ["Высокий риск потери", data.lost, "Совпали интерес, отсутствие цели и незакрытый вопрос.", "Возвращать диалог повторным касанием и предложением конкретного шага."],
  ] as const;

  return {
    pageSize: "A4",
    pageMargins: [42, 52, 42, 44],
    defaultStyle: { font: "Roboto", fontSize: 9, color: ink, lineHeight: 1.25 },
    header: (currentPage) => ({
      columns: [
        { text: "ДИАЛОГИКА", bold: true, color: purple, fontSize: 11 },
        { text: data.community, alignment: "right", color: muted, fontSize: 8 },
      ],
      margin: [42, 22, 42, 0],
    }),
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Отчёт сформирован ${data.generatedAt}`, color: muted, fontSize: 7 },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: muted, fontSize: 7 },
      ],
      margin: [42, 0, 42, 18],
    }),
    styles: {
      kicker: { fontSize: 8, bold: true, color: purple, characterSpacing: 1.4 },
      coverTitle: { fontSize: 31, bold: true, lineHeight: 1.02, color: ink },
      pageTitle: { fontSize: 22, bold: true, color: ink },
      sectionTitle: { fontSize: 13, bold: true, color: ink, margin: [0, 16, 0, 8] },
      lead: { fontSize: 10, color: muted, lineHeight: 1.35 },
      body: { fontSize: 9, color: ink },
      bodyBold: { fontSize: 9, bold: true, color: ink },
      muted: { fontSize: 8, color: muted },
      smallLabel: { fontSize: 7, bold: true, color: muted, characterSpacing: .5 },
      kpi: { fontSize: 21, bold: true, color: ink, margin: [0, 6, 0, 4] },
      th: { bold: true, color: "#FFFFFF", fontSize: 8 },
    },
    content: [
      // Page 1
      { text: "РАСШИРЕННЫЙ ОТЧЁТ", style: "kicker", margin: [0, 72, 0, 12] },
      { text: "Аналитика переписок\nсообщества ВКонтакте", style: "coverTitle" },
      { text: data.community, fontSize: 16, color: purple, bold: true, margin: [0, 18, 0, 5] },
      { text: `Период анализа: ${data.period} дней`, style: "lead", margin: [0, 0, 0, 28] },
      {
        columns: [
          kpi("С РЕКЛАМНОЙ МЕТКОЙ", number(data.dialogs), `${number(data.replies ?? data.dialogs)} с ответом клиента`),
          kpi("ИНТЕРЕС К ПОСЕЩЕНИЮ", number(data.leads), `${pct(data.leads, data.replies ?? data.dialogs)}% ответивших`),
          kpi("ЗАПИСЬ ИЛИ ПОКУПКА", number(data.targets), `${pct(data.targets, data.leads)}% заинтересованных`),
        ],
        columnGap: 10,
      },
      { text: "Главный вывод", style: "sectionTitle", margin: [0, 28, 0, 8] },
      {
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: `${number(data.lost)} диалогов имеют высокий риск потери.`, fontSize: 16, bold: true, color: orange },
              { text: "Эти переписки стоит проверить вручную: статус определяется по сообщениям и не подтверждает фактический отказ клиента.", style: "lead", margin: [0, 8, 0, 0] },
            ],
            margin: [14, 12, 14, 12],
            fillColor: "#FFF2EF",
          }]],
        },
        layout: "noBorders",
      },
      { text: "Ограничение интерпретации", style: "sectionTitle" },
      { text: "Статусы и прогнозы являются аналитическими признаками, а не подтверждёнными продажами или отказами. Для точного расчёта выручки необходимо связать переписки с CRM и фактическими оплатами.", style: "lead" },

      // Page 2
      pageBreak(),
      title("Воронка", "От обращения до записи или покупки", "Этапы определены по сообщениям клиента и сообщества. Оплата вне переписки здесь не учитывается."),
      bar("Все диалоги за период", data.dialogs, data.dialogs, ink),
      bar("Интерес к предложению", data.leads, data.dialogs, purple),
      bar("Клиент оставил телефон", data.contacts, data.dialogs, "#A493FF"),
      bar("Запись или покупка", data.targets, data.dialogs, green),
      { text: "Что означает каждая строка", style: "sectionTitle" },
      {
        table: {
          widths: [135, "*"],
          body: [
            [{ text: "Показатель", style: "th" }, { text: "Определение", style: "th" }],
            ["Все диалоги", "Уникальные переписки хотя бы с одним сообщением в выбранном периоде."],
            ["Интерес к предложению", "Человек спрашивал о товаре или услуге, цене, условиях, заказе или записи."],
            ["Клиент оставил телефон", "Российский номер найден в сообщении клиента. Номер менеджера не учитывается."],
            ["Заказ, запись или покупка", "В переписке найдены подтверждённый заказ, запись, покупка или оплата."],
            ["Среднее время ответа", `${response}. Интервал от входящего сообщения до следующего ответа сообщества.`],
          ],
        },
        layout: {
          fillColor: (row) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
          hLineColor: () => line, vLineColor: () => line,
        },
      },
      { text: "Методика", style: "sectionTitle" },
      { text: "Анализ охватывает все диалоги с активностью в периоде. Один диалог может содержать несколько проблем. Персональные данные не включаются в этот отчёт.", style: "lead" },
      { text: "Новые диалоги по дням", style: "sectionTitle" },
      ...(dailyPoints.length ? [{
        canvas: [
          { type: "line" as const, x1: 0, y1: 88, x2: 480, y2: 88, lineColor: line, lineWidth: 1 },
          ...(dailyPoints.length > 1 ? [{ type: "polyline" as const, points: dailyPoints, lineColor: purple, lineWidth: 2 }] : []),
          ...dailyPoints.map((point) => ({ type: "ellipse" as const, x: point.x, y: point.y, r1: 3, r2: 3, color: purple })),
        ],
      }, {
        columns: [
          { text: data.dailyNew[0]?.date || "", style: "muted" },
          { text: `${data.dailyNew.reduce((sum, item) => sum + item.count, 0)} новых диалогов`, style: "bodyBold", alignment: "center" as const },
          { text: data.dailyNew.at(-1)?.date || "", style: "muted", alignment: "right" as const },
        ],
        margin: [0, 4, 0, 0],
      }] : [{ text: "В периоде не найдено диалогов, начатых впервые.", style: "lead" }]),

      // Page 3
      pageBreak(),
      title("Потери", "Где и почему обрываются диалоги", "Ниже показаны проверяемые поведенческие признаки. Они помогают приоритизировать контроль качества."),
      ...problems.map(([label, value], index) => bar(label, value, Math.max(1, data.replies ?? data.dialogs), [orange, purple, yellow, green][index])),
      { text: "Таблица причин и действий", style: "sectionTitle" },
      {
        table: {
          headerRows: 1,
          widths: [98, 42, 150, "*"],
          body: [
            [{ text: "Проблема", style: "th" }, { text: "Кол-во", style: "th" }, { text: "Что означает", style: "th" }, { text: "Первое исправление", style: "th" }],
            ...problems.map(([label, value, meaning, action]) => [label, number(value), meaning, action]),
          ],
        },
        layout: {
          fillColor: (row) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
          hLineColor: () => line, vLineColor: () => line,
        },
      },
      { text: "Главные возражения клиентов", style: "sectionTitle" },
      ...(data.objections.length ? [{
        table: {
          headerRows: 1,
          widths: ["*", 65, 85],
          body: [
            [{ text: "Возражение", style: "th" }, { text: "Диалоги", style: "th" }, { text: "Доля от ответивших", style: "th" }],
            ...data.objections.slice(0, 6).map((item) => [item.label, number(item.count), `${pct(item.count, data.replies ?? data.dialogs)}%`]),
          ],
        },
        layout: {
          fillColor: (row: number) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
          hLineColor: () => line, vLineColor: () => line,
        },
      } as Content] : [{ text: "Явные типовые возражения в текстах не найдены.", style: "lead" }]),
      {
        table: { widths: ["*"], body: [[{ stack: [{ text: "Что важнее сейчас", bold: true }, { text: priorityText, style: "lead", margin: [0, 5, 0, 0] }], fillColor: "#F0EDFF", margin: [12, 10, 12, 10] }]] },
        layout: "noBorders",
        margin: [0, 12, 0, 0],
      },

      // Page 4
      pageBreak(),
      title("Разбор ошибок", "Как отвечали и как следовало отвечать", "Примеры ниже являются рекомендуемыми моделями поведения, а не дословными цитатами клиентов или менеджеров."),
      {
        table: {
          headerRows: 1,
          widths: [100, 165, "*"],
          body: [
            [{ text: "Частая ошибка", style: "th" }, { text: "Почему это снижает конверсию", style: "th" }, { text: "Как делать правильно", style: "th" }],
            ["Ответ только на заданный вопрос", "Клиент получил информацию, но не понимает, что делать дальше.", "Ответить по существу и завершить конкретным шагом: «Чтобы оформить заказ, пришлите фото и желаемый размер»."],
            ["Долгая реакция", "Горячий интерес остывает, клиент продолжает сравнение у конкурентов.", "Подтвердить получение сообщения до 5 минут. Если нужен расчёт, назвать точное время следующего ответа."],
            ["Слишком общий шаблон", "Ответ выглядит автоматическим и не учитывает запрос.", "Повторить ключевую деталь клиента, предложить 1-2 подходящих варианта и задать один уточняющий вопрос."],
            ["Нет повторного касания", "Молчание ошибочно трактуется как отказ.", "Через согласованный интервал напомнить контекст, дать пользу и предложить простой выбор из двух вариантов."],
            ["Слишком много вопросов сразу", "Клиенту сложно ответить, диалог требует лишнего усилия.", `Запрашивать данные поэтапно: сначала то, без чего нельзя перейти к «${data.goal}».`],
          ],
        },
        layout: {
          fillColor: (row) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
          hLineColor: () => line, vLineColor: () => line,
        },
      },
      { text: "Рекомендуемая структура ответа", style: "sectionTitle" },
      {
        ol: [
          "Коротко подтвердить, что запрос понят.",
          "Дать прямой ответ на вопрос клиента.",
          "Добавить одну релевантную рекомендацию или снять типичное сомнение.",
          `Предложить следующий шаг, ведущий к «${data.goal}».`,
          "Если клиент не ответил, запланировать повторное касание.",
        ],
        color: ink,
        margin: [8, 0, 0, 0],
      },

      // Page 5
      pageBreak(),
      title("План действий", "Что проверить в работе с обращениями", "Ниже только наблюдаемые признаки из переписок и действия для команды. Прогноз продаж по ним не рассчитывается."),
      {
        columns: [
          kpi("ЗАПИСЬ ИЛИ ПОКУПКА", number(data.targets), "подтверждено в переписке"),
          kpi("БЕЗ ОТВЕТА", number(data.unanswered), "последнее сообщение клиента"),
          kpi("ДОЛГИЙ ОТВЕТ", number(data.slowResponse), "дольше 15 минут"),
        ],
        columnGap: 10,
      },
      { text: "Как читать числа", style: "sectionTitle" },
      { text: "Это признаки из сообщений, а не данные кассы или CRM. Одна переписка может входить сразу в несколько категорий риска.", style: "lead" },
      { text: "План на 30 дней", style: "sectionTitle" },
      {
        table: {
          headerRows: 1,
          widths: [45, 145, "*", 80],
          body: [
            [{ text: "Этап", style: "th" }, { text: "Действие", style: "th" }, { text: "Результат", style: "th" }, { text: "Контроль", style: "th" }],
            ["1-3 дни", "Зафиксировать SLA первого ответа и правила передачи диалогов.", "У каждого обращения есть ответственный.", "Доля ответов до 5 минут"],
            ["4-7 дни", `Создать сценарии доведения до «${data.goal}».`, "Каждый ответ содержит понятный следующий шаг.", "Конверсия в цель"],
            ["2 неделя", "Запустить напоминания и повторные касания.", "Незавершённые диалоги возвращаются в работу.", "Доля диалогов без ответа"],
            ["3 неделя", "Подключить ИИ-ассистента на типовые вопросы.", "Скорость и единообразие без потери контроля.", "Передачи человеку"],
            ["4 неделя", "Повторить анализ и сравнить одинаковые периоды.", "Подтверждён эффект изменений.", "Все показатели отчёта"],
          ],
        },
        layout: {
          fillColor: (row) => row === 0 ? ink : row % 2 ? "#F8F6F3" : "#FFFFFF",
          hLineColor: () => line, vLineColor: () => line,
        },
      },
      { text: "Что ИИ-бот закроет", style: "sectionTitle" },
      {
        columns: [
          { ul: ["Мгновенный первый ответ", "FAQ и типовые возражения", "Сбор исходных данных", "Повторные касания"], width: "50%" },
          { ul: [`Доведение до «${data.goal}»`, "Работа по инструкции", "Резюме для менеджера", "Эскалация сложных вопросов"], width: "50%" },
        ],
      },
      { text: "Бот не должен самостоятельно решать юридические, конфликтные, технически уникальные вопросы и нестандартные коммерческие условия.", style: "lead", margin: [0, 18, 0, 0] },
    ] as Content[],
  };
}

export async function downloadDetailedReport(data: PdfReportData) {
  const [{ default: pdfMake }, fontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const fonts = fontsModule.default as unknown as { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> };
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = fonts.pdfMake?.vfs || fonts.vfs || fontsModule.default;
  const safeName = data.community.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 45);
  pdfMake.createPdf(buildReportDefinition(data)).download(`dialogika-${safeName}-${data.period}-days.pdf`);
}
