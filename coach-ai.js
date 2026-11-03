// ИИ-тренер: чат с любым OpenAI-совместимым сервисом + разбор тренировки без интернета.
import { LIB, LEVELS } from "./library.js";
import { EXERCISES, findAlias } from "./logic.js";

export const PROVIDERS = {
  openrouter: { name: "OpenRouter — бесплатно", base: "https://openrouter.ai/api/v1", model: "openrouter/free", keyUrl: "https://openrouter.ai/keys",
    note: "Бесплатно, примерно 50 вопросов в день. Ключ: openrouter.ai → Keys → Create Key. Из России может понадобиться VPN." },
  groq: { name: "Groq — бесплатно", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys",
    note: "Бесплатно и очень быстро. Ключ: console.groq.com → API Keys. Из России может понадобиться VPN." },
  custom: { name: "Другой сервис (OpenAI-совместимый)", base: "", model: "", keyUrl: "",
    note: "Подойдёт любой сервис с OpenAI-совместимым API, в том числе российские агрегаторы. Укажи адрес API (обычно заканчивается на /v1) и название модели из его документации." },
};

const KEY = "coach-ai-settings";
export function loadSettings() {
  try { return { provider: "openrouter", key: "", model: "", base: "", ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { provider: "openrouter", key: "", model: "", base: "" }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export const isConfigured = s => !!(s.key && (s.provider !== "custom" || (s.base && s.model)));
const endpoint = s => {
  const p = PROVIDERS[s.provider] || PROVIDERS.custom;
  return { base: (s.base || p.base).replace(/\/+$/, ""), model: s.model || p.model };
};

// ---------- Системный промпт ----------
export function systemPrompt(summary, focusKey) {
  const list = Object.entries(EXERCISES).map(([k, d]) => d.name).join(", ");
  let p = `Ты — дружелюбный и опытный тренер по калистенике внутри приложения «AI-тренер». Отвечай по-русски, коротко и по делу: 3–8 предложений или короткий список. Обращайся на «ты».
Помогай с техникой, разбором ошибок, прогрессиями, программами тренировок и восстановлением. Опирайся на безопасную, общепринятую практику.
Если человек жалуется на боль (особенно острую, в суставах, позвоночнике, груди), посоветуй прекратить упражнение и обратиться к врачу; не ставь диагнозов.
Приложение через камеру распознаёт и оценивает элементы: ${list}. Можешь советовать включить нужный элемент в приложении (вкладка «Тренировка» или «Упражнения»).`;
  if (summary?.length) {
    p += `\n\nДанные последней тренировки из приложения (качество — оценка техники камерой, 0–100%):\n` + summary.map(s =>
      `- ${s.name}: ${s.type === "reps" ? s.reps + " повт." : Math.round(s.total) + " с (рекорд " + Math.round(s.best) + " с)"}, среднее качество ${s.avg ?? "—"}%` +
      (s.errors.length ? `; частые замечания: ${s.errors.map(([t, n]) => `«${t}» ×${n}`).join(", ")}` : "")).join("\n");
  } else p += `\n\nВ этой сессии тренировка ещё не записана.`;
  if (focusKey && LIB[focusKey]) {
    const l = LIB[focusKey];
    p += `\n\nСейчас вопрос про «${EXERCISES[focusKey].name}». Справка приложения: техника — ${l.how.join("; ")}. Частые ошибки — ${l.mistakes.join("; ")}. Проще — ${l.easier}. Сложнее — ${l.harder}.`;
  }
  return p;
}

// ---------- Запрос к ИИ (с потоковым выводом) ----------
export async function ask(settings, messages, onDelta, signal) {
  const { base, model } = endpoint(settings);
  let res;
  try {
    res = await fetch(base + "/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + settings.key.trim(),
                 "HTTP-Referer": location.origin, "X-Title": "Calisthenics Coach" },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.6, max_tokens: 900 }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Не удалось подключиться к сервису. Возможно, он недоступен из твоей сети (попробуй VPN) или не принимает запросы из браузера — тогда выбери другой сервис в настройках.");
  }
  if (!res.ok) {
    let detail = ""; try { const j = await res.json(); detail = j.error?.message || j.message || ""; } catch {}
    const map = { 401: "Ключ не подошёл. Проверь, что скопировал его полностью.", 402: "На счёте сервиса закончились средства.",
      403: "Сервис отказал в доступе — возможно, он недоступен из твоей страны. Попробуй VPN или другой сервис.",
      404: "Модель не найдена. Проверь название модели в настройках.", 429: "Достигнут лимит бесплатных запросов. Подожди немного или попробуй позже." };
    throw new Error((map[res.status] || `Ошибка сервиса (${res.status}).`) + (detail ? `\nПодробности: ${detail}` : ""));
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("event-stream") || !res.body) {
    const j = await res.json(); const txt = j.choices?.[0]?.message?.content || ""; onDelta(txt); return txt;
  }
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "", full = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim(); if (data === "[DONE]") return full;
      try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { full += d; onDelta(d); } } catch {}
    }
  }
  return full;
}

// ---------- Без интернета и ключа: разбор тренировки и справка ----------
export function localReview(summary) {
  if (!summary?.length) return "Пока нечего разбирать: тренировка ещё не записана. Сделай пару подходов на вкладке **Тренировка** — и я разберу каждое упражнение.";
  const out = ["**Разбор тренировки**"];
  for (const s of summary) {
    const l = LIB[s.key], q = s.avg ?? 0;
    const res = s.type === "reps" ? `${s.reps} повт.` : `${Math.round(s.total)} с, лучшее удержание ${Math.round(s.best)} с`;
    out.push(`\n**${s.name}** — ${res}, качество ${s.avg ?? "—"}%`);
    if (s.errors.length) out.push("- Чаще всего: " + s.errors.map(([t, n]) => `${t.toLowerCase()} (${n})`).join("; "));
    if (q >= 85) out.push(`- Техника отличная. Можно усложнять: ${l?.harder || "добавь повторов или времени"}.`);
    else if (q >= 65) out.push(`- Хорошо, но есть что поправить. Сделай следующий подход медленнее и следи за главной ошибкой.`);
    else out.push(`- Техника страдает — лучше меньше, но чище. Попробуй облегчённый вариант: ${l?.easier || "уменьши амплитуду"}.`);
    if (l && q < 85) out.push("- Ключевое в технике: " + l.how[1].charAt(0).toLowerCase() + l.how[1].slice(1) + ".");
  }
  out.push("\nПодключи ИИ в настройках (⚙️), если хочешь обсудить подробнее и получить программу тренировок.");
  return out.join("\n");
}
export function localTechnique(text) {
  const k = findAlias(" " + text.toLowerCase() + " ");
  if (!k || !LIB[k]) return null;
  const l = LIB[k];
  return [`**${EXERCISES[k].name}** · ${LEVELS[l.level]} · ${l.dose}`, `Работают: ${l.muscles}.`, "", "**Техника:**", ...l.how.map(x => "- " + x),
    "", "**Частые ошибки:**", ...l.mistakes.map(x => "- " + x), "", `**Проще:** ${l.easier}`, `**Сложнее:** ${l.harder}`].join("\n");
}

// простой и безопасный markdown → HTML
export function md(text) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lines = esc(text).split("\n"); let html = "", inList = false;
  for (let ln of lines) {
    ln = ln.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/^#{1,4}\s*(.+)$/, "<b>$1</b>");
    const li = ln.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    html += ln.trim() ? `<p>${ln}</p>` : "";
  }
  return html + (inList ? "</ul>" : "");
}
