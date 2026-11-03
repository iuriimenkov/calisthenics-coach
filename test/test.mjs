// Проверка распознавания и подсчёта на синтетических скелетах (вид сбоку, кадр 1000×1000)
import { features, classify, Recognizer, makeEngine } from "../logic.js";

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
  const wrL = { x: 430, y: 150 }, wrR = { x: 570, y: 150 };
  const d = 2 * 150 * Math.sin(rad(elbowAng / 2)); // расстояние плечо–кисть
  const sh = { x: 450, y: 150 + d }, el = { x: 450 + 150 * Math.cos(rad(elbowAng / 2)), y: 150 + d / 2 };
  const hip = { x: 450, y: sh.y + 250 }, kn = { x: 450, y: hip.y + 200 }, an = { x: 450, y: kn.y + 200 };
  return { wr: wrL, wr2: wrR, sh, el, hip, kn, an, nose: { x: 470, y: sh.y - 70 } };
}
const poses = {
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
for (const [k, expect] of [["plank", "plank"], ["handstand", "handstand"], ["lsit", "lsit"], ["frontlever", "frontlever"],
  ["backlever", "backlever"], ["planche", "planche"], ["pikeTop", "pike"], ["hollow", "hollow"]]) {
  const f = features(lmFrom(poses[k]), W, H);
  const c = classify(f, { elbow: 0, knee: 0, hip: 0 });
  check(`распознал ${k}`, c === expect, `→ ${c}`);
}
check("стойка — не элемент", classify(features(lmFrom(squat(178, 3)), W, H), { elbow: 0, knee: 0, hip: 0 }) === null);
check("вис", classify(features(lmFrom(pull(175)), W, H), { elbow: 0, knee: 0, hip: 0 }) === "hang");

// --- динамика: полный конвейер (распознавание + подсчёт) ---
function run(name, frameFn, nFrames, expectKey, expectReps) {
  const rec = new Recognizer(); const hist = []; let cur = null, eng = null; const reps = [];
  for (let i = 0; i < nFrames; i++) {
    const t = i * 33;
    const f = features(lmFrom(frameFn(i)), W, H);
    hist.push({ t, f }); while (t - hist[0].t > 1500) hist.shift();
    const rg = k => Math.max(...hist.map(h => h.f[k])) - Math.min(...hist.map(h => h.f[k]));
    const det = rec.push(classify(f, { elbow: rg("elbow"), knee: rg("knee"), hip: rg("hip") }), t);
    if (det && det !== cur && !(eng && eng.busy)) { cur = det; eng = makeEngine(det); for (const h of hist) eng.update(h.f, h.t); continue; }
    if (eng) for (const e of eng.update(f, t)) if (e.type === "rep") reps.push(e.score + (e.tip ? ` (${e.tip})` : ""));
  }
  check(`${name}: распознан ${expectKey}`, cur === expectKey, `→ ${cur}`);
  check(`${name}: повторов ${expectReps}`, reps.length === expectReps, `→ ${reps.length}: ${reps.join(", ")}`);
}
const wave = (i, period) => (1 - Math.cos(2 * Math.PI * i / period)) / 2; // 0→1→0
run("Приседания (хорошие)", i => squat(170 - 85 * wave(i, 60), 20), 300, "squat", 5);
run("Приседания (мелкие)", i => squat(170 - 55 * wave(i, 60), 20), 300, "squat", 5);
run("Отжимания (хорошие)", i => pushup(298 - 110 * wave(i, 60)), 300, "pushup", 5);
run("Отжимания (провис)", i => pushup(298 - 110 * wave(i, 60), 90), 300, "pushup", 5);
run("Подтягивания", i => pull(175 - 120 * wave(i, 70)), 350, "pullup", 5);

// --- статика: таймер и качество ---
const h = makeEngine("plank"); let ev = [];
for (let i = 0; i < 400; i++) ev.push(...h.update(features(lmFrom(pushup(300)), W, H), i * 33));
check("Планка: время ~13 с", h.total > 12 && h.total < 14, `→ ${h.total.toFixed(1)} с, качество ${h.avg}%`);
const h2 = makeEngine("plank");
for (let i = 0; i < 200; i++) h2.update(features(lmFrom(pushup(300, 70)), W, H), i * 33);
check("Планка с провисом: качество ниже", h2.lastScore < 75, `→ ${h2.lastScore}%`);

console.log(fail ? `\n${fail} ошибок` : "\nВсё прошло");
process.exit(fail ? 1 : 0);
