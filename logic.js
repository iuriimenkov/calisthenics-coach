// ============================================================
//  Логика AI-тренера: признаки позы, распознавание элементов,
//  подсчёт повторов, удержаний и оценка качества.
//  Без зависимостей — работает и в браузере, и в Node (для тестов).
// ============================================================

// ---------- Геометрия ----------
const DEG = 180 / Math.PI;
export const clamp01 = v => Math.max(0, Math.min(1, v));
export const lin = (v, good, bad) => clamp01((v - bad) / (good - bad)); // 1 = идеально, 0 = плохо
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angle(a, b, c) {                      // угол в точке b
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const m = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return m ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / m))) * DEG : 180;
}
const angH = (a, b) => Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * DEG; // 0 = горизонт, 90 = вертикаль
const elev = (from, to) => Math.asin(Math.max(-1, Math.min(1, (from.y - to.y) / (dist(from, to) || 1)))) * DEG; // + если to выше
function lineOffset(a, b, p) {                 // насколько p ниже (+) / выше (−) прямой a–b по вертикали
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return 0;
  const yOn = a.y + (b.y - a.y) * (p.x - a.x) / dx;
  return p.y - yOn;
}

// ---------- Признаки из 33 точек MediaPipe ----------
// lm: массив {x,y,visibility} в долях кадра; W,H — размер кадра в пикселях
export function features(lm, W, H) {
  const pt = i => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 1 });
  const L = { sh: pt(11), el: pt(13), wr: pt(15), hip: pt(23), kn: pt(25), an: pt(27) };
  const R = { sh: pt(12), el: pt(14), wr: pt(16), hip: pt(24), kn: pt(26), an: pt(28) };
  const nose = pt(0);
  const sv = s => (s.sh.v + s.el.v + s.wr.v + s.hip.v + s.kn.v + s.an.v) / 6;
  const S = sv(L) >= sv(R) ? L : R;            // сторона, которую камера видит лучше
  const conf = Math.min(S.sh.v, S.hip.v);
  const feetVis = S.an.v > 0.45;
  const end = feetVis ? S.an : S.kn;
  const torso = dist(S.sh, S.hip) || 1;
  const len = feetVis ? Math.max(dist(S.sh, S.an), torso * 1.6) : torso * 2.3;
  const kL = angle(L.hip, L.kn, L.an), kR = angle(R.hip, R.kn, R.an);
  const bothKnees = L.kn.v > 0.45 && R.kn.v > 0.45 && L.an.v > 0.45 && R.an.v > 0.45;
  const wrY = (L.wr.y + R.wr.y) / 2, shY = (L.sh.y + R.sh.y) / 2;
  const forearm = angle(S.sh, S.el, S.wr) < 125 && Math.abs(S.wr.y - S.el.y) < 0.1 * len;
  const support = forearm ? S.el : S.wr;
  const torsoV = angle({ x: S.hip.x, y: S.hip.y - 100 }, S.hip, S.sh); // 0 = корпус вертикально, 180 = вниз головой
  // --- надёжность кадра (защита от ложных срабатываний) ---
  const key = [S.sh, S.el, S.wr, S.hip, S.kn, S.an];
  const vis6 = Math.min(...key.map(p => p.v));
  const inFrame = key.every(p => p.x > -0.03 * W && p.x < 1.03 * W && p.y > -0.03 * H && p.y < 1.03 * H);
  const xs = key.map(p => p.x / W), ys = key.map(p => p.y / H);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const ratio = (a, b) => (b > 1 ? a / b : 99);
  const thigh = dist(S.hip, S.kn), shin = dist(S.kn, S.an), upper = dist(S.sh, S.el), fore = dist(S.el, S.wr);
  const okR = (r, lo, hi) => r > lo && r < hi;
  const anatomyOK = okR(ratio(thigh, shin), 0.5, 2) && okR(ratio(upper, fore), 0.5, 2) && okR(ratio(torso, thigh), 0.45, 2.6) && okR(ratio(torso, upper), 0.8, 3.5);
  const pts = key.map(p => ({ x: p.x, y: p.y }));
  return {
    conf, feetVis, len, torso, vis6, inFrame, size, anatomyOK, pts,
    elbow: angle(S.sh, S.el, S.wr),
    knee: angle(S.hip, S.kn, S.an),
    kneeMin: bothKnees ? Math.min(kL, kR) : angle(S.hip, S.kn, S.an),
    kneeLevel: bothKnees ? Math.abs(L.kn.y - R.kn.y) / len : 0,
    hip: angle(S.sh, S.hip, S.kn),
    line: angle(S.sh, S.hip, end),
    torsoV, invDev: 180 - torsoV,
    bodyH: angH(S.sh, end),
    legElev: elev(S.hip, end),
    shElev: elev(S.hip, S.sh),
    hipOff: lineOffset(S.sh, end, S.hip) / len,
    noseUp: lineOffset(S.hip, S.sh, nose) < 0,
    chin: (Math.min(L.wr.y, R.wr.y) - nose.y) / len,      // + если нос выше кистей
    handsHigh: Math.max(L.wr.y, R.wr.y) < nose.y,
    wristBelowSh: (wrY - shY) / len,
    feetAboveHands: (wrY - end.y) / len,
    wristStack: Math.abs(L.wr.y - R.wr.y) / len,
    shoulderStack: Math.abs(L.sh.y - R.sh.y) / len,
    shoulderWidth: Math.abs(L.sh.x - R.sh.x) / len,
    spread: bothKnees ? Math.abs(L.an.x - R.an.x) / len : 0,
    wristHip: dist(S.wr, S.hip) / torso,
    wristNearHip: dist(S.wr, S.hip) / len,
    supportOff: Math.abs(S.sh.x - support.x) / len,
    forearmFlat: forearm,
    hipHighest: S.hip.y < S.sh.y && S.hip.y < end.y,
  };
}

