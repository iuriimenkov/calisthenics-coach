// Проверка распознавания и подсчёта на синтетических скелетах (вид сбоку, кадр 1000×1000)
import { features, classify, Recognizer, makeEngine, frameProblem, parseCommand, Session } from "../logic.js";

const W = 1000, H = 1000, rad = d => d * Math.PI / 180;
function lmFrom(p) { // p: {nose, sh, el, wr, hip, kn, an} — одинаково для L и R (вид сбоку)
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
  const set = (i, q) => lm[i] = { x: q.x / W, y: q.y / H, visibility: 0.95 };
  set(0, p.nose);
  [[11, 12, "sh"], [13, 14, "el"], [15, 16, "wr"], [23, 24, "hip"], [25, 26, "kn"], [27, 28, "an"]]
    .forEach(([a, b, k]) => { set(a, p[k]); set(b, p[(k + "2")] || p[k]); });
  return lm;
}
const add = (a, len, angDeg) => ({ x: a.x + len * Math.sin(rad(angDeg)), y: a.y - len * Math.cos(rad(angDeg)) }); // 0° = вверх, 90° = вправо
const mid = (a, b, t = 0.5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// --- позы ---
function squat(kneeAng, lean = 20) {
  const a = (180 - kneeAng) / 2;
  const an = { x: 500, y: 900 }, kn = add(an, 200, a), hip = add(kn, 200, -a), sh = add(hip, 250, lean);
  const el = add(sh, 150, 160), wr = add(el, 150, 120), nose = add(sh, 60, lean + 10);
  return { an, kn, hip, sh, el, wr, nose };
}
function pushup(s, sag = 0) { // s — высота плеч над полом
  const wr = { x: 300, y: 800 }, sh = { x: 300, y: 800 - s }, an = { x: 850, y: 790 };
  const h = Math.sqrt(Math.max(0, 150 ** 2 - (s / 2) ** 2));
  const el = { x: 300 + h, y: 800 - s / 2 };
  const hip = mid(sh, an, 0.45); hip.y += sag;
  return { wr, sh, an, el, hip, kn: mid(hip, an), nose: { x: 240, y: sh.y - 10 } };
}
function pull(elbowAng) { // вис/подтягивание, кисти на перекладине y=150
  const wrL = { x: 430, y: 40 }, wrR = { x: 570, y: 40 };
  const d = 2 * 150 * Math.sin(rad(elbowAng / 2)); // расстояние плечо–кисть
  const sh = { x: 450, y: 40 + d }, el = { x: 450 + 150 * Math.cos(rad(elbowAng / 2)), y: 40 + d / 2 };
  const hip = { x: 450, y: sh.y + 250 }, kn = { x: 450, y: hip.y + 200 }, an = { x: 450, y: kn.y + 200 };
  return { wr: wrL, wr2: wrR, sh, el, hip, kn, an, nose: { x: 470, y: sh.y - 70 } };
}
function elbowPlank(sag = 0) {
  const el = { x: 300, y: 800 }, wr = { x: 160, y: 805 }, sh = { x: 300, y: 650 }, an = { x: 900, y: 790 };
  const hip = mid(sh, an, 0.45); hip.y += sag;
  return { el, wr, sh, an, hip, kn: mid(hip, an), nose: { x: 230, y: 640 } };
}
function bridge(lift) { // lift: 0 — таз на полу, 1 — вверху
  const sh = { x: 250, y: 850 }, an = { x: 750, y: 860 }, kn = { x: 640, y: 660 };
  const hip = { x: 470, y: 840 - lift * 150 };
  return { sh, an, kn, hip, el: { x: 330, y: 860 }, wr: { x: 420, y: 862 }, nose: { x: 170, y: 800 } };
}
function row(elbowAng) { // тело под перекладиной под углом ~30°, кисти на перекладине
  const an = { x: 900, y: 900 }, dir = rad(30), L = 650;
  const sh = { x: an.x - L * Math.cos(dir), y: an.y - L * Math.sin(dir) };
  const wr = { x: sh.x + 20, y: sh.y - 2 * 150 * Math.sin(rad(elbowAng / 2)) };
  const el = { x: sh.x + 150 * Math.cos(rad(elbowAng / 2)) + 20, y: (sh.y + wr.y) / 2 };
  const hip = mid(sh, an, 0.42), kn = mid(sh, an, 0.7);
  return { an, sh, wr, el, hip, kn, nose: { x: sh.x - 50, y: sh.y - 45 } };
}
const poses = {
  elbowplank: elbowPlank(),
  plank: pushup(300),
  handstand: (() => { const wr = { x: 500, y: 900 }, sh = { x: 500, y: 600 }, hip = { x: 500, y: 350 }, kn = { x: 500, y: 150 }, an = { x: 500, y: 0 };
    return { wr, sh, el: { x: 500, y: 750 }, hip, kn, an: { x: 500, y: 20 }, nose: { x: 520, y: 680 } }; })(),
  lsit: (() => { const hip = { x: 400, y: 600 }, sh = { x: 400, y: 350 }, kn = { x: 600, y: 600 }, an = { x: 800, y: 600 };
    return { hip, sh, kn, an, el: { x: 400, y: 480 }, wr: { x: 405, y: 610 }, nose: { x: 430, y: 290 } }; })(),
  frontlever: (() => { const sh = { x: 300, y: 500 }, hip = { x: 550, y: 500 }, kn = { x: 750, y: 500 }, an = { x: 950, y: 500 };
    return { sh, hip, kn, an, el: { x: 360, y: 360 }, wr: { x: 400, y: 220 }, nose: { x: 240, y: 470 } }; })(),
  backlever: (() => { const sh = { x: 300, y: 500 }, hip = { x: 550, y: 500 }, kn = { x: 750, y: 500 }, an = { x: 950, y: 500 };
    return { sh, hip, kn, an, el: { x: 360, y: 360 }, wr: { x: 400, y: 220 }, nose: { x: 240, y: 530 } }; })(),
  planche: (() => { const sh = { x: 300, y: 500 }, hip = { x: 550, y: 505 }, kn = { x: 750, y: 505 }, an = { x: 950, y: 505 };
    return { sh, hip, kn, an, el: { x: 320, y: 650 }, wr: { x: 340, y: 800 }, nose: { x: 240, y: 520 } }; })(),
  pikeTop: (() => { const wr = { x: 300, y: 850 }, sh = { x: 380, y: 600 }, hip = { x: 550, y: 400 }, kn = { x: 650, y: 620 }, an = { x: 750, y: 850 };
    return { wr, sh, el: { x: 340, y: 725 }, hip, kn, an, nose: { x: 360, y: 680 } }; })(),
  hollow: (() => { const hip = { x: 500, y: 850 }, sh = { x: 280, y: 800 }, kn = { x: 700, y: 820 }, an = { x: 880, y: 790 };
    return { hip, sh, kn, an, el: { x: 140, y: 790 }, wr: { x: 20, y: 780 }, nose: { x: 230, y: 760 } }; })(),
};

let fail = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "✅" : "❌") + " " + name + (extra ? "  " + extra : "")); if (!ok) fail++; };

