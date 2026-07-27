const path = require("node:path");
const { app, BrowserWindow, session, shell } = require("electron");

if (require("electron-squirrel-startup")) {
  app.quit();
}

const GAME_URL = "https://cinrostro.onrender.com/";
const GAME_ORIGIN = new URL(GAME_URL).origin;

let mainWindow = null;
let showingOfflinePage = false;

function isGameUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === GAME_ORIGIN;
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
    // Ignore malformed URLs from remote page content.
  }
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
    if (isGameUrl(url) || url.startsWith("file:")) {
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

      showingOfflinePage = true;
      void mainWindow.loadFile(path.join(__dirname, "offline.html"));
    }
  );

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow.webContents.getURL();
    if (isGameUrl(currentUrl)) {
      showingOfflinePage = false;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  void mainWindow.loadURL(GAME_URL);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (showingOfflinePage && mainWindow) {
      void mainWindow.loadURL(GAME_URL);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
