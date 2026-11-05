// Настольная версия AI-тренера (Windows / macOS).
// Открывает то же веб-приложение из локальных файлов: всё работает без интернета,
// модель распознавания позы лежит внутри установщика.
const { app, BrowserWindow, protocol, session, systemPreferences, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const WEB = path.join(__dirname, "web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".task": "application/octet-stream",
};

// Своя защищённая схема app:// — нужна, чтобы работали модули JS и доступ к камере (как на https)
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Один экземпляр приложения
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 600,
    backgroundColor: "#0f1115", autoHideMenuBar: true, title: "AI-тренер",
    icon: path.join(WEB, "icon-512.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL("app://local/index.html");
}

app.whenReady().then(async () => {
  protocol.handle("app", async req => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB)) return new Response("Forbidden", { status: 403 });
    try {
      const data = await fs.readFile(file);
      return new Response(data, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" } });
    } catch { return new Response("Not found", { status: 404 }); }
  });

  // Разрешаем приложению камеру и удержание экрана, остальное — нет
  const allowed = new Set(["media", "wakeLock", "screen-wake-lock", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));

  // macOS спрашивает разрешение на камеру у системы
  if (process.platform === "darwin") { try { await systemPreferences.askForMediaAccess("camera"); } catch {} }

  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