// ---------- Каталог элементов ----------
// type: reps — считаем повторы; hold — считаем время удержания.
// checks: k — ключ, w — вес в оценке, fn — значение, good/bad — пороги,
//   at: 'best' (лучшее за повтор, амплитуда), 'worst' (худшее за повтор, техника), 'top' (верхняя точка), 'tempo'
const sagMsg = f => f.hipOff > 0 ? "Не прогибай поясницу, напряги пресс" : "Опусти таз, тело в одну линию";
const leverMsg = f => f.hipOff > 0 ? "Подними таз, тело в одну линию" : "Не задирай таз";
const TEMPO = { k: "tempo", at: "tempo", w: 0.1, good: 1.4, bad: 0.6, msg: "Не спеши, контролируй движение" };

export const EXERCISES = {
  pushup: { name: "Отжимания", type: "reps", view: "Камера сбоку, на полу", metric: f => f.elbow, down: 145, up: 155, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.35, fn: f => f.elbow, good: 90, bad: 125, msg: "Опускайся ниже, грудь к полу" },
      { k: "line", at: "worst", w: 0.35, fn: f => f.line, good: 170, bad: 150, msg: sagMsg },
      { k: "lock", at: "top", w: 0.2, good: 165, bad: 145, msg: "Полностью выпрямляй руки вверху" }, TEMPO] },
  squat: { name: "Приседания", type: "reps", view: "Камера сбоку, на уровне пояса", metric: f => f.knee, down: 145, up: 160, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.45, fn: f => f.knee, good: 90, bad: 120, msg: "Приседай глубже, бедро до параллели" },
      { k: "back", at: "worst", w: 0.3, fn: f => f.torsoV, good: 30, bad: 55, msg: "Держи спину ровнее, грудь вперёд" },
      { k: "lock", at: "top", w: 0.15, good: 168, bad: 150, msg: "Вставай до конца" }, TEMPO] },
  lunge: { name: "Выпады", type: "reps", view: "Камера сбоку", metric: f => f.kneeMin, down: 140, up: 158, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.45, fn: f => f.kneeMin, good: 95, bad: 125, msg: "Опускайся ниже, колено к полу" },
      { k: "back", at: "worst", w: 0.3, fn: f => f.torsoV, good: 12, bad: 35, msg: "Держи корпус вертикально" },
      { k: "lock", at: "top", w: 0.15, good: 165, bad: 148, msg: "Выпрямляйся полностью" }, TEMPO] },
  pullup: { name: "Подтягивания", type: "reps", view: "Камера сбоку или спереди", metric: f => f.elbow, down: 140, up: 155, req: "chin",
    checks: [
      { k: "chin", at: "best", w: 0.45, fn: f => f.chin, good: 0.03, bad: -0.12, msg: "Подбородок выше перекладины" },
      { k: "lock", at: "top", w: 0.25, good: 165, bad: 140, msg: "Полностью выпрямляй руки внизу" },
      { k: "swing", at: "worst", w: 0.2, fn: f => f.hip, good: 165, bad: 130, msg: "Не раскачивайся, ноги прямо" }, TEMPO] },
  dip: { name: "Отжимания на брусьях", type: "reps", view: "Камера сбоку", metric: f => f.elbow, down: 145, up: 155, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.4, fn: f => f.elbow, good: 90, bad: 118, msg: "Опускайся ниже, плечо до уровня локтя" },
      { k: "lock", at: "top", w: 0.25, good: 165, bad: 145, msg: "Выпрямляй руки вверху" },
      { k: "lean", at: "worst", w: 0.25, fn: f => f.torsoV, good: 25, bad: 50, msg: "Не заваливайся вперёд" }, TEMPO] },
  pike: { name: "Пайк-отжимания", type: "reps", view: "Камера сбоку", metric: f => f.elbow, down: 145, up: 155, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.4, fn: f => f.elbow, good: 90, bad: 125, msg: "Опускайся ниже, голова к полу" },
      { k: "hips", at: "worst", w: 0.25, fn: f => f.hip, good: 95, bad: 130, msg: "Подними таз выше" },
      { k: "legs", at: "worst", w: 0.15, fn: f => f.knee, good: 168, bad: 145, msg: "Держи ноги прямыми" },
      { k: "lock", at: "top", w: 0.1, good: 165, bad: 145, msg: "Выпрямляй руки" }, TEMPO] },
  row: { name: "Австралийские подтягивания", type: "reps", view: "Камера сбоку", metric: f => f.elbow, down: 140, up: 155, req: "depth",
    checks: [
      { k: "depth", at: "best", w: 0.4, fn: f => f.elbow, good: 80, bad: 115, msg: "Тяни грудь к перекладине" },
      { k: "line", at: "worst", w: 0.3, fn: f => f.line, good: 168, bad: 150, msg: "Держи тело прямо, не провисай тазом" },
      { k: "lock", at: "top", w: 0.2, good: 162, bad: 140, msg: "Выпрямляй руки внизу" }, TEMPO] },
  bridge: { name: "Ягодичный мост", type: "reps", view: "Камера сбоку, на полу", metric: f => 300 - f.hip, down: 145, up: 158, req: "height",
    checks: [
      { k: "height", at: "best", w: 0.6, fn: f => f.hip, good: 170, bad: 152, msg: "Поднимай таз выше, сожми ягодицы" },
      { k: "lock", at: "top", w: 0.15, good: 165, bad: 150, msg: "Опускай таз до пола" },
      { k: "tempo", at: "tempo", w: 0.25, good: 1.4, bad: 0.6, msg: "Медленнее, задержись наверху" }] },
  legraise: { name: "Подъём ног в висе", type: "reps", view: "Камера сбоку", metric: f => f.hip, down: 150, up: 160, req: "height",
    checks: [
      { k: "height", at: "best", w: 0.5, fn: f => f.hip, good: 90, bad: 130, msg: "Поднимай ноги выше, до параллели" },
      { k: "legs", at: "worst", w: 0.3, fn: f => f.knee, good: 165, bad: 140, msg: "Ноги прямые, не сгибай колени" },
      { k: "lock", at: "top", w: 0.1, good: 170, bad: 150, msg: "Опускай ноги полностью" },
      { ...TEMPO, msg: "Без рывков, медленнее" }] },

  plank: { name: "Планка на прямых руках", type: "hold", view: "Камера сбоку, на полу",
    checks: [
      { k: "line", w: 0.55, fn: f => f.line, good: 170, bad: 152, msg: sagMsg },
      { k: "legs", w: 0.15, fn: f => f.knee, good: 168, bad: 150, msg: "Выпрями колени" },
      { k: "arms", w: 0.1, fn: f => f.elbow, good: 160, bad: 140, msg: "Выпрями руки" },
      { k: "stack", w: 0.2, fn: f => f.supportOff, good: 0.05, bad: 0.16, msg: "Плечи над запястьями" }] },
  elbowplank: { name: "Планка на локтях", type: "hold", view: "Камера сбоку, на полу",
    checks: [
      { k: "line", w: 0.6, fn: f => f.line, good: 170, bad: 152, msg: sagMsg },
      { k: "legs", w: 0.2, fn: f => f.knee, good: 168, bad: 150, msg: "Выпрями колени" },
      { k: "stack", w: 0.2, fn: f => f.supportOff, good: 0.05, bad: 0.15, msg: "Локти под плечами" }] },
  sideplank: { name: "Боковая планка", type: "hold", view: "Камера спереди",
    checks: [
      { k: "line", w: 0.7, fn: f => f.line, good: 168, bad: 148, msg: "Подними таз, тело в одну линию" },
      { k: "legs", w: 0.3, fn: f => f.knee, good: 165, bad: 145, msg: "Выпрями колени" }] },
  lsit: { name: "Уголок (L-sit)", type: "hold", view: "Камера сбоку",
    checks: [
      { k: "height", w: 0.45, fn: f => f.legElev, good: 0, bad: -25, msg: "Подними ноги выше, до горизонта" },
      { k: "legs", w: 0.3, fn: f => f.knee, good: 168, bad: 145, msg: "Выпрями колени, тяни носки" },
      { k: "arms", w: 0.15, fn: f => f.elbow, good: 165, bad: 140, msg: "Выпрями руки" },
      { k: "torso", w: 0.1, fn: f => f.torsoV, good: 15, bad: 40, msg: "Корпус вертикально" }] },
  handstand: { name: "Стойка на руках", type: "hold", view: "Камера сбоку",
    checks: [
      { k: "line", w: 0.4, fn: f => f.line, good: 172, bad: 150, msg: "Не прогибайся, тело в одну линию" },
      { k: "vert", w: 0.25, fn: f => f.invDev, good: 6, bad: 25, msg: "Держи вертикаль" },
      { k: "arms", w: 0.2, fn: f => f.elbow, good: 168, bad: 150, msg: "Выпрями руки, толкай пол" },
      { k: "legs", w: 0.15, fn: f => f.knee, good: 168, bad: 150, msg: "Ноги прямые, носки вверх" }] },
  hang: { name: "Вис на перекладине", type: "hold", view: "Камера спереди или сбоку",
    checks: [
      { k: "arms", w: 0.4, fn: f => f.elbow, good: 165, bad: 145, msg: "Выпрями руки" },
      { k: "body", w: 0.3, fn: f => f.hip, good: 168, bad: 145, msg: "Тело прямо, не сгибайся" },
      { k: "legs", w: 0.3, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" }] },
  hollow: { name: "Лодочка (hollow body)", type: "hold", view: "Камера сбоку, на полу",
    checks: [
      { k: "feet", w: 0.3, fn: f => f.legElev, good: 12, bad: 2, msg: "Оторви ноги от пола" },
      { k: "shoulders", w: 0.25, fn: f => f.shElev, good: 15, bad: 4, msg: "Оторви лопатки от пола" },
      { k: "legs", w: 0.25, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" },
      { k: "arms", w: 0.2, fn: f => f.wristHip, good: 1.9, bad: 1.4, msg: "Тянись руками за голову" }] },
  frontlever: { name: "Передний вис (front lever)", type: "hold", view: "Камера сбоку",
    checks: [
      { k: "horiz", w: 0.4, fn: f => f.bodyH, good: 6, bad: 25, msg: leverMsg },
      { k: "line", w: 0.3, fn: f => f.line, good: 170, bad: 150, msg: "Тело в одну линию" },
      { k: "arms", w: 0.15, fn: f => f.elbow, good: 165, bad: 145, msg: "Прямые руки" },
      { k: "legs", w: 0.15, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" }] },
  backlever: { name: "Задний вис (back lever)", type: "hold", view: "Камера сбоку",
    checks: [
      { k: "horiz", w: 0.4, fn: f => f.bodyH, good: 6, bad: 25, msg: "Держи тело горизонтально" },
      { k: "line", w: 0.3, fn: f => f.line, good: 170, bad: 150, msg: "Не сгибайся в тазу" },
      { k: "arms", w: 0.15, fn: f => f.elbow, good: 165, bad: 145, msg: "Прямые руки" },
      { k: "legs", w: 0.15, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" }] },
  planche: { name: "Планш", type: "hold", view: "Камера сбоку",
    checks: [
      { k: "horiz", w: 0.35, fn: f => f.bodyH, good: 5, bad: 22, msg: "Тело горизонтально, подними ноги" },
      { k: "line", w: 0.3, fn: f => f.line, good: 170, bad: 150, msg: "Не сгибайся в тазу" },
      { k: "arms", w: 0.2, fn: f => f.elbow, good: 165, bad: 145, msg: "Прямые руки" },
      { k: "legs", w: 0.15, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" }] },
  flag: { name: "Флажок", type: "hold", view: "Камера спереди",
    checks: [
      { k: "horiz", w: 0.5, fn: f => f.bodyH, good: 6, bad: 25, msg: "Подними ноги, тело горизонтально" },
      { k: "line", w: 0.3, fn: f => f.line, good: 168, bad: 148, msg: "Тело в одну линию" },
      { k: "legs", w: 0.2, fn: f => f.knee, good: 165, bad: 145, msg: "Ноги прямые" }] },
};

// ---------- Защита: можно ли доверять кадру ----------
// Возвращает null, если кадр надёжный, иначе причину.
export function frameProblem(f, prev) {
  if (f.vis6 < 0.55 || f.conf < 0.5) return "hidden";          // часть тела не видна / закрыта
  if (!f.inFrame) return "outside";                             // тело выходит за кадр
  if (f.size < 0.22) return "far";                              // человек слишком маленький / это не человек
  if (!f.anatomyOK) return "anatomy";                           // пропорции не похожи на человека (рука, предмет)
  if (prev) {                                                   // скелет «телепортировался» между кадрами
    let m = 0; for (let i = 0; i < f.pts.length; i++) m += Math.hypot(f.pts[i].x - prev.pts[i].x, f.pts[i].y - prev.pts[i].y);
    if (m / f.pts.length / f.len > 0.18) return "jump";
    // суставы не могут поворачиваться на десятки градусов за один кадр
    if (Math.max(Math.abs(f.knee - prev.knee), Math.abs(f.elbow - prev.elbow), Math.abs(f.hip - prev.hip)) > 40) return "jump";
  }
  return null;
}
export const PROBLEM_TEXT = {
  hidden: "Встань так, чтобы всё тело было видно",
  outside: "Отойди дальше, ты выходишь за кадр",
  far: "Подойди ближе к камере",
  anatomy: "Не вижу человека целиком",
  jump: null,
};

// ---------- Связки: элементы, которые чередуются без сброса счётчиков ----------
// Например: стоишь в планке → отжался пару раз → снова планка. Время планки идёт дальше, отжимания считаются.
export const FAMILIES = [["plank", "pushup"], ["hang", "pullup", "legraise"]];
export const familyOf = k => FAMILIES.find(g => g.includes(k)) || (k ? [k] : []);

// ---------- Распознавание элемента по одному кадру ----------
// rng: размах движения суставов за последние ~1.5 с {elbow, knee, hip}
export function classify(f, rng) {
  if (f.conf < 0.5) return null;
  const horiz = f.bodyH < 35;
  // вниз головой
  if (f.torsoV > 135 && f.bodyH > 55) return "handstand";
  // лёжа на спине, колени согнуты — ягодичный мост
  if (f.bodyH < 35 && f.torsoV > 50 && f.knee < 125 && f.noseUp && Math.abs(f.wristBelowSh) < 0.18 && f.feetAboveHands < 0.15) return "bridge";
  if (f.hipHighest && f.hip < 125 && f.wristBelowSh > 0.1 && f.torsoV > 60) return "pike";
  // наклонное тело лицом вверх, руки на перекладине над собой — австралийские подтягивания
  if (f.noseUp && f.wristBelowSh < -0.15 && f.torsoV > 45 && f.bodyH < 55 && f.bodyH >= 12 && (rng.elbow > 25 || f.elbow < 140)) return "row";
  // корпус горизонтально
  if (horiz && f.torsoV > 50) {
    if (f.wristStack > 0.3) return "flag";
    if (f.shoulderStack > 0.18 && f.shoulderWidth < 0.12) return "sideplank";
    if (f.wristHip > 1.6 && Math.abs(f.wristBelowSh) < 0.18 && f.noseUp) return "hollow";
    if (f.wristBelowSh < -0.2) return f.noseUp ? "frontlever" : "backlever";
    if (f.forearmFlat && rng.elbow < 20) return "elbowplank";
    if (f.wristBelowSh > 0.15) {
      if (f.feetAboveHands > 0.2 && f.bodyH < 15 && f.elbow > 145) return "planche";
      if (rng.elbow > 25 || f.elbow < 130) return "pushup";
      return "plank";
    }
    if (f.feetAboveHands < 0.12 && f.elbow < 125) return "elbowplank";
    return null;
  }
  // корпус вертикально
  if (f.torsoV < 45) {
    if (f.handsHigh) {
      if (f.hip < 135 || rng.hip > 30) return "legraise";
      if (rng.elbow > 25 || f.elbow < 140) return "pullup";
      return "hang";
    }
    if (f.hip < 125 && f.knee > 140 && f.legElev > -30 && f.wristNearHip < 0.3) return "lsit";
    if (rng.knee > 25 || f.kneeMin < 130) {
      const lunge = (f.shoulderWidth < 0.12 && f.spread > 0.35) || f.kneeLevel > 0.12;
      return lunge ? "lunge" : "squat";
    }
    if (rng.elbow > 25 && rng.knee < 15 && f.wristBelowSh > 0.1) return "dip";
  }
  return null;
}

// Сглаживание: элемент считается распознанным, если доминирует ~1 секунду
export class Recognizer {
  constructor(windowMs = 1000, minShare = 0.7) { this.buf = []; this.win = windowMs; this.share = minShare; }
  clear() { this.buf = []; }
  push(key, t) {
    this.buf.push({ key, t });
    while (this.buf.length && t - this.buf[0].t > this.win) this.buf.shift();
    if (this.buf.length < 6) return null;
    const cnt = {};
    for (const b of this.buf) if (b.key) cnt[b.key] = (cnt[b.key] || 0) + 1;
    let best = null, n = 0;
    for (const k in cnt) if (cnt[k] > n) { n = cnt[k]; best = k; }
    return best && n / this.buf.length >= this.share ? best : null;
  }
}

// ---------- Счётчик повторов с оценкой качества ----------
const msgOf = (c, f) => typeof c.msg === "function" ? c.msg(f) : c.msg;
function weighted(parts) {
  let s = 0, w = 0;
  for (const p of parts) { s += p.s * p.w; w += p.w; }
  return w ? s / w : 0;
}

export class RepEngine {
  constructor(key) { this.key = key; this.def = EXERCISES[key]; this.reset(); }
  reset() { this.reps = 0; this.scores = []; this.lastScore = null; this.lastRepT = -1e9; this.interrupt(); }
  // сброс текущей фазы (после ненадёжных кадров) — начатый повтор не засчитывается
  interrupt() { this.state = "up"; this.topMax = null; this.rep = null; this.buf = []; this.lastM = null; this.speeds = []; this.prevRaw = null; this.prevT = null; this.belowT = null; this.aboveT = null; this.liveScore = 1; }
  // отмена повторов (команда «нет»)
  undoTo(n) { this.reps = Math.min(this.reps, n); this.scores.length = this.reps; this.lastScore = this.scores.at(-1) ?? null; this.interrupt(); }
  // возвращает список событий: {type:'rep', n, score, tip} | {type:'cue', key, text} | {type:'partial', text}
  update(f, t) {
    const d = this.def, ev = [];
    // медиана последних 5 кадров — гасит дрожание точек
    const raw = d.metric(f);
    // скорость изменения угла: дрожание точек даёт сотни градусов в секунду
    if (this.prevRaw != null && t > this.prevT) {
      const v = Math.abs(raw - this.prevRaw) / ((t - this.prevT) / 1000);
      this.speeds.push(v); if (this.speeds.length > 5) this.speeds.shift();
    }
    this.prevRaw = raw; this.prevT = t;
    if (this.speeds.length >= 3 && this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length > 450) {
      this.interrupt(); return [{ type: "noise" }];
    }
    this.buf.push(raw); if (this.buf.length > 5) this.buf.shift();
    const m = [...this.buf].sort((a, b) => a - b)[this.buf.length >> 1]; this.lastM = m;
    if (this.state === "up") {
      this.topMax = Math.max(this.topMax ?? m, m);
      if (m < d.down) {                         // фаза «вниз» должна продержаться ≥120 мс
        this.belowT ??= t;
        if (t - this.belowT >= 120) {
          this.state = "down"; this.aboveT = null;
          this.rep = { t0: this.belowT, best: {}, worst: {}, worstF: {}, topMax: this.topMax };
        }
      } else this.belowT = null;
    }
    if (this.state === "down") {
      const r = this.rep;
      let live = [];
      for (const c of d.checks) {
        if (c.at !== "best" && c.at !== "worst") continue;
        const s = lin(c.fn(f), c.good, c.bad);
        if (c.at === "best") r.best[c.k] = Math.max(r.best[c.k] ?? 0, s);
        else {
          if (s < (r.worst[c.k] ?? 1)) { r.worst[c.k] = s; r.worstF[c.k] = f; }
          live.push({ s, w: c.w });
          if (s < 0.35) ev.push({ type: "cue", key: c.k, text: msgOf(c, f) });
        }
      }
      this.liveScore = live.length ? weighted(live) : 1;
      if (m > d.up) this.aboveT ??= t; else this.aboveT = null;
      if (this.aboveT != null && t - this.aboveT >= 100) {
        this.state = "up"; this.belowT = null;
        this.topMax = m;
        const dur = (t - r.t0) / 1000;
        // слишком быстро для человека — это шум, не повтор
        if (dur < (d.minRep ?? 0.6) || t - this.lastRepT < 350) { ev.push({ type: "noise" }); return ev; }
        const req = d.checks.find(c => c.k === d.req);
        if ((r.best[d.req] ?? 0) <= 0.01) {
          ev.push({ type: "partial", text: msgOf(req, f) });
        } else {
          const parts = d.checks.map(c => {
            let s;
            if (c.at === "best") s = r.best[c.k] ?? 0;
            else if (c.at === "worst") s = r.worst[c.k] ?? 1;
            else if (c.at === "top") s = r.topMax == null ? 1 : lin(r.topMax, c.good, c.bad);
            else s = lin(dur, c.good, c.bad);
            return { c, s, w: c.w };
          });
          const score = Math.round(weighted(parts) * 100);
          const weakest = parts.reduce((a, b) => (b.s * b.w < a.s * a.w ? b : a));
          const tip = weakest.s < 0.6 ? msgOf(weakest.c, r.worstF[weakest.c.k] || f) : null;
          this.reps++; this.scores.push(score); this.lastScore = score; this.lastRepT = t;
          ev.push({ type: "rep", n: this.reps, score, tip });
        }
      } else if (t - r.t0 > 10000) this.interrupt(); // застрял внизу — сброс
    } else this.liveScore = 1;
    return ev;
  }
  get avg() { return this.scores.length ? Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length) : null; }
  get busy() { return this.state === "down"; }
  // в движении: не в верхней точке (повтор начинается или заканчивается)
  get moving() { return this.state === "down" || (this.lastM != null && this.lastM < this.def.up) || (this.prevRaw != null && this.prevRaw < this.def.up); }
  get count() { return this.reps; }
}

// ---------- Удержание статики с оценкой качества ----------
export class HoldEngine {
  constructor(key) { this.key = key; this.def = EXERCISES[key]; this.reset(); }
  reset() { this.total = 0; this.cur = 0; this.best = 0; this.qSum = 0; this.q = null; this.lostAt = null; this.lastT = null; this.nextCall = 5; this.lastScore = null; }
  interrupt() { this.lastT = null; }
  undoTo() { this.total = Math.max(0, this.total - this.cur); this.qSum = Math.max(0, this.qSum - (this.q ?? 0) * this.cur); this.cur = 0; this.nextCall = 5; }
  update(f, t, inPose = true) {
    const ev = [];
    const dt = this.lastT == null ? 0 : Math.min(0.25, (t - this.lastT) / 1000);
    this.lastT = t;
    const parts = this.def.checks.map(c => ({ c, s: lin(c.fn(f), c.good, c.bad), w: c.w }));
    const s = weighted(parts);
    this.q = this.q == null ? s : this.q * 0.85 + s * 0.15;
    const holding = inPose && this.q > 0.35;
    if (holding) {
      this.lostAt = null;
      this.cur += dt; this.total += dt; this.qSum += this.q * dt;
      this.best = Math.max(this.best, this.cur);
      if (this.cur >= this.nextCall) { ev.push({ type: "time", sec: this.nextCall }); this.nextCall += this.nextCall < 30 ? 5 : 10; }
      const weakest = parts.reduce((a, b) => (b.s * b.w < a.s * a.w ? b : a));
      if (weakest.s < 0.4) ev.push({ type: "cue", key: weakest.c.k, text: msgOf(weakest.c, f) });
    } else {
      if (this.lostAt == null) this.lostAt = t;
      if (t - this.lostAt > 1500 && this.cur > 0) {
        if (this.cur >= 2) ev.push({ type: "holdEnd", sec: this.cur });
        this.cur = 0; this.nextCall = 5;
      }
    }
    this.lastScore = Math.round(this.q * 100);
    return ev;
  }
  get avg() { return this.total > 0.5 ? Math.round(this.qSum / this.total * 100) : null; }
  get liveScore() { return this.q ?? 1; }
  get busy() { return false; }
  get count() { return this.cur; }
}

export const makeEngine = key => EXERCISES[key].type === "reps" ? new RepEngine(key) : new HoldEngine(key);

// ---------- Голосовые команды ----------
// Возвращает {cmd:'no'|'auto'|'pause'|'resume'|'set', key?}
const ALIASES = [
  ["pike", ["пайк", "пике", "пик отжим", "отжимания уголком"]],
  ["dip", ["брус", "брусья", "брусьях", "дипс"]],
  ["pushup", ["отжиман", "отжимания", "отжимание"]],
  ["squat", ["присед"]],
  ["lunge", ["выпад"]],
  ["row", ["австралийск", "горизонтальн", "тяга лежа", "тяга лёжа"]],
  ["pullup", ["подтяг"]],
  ["legraise", ["подъём ног", "подъем ног", "ноги в висе", "подъемы ног", "подъёмы ног"]],
  ["sideplank", ["боковая планка", "боковую планку", "боковой планк"]],
  ["elbowplank", ["планка на локтях", "планку на локтях", "на локтях", "на предплечьях"]],
  ["plank", ["планк"]],
  ["bridge", ["мост", "ягодичн"]],
  ["lsit", ["уголок", "уголка", "л сит", "эл сит", "l-sit", "lsit"]],
  ["handstand", ["стойка на руках", "стойку на руках", "стойка", "хендстенд"]],
  ["frontlever", ["передний вис", "фронт левер", "фронтлевер", "передний рычаг"]],
  ["backlever", ["задний вис", "бэк левер", "бек левер", "задний рычаг"]],
  ["hang", ["вис"]],
  ["hollow", ["лодочк", "холлоу"]],
  ["planche", ["планш"]],
  ["flag", ["флаг"]],
];
export function parseCommand(text) {
  const t = " " + text.toLowerCase().replace(/ё/g, "е").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (/ (нет|не то|не это|неправильно|неверно|ошибка|отмена|не так) /.test(t)) {
    // «нет, это отжимания» — сразу переключаем
    const rest = t.replace(/ (нет|не то|не это|неправильно|неверно|ошибка|отмена|не так) /, " ");
    const k = findAlias(rest); return k ? { cmd: "set", key: k, rejected: true } : { cmd: "no" };
  }
  if (/ (авто|автомат|сам определ)/.test(t)) return { cmd: "auto" };
  if (/ (пауза|стоп|хватит|перерыв)/.test(t)) return { cmd: "pause" };
  if (/ (продолж|дальше|поехали|старт|начали)/.test(t)) return { cmd: "resume" };
  const k = findAlias(t); return k ? { cmd: "set", key: k } : null;
}
export function findAlias(t) {
  const norm = t.replace(/ё/g, "е");
  for (const [k, words] of ALIASES) if (words.some(w => norm.includes(w.replace(/ё/g, "е")))) return k;
  return null;
}

// ============================================================
//  Сессия тренировки: распознавание + связки + отмена.
//  Используется и приложением, и тестами.
// ============================================================
export class Session {
  constructor() { this.reset(); }
  reset() {
    this.engines = {}; this.rec = new Recognizer(); this.hist = [];
    this.mode = "auto"; this.cur = null; this.blocked = new Map(); this.atDetect = {}; this.noiseT = [];
    this.lastGood = null; this.errors = {}; this.errT = {};   // errors[ex][текст] = сколько раз
  }
  engine(k) { return this.engines[k] ||= makeEngine(k); }
  get family() { return familyOf(this.cur); }
  get busy() { return this.family.some(k => this.engine(k).busy); }
  markDetect() { this.atDetect = {}; for (const k of this.family) this.atDetect[k] = this.engine(k).count; }
  setManual(k) { this.mode = "manual"; this.cur = k; this.rec.clear(); this.markDetect(); }
  setAuto() { this.mode = "auto"; this.cur = null; this.rec.clear(); this.hist = []; }
  // «Нет»: откатить всё, что насчитано с момента распознавания, и временно не предлагать этот элемент
  reject(t) {
    const k = this.cur; if (!k) return null;
    for (const m of this.family) { const e = this.engine(m); if (m in this.atDetect) e.undoTo(this.atDetect[m]); }
    this.blocked.set(k, t + 20000);
    this.setAuto();
    return k;
  }
  // кадр, которому нельзя доверять
  bad(t) {
    const ev = [];
    for (const k of this.family) {
      const e = this.engine(k);
      if (e.def.type === "hold" && this.lastGood) ev.push(...e.update(this.lastGood, t, false).map(x => ({ ...x, ex: k })));
      else e.interrupt();
    }
    this.hist = []; this.rec.clear();
    return ev;
  }
  // нормальный кадр → события {type, ex, ...} и switched (новый распознанный элемент)
  frame(f, t) {
    this.lastGood = f;
    this.hist.push({ t, f }); while (t - this.hist[0].t > 1500) this.hist.shift();
    let cand = null, switched = null;
    if (this.mode === "auto") {
      const rg = key => { let a = Infinity, b = -Infinity; for (const h of this.hist) { a = Math.min(a, h.f[key]); b = Math.max(b, h.f[key]); } return b - a; };
      cand = classify(f, { elbow: rg("elbow"), knee: rg("knee"), hip: rg("hip") });
      if (cand && this.blocked.get(cand) > t) cand = null;
      const det = this.rec.push(cand, t);
      if (det && det !== this.cur && !(this.cur && this.busy)) {
        const same = this.family.includes(det);
        this.cur = det;
        if (!same) {                                   // новый элемент: запоминаем точку отката и «доигрываем» начало движения
          switched = det; this.markDetect();
          for (const h of this.hist.slice(0, -1)) for (const k of this.family) this.engine(k).update(h.f, h.t, true);
        }
      }
    }
    const ev = [];
    const fam = this.family;
    // сначала счётчики повторов, потом удержания — чтобы удержание знало, идёт ли сейчас повтор
    for (const k of [...fam].sort((a, b) => (this.engine(a).def.type === "reps" ? 0 : 1) - (this.engine(b).def.type === "reps" ? 0 : 1))) {
      const e = this.engine(k);
      const inPose = this.mode === "manual" ? true : (cand ? fam.includes(cand) : e.count > 0 || k === this.cur);
      // пока в связке идёт повтор (например, отжимание из планки), удержание не делает замечаний
      const partnerBusy = e.def.type === "hold" && fam.some(m => m !== k && this.engine(m).def.type === "reps" && this.engine(m).moving);
      for (const x of e.update(f, t, inPose)) {
        if (partnerBusy && x.type === "cue") continue;
        ev.push({ ...x, ex: k });
        if (x.type === "cue" || (x.type === "rep" && x.tip) || x.type === "partial") {
          // одна и та же ошибка считается не чаще раза в 4 секунды (а не на каждом кадре)
          const txt = x.text || x.tip, id = k + "|" + txt;
          if (x.type !== "cue" || !(t - (this.errT[id] ?? -1e9) < 4000)) (this.errors[k] ||= {})[txt] = (this.errors[k][txt] || 0) + 1;
          this.errT[id] = t;
        }
        if (x.type === "noise") {
          this.rec.clear(); this.noiseT = this.noiseT.filter(n => t - n < 3000); this.noiseT.push(t);
          const nothing = fam.every(m => this.engine(m).count === (this.atDetect[m] ?? 0));
          if (this.mode === "auto" && this.noiseT.length >= 3 && nothing) { this.cur = null; this.noiseT = []; }
        }
      }
    }
    return { ev, switched, cand };
  }
  // итоги для экрана и для ИИ-тренера
  summary() {
    return Object.values(this.engines).filter(e => e.def.type === "reps" ? e.reps > 0 : e.total >= 1).map(e => ({
      key: e.key, name: e.def.name, type: e.def.type,
      reps: e.reps, total: e.total, best: e.best, avg: e.avg,
      errors: Object.entries(this.errors[e.key] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3),
    }));
  }
}
