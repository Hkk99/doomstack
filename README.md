# Doomstack

TikTok, Instagram Reels and YouTube Shorts, side by side and in sync.

Doomstack is a Chrome extension that puts the three short-video feeds in three columns of one tab and keeps them in step: scroll one and the other two follow.

## Features

- **Sync Scroll**: scrolling one feed (wheel, trackpad or Up/Down keys) advances the other two.
- **Sync Audio**: only the feed under the pointer plays sound. Turn it off to hear all three.
- **Auto Scroll**: moves to the next video when the current one finishes. With Sync Scroll on, the hovered feed sets the pace for all three.
- **Fill Video**: zooms TikTok and Instagram onto the video, hiding their menus. Turn it off to reach menus, search or login.
- **Per-feed mute and reload** buttons in each column header.

## Install

There is no build step.

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repo folder (the one containing `manifest.json`).
4. Click the Doomstack toolbar icon to open the page.

Built and tested in Chrome. Other Chromium browsers with Manifest V3 support should work but are untested.

## How it works

| File | Role |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Opens the page from the toolbar icon; lets the three sites load in frames |
| `index.html`, `app.js`, `app.css` | The Doomstack page: three frames and the sync logic |
| `content.js` | Runs inside each feed frame: detects scrolling, advances the feed, mutes it |

The sites normally send headers that forbid being loaded in a frame. The extension removes those headers, but only for frames inside a Doomstack tab, never for normal browsing. The content script likewise does nothing on the three sites unless the page is a feed frame inside a Doomstack tab.

## When a site changes its layout

Feeds are advanced by clicking each site's own next/previous buttons, with a scroll fallback if none are found. The selectors are listed at the top of `content.js`, with notes on how to find new ones.

## Permissions

- `declarativeNetRequest`: to remove the frame-blocking headers described above.
- Host access to `tiktok.com`, `instagram.com` and `youtube.com`: to run the content script in the feed frames.

Doomstack collects no data and makes no network requests of its own.

## Disclaimer

Doomstack is an unofficial project and is not affiliated with or endorsed by TikTok, Instagram, Meta, YouTube or Google. It displays their websites as-is; your use of them remains subject to their terms.

## License

[MIT](LICENSE)