// --- статика: распознавание ---
for (const [k, expect] of [["elbowplank", "elbowplank"], ["plank", "plank"], ["handstand", "handstand"], ["lsit", "lsit"], ["frontlever", "frontlever"],
  ["backlever", "backlever"], ["planche", "planche"], ["pikeTop", "pike"], ["hollow", "hollow"]]) {
  const f = features(lmFrom(poses[k]), W, H);
  const c = classify(f, { elbow: 0, knee: 0, hip: 0 });
  check(`распознал ${k}`, c === expect, `→ ${c}`);
}
check("стойка — не элемент", classify(features(lmFrom(squat(178, 3)), W, H), { elbow: 0, knee: 0, hip: 0 }) === null);
check("вис", classify(features(lmFrom(pull(175)), W, H), { elbow: 0, knee: 0, hip: 0 }) === "hang");

// --- динамика: полный конвейер (как в приложении: защита + сессия) ---
function simulate(frameFn, nFrames, ses = new Session(), t0 = 0) {
  let prev = null; const reps = [];
  for (let i = 0; i < nFrames; i++) {
    const t = t0 + i * 33, raw = frameFn(i);
    const f = features(Array.isArray(raw) ? raw : lmFrom(raw), W, H);
    const bad = frameProblem(f, prev); prev = f;
    const out = bad ? { ev: ses.bad(t) } : ses.frame(f, t);
    for (const e of out.ev) if (e.type === "rep") reps.push({ ex: e.ex, s: e.score + (e.tip ? ` (${e.tip})` : "") });
  }
  return { ses, reps };
}
function run(name, frameFn, nFrames, expectKey, expectReps) {
  const { ses, reps } = simulate(frameFn, nFrames);
  if (expectKey === null) { check(`${name}: ничего не распознано и не посчитано`, reps.length === 0, `→ ${ses.cur}, ${reps.length} повт.`); return; }
  check(`${name}: распознан ${expectKey}`, ses.cur === expectKey, `→ ${ses.cur}`);
  check(`${name}: повторов ${expectReps}`, reps.length === expectReps, `→ ${reps.length}: ${reps.map(r => r.s).join(", ")}`);
}
const wave = (i, period) => (1 - Math.cos(2 * Math.PI * i / period)) / 2; // 0→1→0
run("Приседания (хорошие)", i => squat(170 - 85 * wave(i, 60), 20), 330, "squat", 5);
run("Приседания (мелкие)", i => squat(170 - 55 * wave(i, 60), 20), 330, "squat", 5);
run("Отжимания (хорошие)", i => pushup(298 - 110 * wave(i, 60)), 330, "pushup", 5);
run("Отжимания (провис)", i => pushup(298 - 110 * wave(i, 60), 90), 330, "pushup", 5);
run("Подтягивания", i => pull(175 - 120 * wave(i, 70)), 350, "pullup", 5);

