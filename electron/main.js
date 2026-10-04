const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');
const FEED_PARTITION = 'persist:feeds';

// Only these hosts may be loaded as the initial src of a <webview>.
const ALLOWED_FEED_HOSTS = ['www.tiktok.com', 'www.instagram.com', 'www.youtube.com'];

// The three guest webContents (one per <webview>), tracked as they attach.
const guests = new Set();
let syncScroll = true;
let autoScroll = false;
let leaderId = null; // webContents id of the feed that paces Auto Scroll

// Windows marks a window "hidden" as soon as another window covers it, which
// makes the feeds pause and stops Auto Scroll. Treat covered as still visible.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Some sites refuse to serve "Electron" user agents, so present as plain Chrome.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}/\\S+`, 'i'), '');

function isAllowedFeedUrl(src) {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && ALLOWED_FEED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

// Hosts allowed to open as an in-app popup window (sign-in flows only).
const LOGIN_POPUP_HOSTS = [
  'accounts.google.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'appleid.apple.com',
];

function isLoginPopupUrl(src) {
  // Some sites open a blank popup first and navigate it afterwards.
  if (!src || src === 'about:blank') return true;
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:') return false;
    return LOGIN_POPUP_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 600,
    backgroundColor: '#09090b', // zinc-950, avoids a white flash on launch
    show: false,
    // macOS: keep the native traffic lights, inset into our custom header.
    // Windows: fully frameless, the React header draws its own controls.
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    ...(isWindows ? { frame: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false, // see will-attach-webview below
    },
  });

  win.once('ready-to-show', () => win.show());

  const sendMaximized = () => win.webContents.send('window:maximized-changed', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // Lock down every <webview> before it is created: the renderer does not get
  // to choose the preload script or loosen the security preferences.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedFeedUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preloadURL;
    webPreferences.preload = WEBVIEW_PRELOAD;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // Keep feeds animating when the window is covered or minimized, otherwise
    // Auto Scroll stalls: the sites' scroll/slide transitions never run.
    webPreferences.backgroundThrottling = false;
  });

  win.webContents.on('did-attach-webview', (_event, guest) => {
    guests.add(guest);
    guest.once('destroyed', () => guests.delete(guest));

    // Start silent; the renderer unmutes whichever column is hovered.
    guest.setAudioMuted(true);

    // "Continue with Google/Facebook/Apple" opens a popup that must stay inside
    // the app (same session, with window.opener intact) for the login to land
    // back in the feed. Everything else goes to the real browser.
    guest.setWindowOpenHandler(({ url }) => {
      if (isLoginPopupUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: win,
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            backgroundColor: '#ffffff',
            webPreferences: {
              partition: FEED_PARTITION,
              preload: undefined,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    // Login popups themselves may not open further windows.
    guest.on('did-create-window', (popup) => {
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
  });

  // The app window itself only ever shows our own UI.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ---------------------------------------------------------------------------
// IPC: window controls (used by the custom Windows title bar)
// ---------------------------------------------------------------------------
ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('window:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

// ---------------------------------------------------------------------------
// IPC: feed sync
// ---------------------------------------------------------------------------
ipcMain.on('sync:set-scroll', (_event, enabled) => {
  syncScroll = Boolean(enabled);
});

// A feed reports that the user scrolled it (see webview-preload.js). Tell the
// other two feeds to advance in the same direction.
ipcMain.on('feed:navigate', (event, direction) => {
  if (!syncScroll) return;
  if (direction !== 'next' && direction !== 'prev') return;
  if (!guests.has(event.sender)) return;

  for (const guest of guests) {
    if (guest === event.sender || guest.isDestroyed()) continue;
    guest.send('feed:advance', direction);
  }
});

ipcMain.on('sync:set-auto-scroll', (_event, enabled) => {
  autoScroll = Boolean(enabled);
});

// The renderer names the feed whose video length drives Auto Scroll while
// Sync Scroll is on (the hovered column).
ipcMain.on('sync:set-leader', (_event, webContentsId) => {
  leaderId = Number.isInteger(webContentsId) ? webContentsId : null;
});

// A feed reports that its on-screen video finished playing.
ipcMain.on('feed:video-ended', (event) => {
  if (!autoScroll || !guests.has(event.sender)) return;

  if (!syncScroll) {
    // Independent feeds: each one moves on when its own video ends.
    event.sender.send('feed:advance', 'next');
    return;
  }

  // Synced feeds: only the leader's video ending moves everyone on, so the
  // three stay in step even though their videos have different lengths.
  if (event.sender.id !== leaderId) return;
  for (const guest of guests) {
    if (!guest.isDestroyed()) guest.send('feed:advance', 'next');
  }
});

app.whenReady().then(() => {
  // The feeds only need fullscreen; deny notifications, camera, location, etc.
  session.fromPartition(FEED_PARTITION).setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
