const path = require("node:path");
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { startLocalGameServer } = require("./local-server.cjs");

const isSquirrelStartup = require("electron-squirrel-startup");
if (isSquirrelStartup) {
  app.quit();
}

const ONLINE_MULTIPLAYER_HOST = "cinrostro.onrender.com";
const LOCAL_GAME_PORT = 32158;
const hasSingleInstanceLock = !isSquirrelStartup && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let localGameServer = null;
let gameOrigin = null;
let gameStartUrl = null;
let showingFallbackPage = false;

function isGameUrl(rawUrl) {
  try {
    return Boolean(gameOrigin) && new URL(rawUrl).origin === gameOrigin;
  } catch {
    return false;
  }
}

function isAllowedRuntimeRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (isGameUrl(rawUrl)) return true;
    if (["blob:", "data:", "devtools:", "file:"].includes(url.protocol)) return true;
    return url.protocol === "wss:" && url.hostname === ONLINE_MULTIPLAYER_HOST;
  } catch {
    return false;
  }
}

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "http:") {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed links from game content.
  }
}

function loadFallbackPage() {
  if (!mainWindow) return;
  showingFallbackPage = true;
  void mainWindow.loadFile(path.join(__dirname, "offline.html"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#080b10",
    title: "USA Tank V8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) {
      void mainWindow.loadURL(url);
      return { action: "deny" };
    }

    openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isGameUrl(url)) {
      return;
    }

    if (url.startsWith("file:")) {
      event.preventDefault();
      try {
        const retryUrl = new URL(url);
        if (retryUrl.searchParams.get("retry") === "1" && gameStartUrl) {
          void mainWindow.loadURL(gameStartUrl);
        }
      } catch {
        // Keep malformed file URLs blocked.
      }
      return;
    }

    event.preventDefault();
    openExternal(url);
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, _errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || validatedUrl.startsWith("file:")) {
        return;
      }

      loadFallbackPage();
    }
  );

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow.webContents.getURL();
    if (isGameUrl(currentUrl)) {
      showingFallbackPage = false;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  void mainWindow.loadURL(gameStartUrl);
}

app.whenReady().then(async () => {
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "public")
    : path.resolve(__dirname, "..", "public");
  const threeDir = path.join(__dirname, "node_modules", "three");

  try {
    // A stable loopback port gives the installed game a stable browser origin,
    // so localStorage saves and progression survive across launches.
    localGameServer = await startLocalGameServer({
      publicDir,
      threeDir,
      port: LOCAL_GAME_PORT,
    });
    gameOrigin = localGameServer.origin;
    gameStartUrl = `${gameOrigin}/?desktop=1`;
  } catch (error) {
    dialog.showErrorBox(
      "USA Tank V8 could not start",
      `The installed local game files could not be opened.\n\n${error.message}`
    );
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRuntimeRequest(details.url) });
  });

  createWindow();

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (showingFallbackPage && mainWindow) {
      void mainWindow.loadURL(gameStartUrl);
    }
  });
});

app.on("before-quit", () => {
  if (localGameServer) {
    localGameServer.server.close();
    localGameServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
