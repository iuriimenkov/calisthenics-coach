// Готовит папку web/ для настольной версии:
// копирует веб-приложение, кладёт рядом библиотеку MediaPipe и модель позы,
// и переписывает адреса из интернета на локальные файлы — чтобы всё работало без сети.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(__dirname, "web");
const VENDOR = path.join(WEB, "vendor");
const MP_VER = "0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(VENDOR, { recursive: true });

for (const f of ["index.html", "logic.js", "library.js", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(WEB, f));
}

// MediaPipe из node_modules
const mp = path.join(__dirname, "node_modules", "@mediapipe", "tasks-vision");
fs.cpSync(path.join(mp, "wasm"), path.join(VENDOR, "wasm"), { recursive: true });
fs.copyFileSync(path.join(mp, "vision_bundle.mjs"), path.join(VENDOR, "vision_bundle.mjs"));

// переписываем адреса
let html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const swaps = [
  [`"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs"`, `"./vendor/vision_bundle.mjs"`],
  [`"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm"`, `new URL("./vendor/wasm", location.href).href`],
  [`"${MODEL_URL}"`, `new URL("./vendor/pose_landmarker_lite.task", location.href).href`],
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) { console.error("Не найдено в index.html:", from); process.exit(1); }
  html = html.split(from).join(to);
}
fs.writeFileSync(path.join(WEB, "index.html"), html);

// модель позы
(async () => {
  const res = await fetch(MODEL_URL);
  if (!res.ok) { console.error("Не удалось скачать модель:", res.status); process.exit(1); }
  fs.writeFileSync(path.join(VENDOR, "pose_landmarker_lite.task"), Buffer.from(await res.arrayBuffer()));
  console.log("web/ готова:", fs.readdirSync(WEB).join(", "), "| vendor:", fs.readdirSync(VENDOR).join(", "));
})();
