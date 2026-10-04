# Brainrot

TikTok, Instagram Reels and YouTube Shorts, side by side and in sync.

Brainrot puts the three short-video feeds in three columns of one window and keeps them in step: scroll one and the other two follow.

It comes in two forms that share the same idea:

- **Desktop app** (Electron + React) for Windows and macOS
- **Browser extension** (Chrome, Manifest V3) that opens the same layout in a tab

## Features

- **Sync Scroll**: scrolling one feed (wheel, trackpad or Up/Down keys) advances the other two.
- **Sync Audio**: only the feed under the pointer plays sound. Turn it off to hear all three.
- **Auto Scroll**: moves to the next video when the current one finishes. With Sync Scroll on, the hovered feed sets the pace for all three.
- **Per-feed mute and reload** buttons in each column header.
- **TikTok photo posts**: drag, Left/Right keys or sideways scroll to move through the slides.
- **Fill Video** (extension only): zooms each column onto the video.
- **Sign-in support**: "Continue with Google / Facebook / Apple" popups stay inside the app so the login lands back in the feed. Logins persist between launches.

## Desktop app

Requires [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev      # Vite dev server + Electron with hot reload
npm start        # production build, then launch
```

### Building installers

```sh
npm run dist:win   # NSIS installer for Windows
npm run dist:mac   # dmg + zip for macOS (run on a Mac)
```

Installers are written to `release/`.

## Browser extension

No build step.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Click the Brainrot toolbar icon to open the page.

The sites normally forbid being loaded in frames. The extension strips those headers, but only for frames inside a Brainrot tab, never for normal browsing.

## Project layout

```
electron/
  main.js             Main process: window, webview lockdown, sync IPC
  preload.js          API exposed to the React UI
  webview-preload.js  Injected into each feed: scroll detection and navigation
src/                  React UI (Vite + Tailwind)
extension/            Chrome extension version
```

## When a site changes its layout

Feeds are advanced by clicking each site's own next/previous buttons, with a scroll fallback if none are found. The selectors are listed at the top of `electron/webview-preload.js` (and `extension/content.js` for the extension), with notes on how to find new ones.

## Security notes

- Feeds run in sandboxed `<webview>`s with context isolation and no Node integration; the main process enforces this regardless of what the renderer asks for.
- Only `www.tiktok.com`, `www.instagram.com` and `www.youtube.com` can be loaded as a feed.
- Feeds are denied every permission except fullscreen (no camera, microphone, location or notifications).
- Non-login popups open in your default browser.

## Disclaimer

Brainrot is an unofficial project and is not affiliated with or endorsed by TikTok, Instagram, Meta, YouTube or Google. It displays their websites as-is; your use of them remains subject to their terms.

## License

[MIT](LICENSE)