run("Ягодичный мост", i => bridge(wave(i, 60)), 330, "bridge", 5);
run("Австралийские подтягивания", i => row(170 - 90 * wave(i, 60)), 330, "row", 5);

// --- связка: планка → 3 отжимания → планка, время планки не сбрасывается ---
{
  const ses = new Session(); let prev = null, reps = 0, ends = 0;
  const frame = i => i < 150 ? pushup(298) : i < 330 ? pushup(298 - 110 * wave(i - 150, 60)) : pushup(298);
  for (let i = 0; i < 480; i++) {
    const t = i * 33, f = features(lmFrom(frame(i)), W, H);
    const bad = frameProblem(f, prev); prev = f;
    for (const e of (bad ? { ev: ses.bad(t) } : ses.frame(f, t)).ev) { if (e.type === "rep") reps++; if (e.type === "holdEnd") ends++; }
  }
  const plank = ses.engine("plank");
  check("Связка: отжимания засчитаны", reps === 3, `→ ${reps}`);
  const errs = ses.summary().flatMap(s => s.errors);
  check("Связка: нет ложных замечаний к планке во время отжиманий", !errs.some(([txt]) => /рук/i.test(txt)), JSON.stringify(errs));
  check("Связка: планка не прервалась", ends === 0 && plank.cur > 14, `→ текущее удержание ${plank.cur.toFixed(1)} с, прерываний ${ends}`);
}
// --- «нет» откатывает насчитанное ---
{
  const { ses } = simulate(i => squat(170 - 85 * wave(i, 60), 20), 200);
  const before = ses.engine("squat").reps; const k = ses.reject(200 * 33);
  check("«Нет» отменяет повторы", k === "squat" && ses.engine("squat").reps === 0 && ses.cur === null, `было ${before} → ${ses.engine("squat").reps}`);
  simulate(i => squat(170 - 85 * wave(i, 60), 20), 200, ses, 200 * 33);
  check("После «нет» элемент не предлагается 20 с", ses.cur !== "squat", `→ ${ses.cur}`);
}

// --- защита от ложных срабатываний ---
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// дрожащий скелет (как при руке перед камерой): углы колена скачут 80–175° каждый кадр
run("Дрожание точек", i => squat(80 + 95 * rnd(), 20), 120, null);
// «рука крупным планом»: модель видит огромный кривой скелет с низкой видимостью ног
run("Рука перед камерой", () => { const lm = lmFrom(squat(80 + 95 * rnd(), 20)); for (const i of [25, 26, 27, 28]) lm[i].visibility = 0.3; return lm; }, 120, null);
run("Скелет с неправдоподобными пропорциями", () => { const p = squat(80 + 95 * rnd(), 20); p.kn = mid(p.hip, p.an, 0.1); return p; }, 120, null);
// слишком быстрые «приседания» (5 раз в секунду) — не засчитываются
run("Нереально быстрые повторы", i => squat(170 - 85 * wave(i, 6), 20), 120, null);

// --- голосовые команды ---
for (const [txt, exp] of [["планка на локтях", "set:elbowplank"], ["ягодичный мост", "set:bridge"], ["австралийские подтягивания", "set:row"], ["нет", "no"], ["Нет, не то", "no"], ["неправильно", "no"], ["нет это отжимания", "set:pushup"],
  ["подтягивания", "set:pullup"], ["отжимания на брусьях", "set:dip"], ["боковая планка", "set:sideplank"], ["планка", "set:plank"],
  ["передний вис", "set:frontlever"], ["стойка на руках", "set:handstand"], ["авто", "auto"], ["пауза", "pause"], ["продолжить", "resume"], ["привет", "null"]]) {
  const r = parseCommand(txt); const got = r ? r.cmd + (r.key ? ":" + r.key : "") : "null";
  check(`голос «${txt}»`, got === exp, `→ ${got}`);
}

// --- статика: таймер и качество ---
const h = makeEngine("plank"); let ev = [];
for (let i = 0; i < 400; i++) ev.push(...h.update(features(lmFrom(pushup(300)), W, H), i * 33));
check("Планка: время ~13 с", h.total > 12 && h.total < 14, `→ ${h.total.toFixed(1)} с, качество ${h.avg}%`);
const h2 = makeEngine("plank");
for (let i = 0; i < 200; i++) h2.update(features(lmFrom(pushup(300, 70)), W, H), i * 33);
check("Планка с провисом: качество ниже", h2.lastScore < 75, `→ ${h2.lastScore}%`);

console.log(fail ? `\n${fail} ошибок` : "\nВсё прошло");
process.exit(fail ? 1 : 0);
