// Preload injected into each feed <webview> (TikTok / Instagram / YouTube).
// It does two things:
//   1. Reports the user's own scroll gestures to the main process.
//   2. Advances this feed when the main process says another feed was scrolled.
//
// It runs sandboxed in an isolated world: it can touch the page's DOM but the
// page cannot see or call anything in here.
const { ipcRenderer } = require('electron');

// ===========================================================================
// SELECTORS — UPDATE THESE WHEN A PLATFORM CHANGES ITS LAYOUT
// ===========================================================================
// For each platform, `next` / `prev` are lists of CSS selectors for the
// "next video" / "previous video" control. They are tried in order and the
// first one that matches a visible, enabled element is clicked. If a selector
// matches an icon (e.g. an <svg>), its nearest button ancestor is clicked.
//
// If none match, we fall back to scrolling the feed by one screen, which works
// on all three sites because their feeds are scroll-snap containers.
//
// To find a new selector: open the site in Chrome, inspect the down/up arrow
// next to the video, and prefer stable attributes (id, data-e2e, aria-label)
// over generated class names like "css-1a2b3c".
const PLATFORMS = {
  tiktok: {
    host: /(^|\.)tiktok\.com$/,
    next: [
      // For You feed: down arrow in the navigation rail right of the video.
      'button[data-e2e="feed-navigation-next"]',
      '[class*="FeedNavigationContainer"] button:last-of-type',
    ],
    prev: [
      'button[data-e2e="feed-navigation-prev"]',
      '[class*="FeedNavigationContainer"] button:first-of-type',
    ],
    // Photo posts (image sliders). TikTok's own UI only offers two tiny arrows
    // under the photo; we find them via the progress dots that sit between
    // them, and click them when the user drags, presses Left/Right or scrolls
    // sideways over the photo.
    photo: {
      item: 'article, [data-e2e="recommend-list-item-container"]', // one feed post
      surface: '.swiper', // the photo area
      dots: '[class*="PhotoProgress"]', // progress dots between the two arrows
    },
  },

  instagram: {
    host: /(^|\.)instagram\.com$/,
    next: [
      // Reels: chevron buttons right of the video (the label is on the <svg>).
      // Logged out, Instagram renders no such buttons, so the scroll fallback
      // below does the work; these only matter if a logged-in layout has them.
      'svg[aria-label="Navigate to next Reel"]',
      '[aria-label="Navigate to next Reel"]',
      'svg[aria-label="Next"]',
    ],
    prev: [
      'svg[aria-label="Navigate to previous Reel"]',
      '[aria-label="Navigate to previous Reel"]',
      'svg[aria-label="Previous"]',
    ],
  },

  youtube: {
    host: /(^|\.)youtube\.com$/,
    next: [
      // Shorts: down/up arrow buttons on the right edge of the player.
      '#navigation-button-down button',
      'button[aria-label="Next video"]',
    ],
    prev: [
      '#navigation-button-up button',
      'button[aria-label="Previous video"]',
    ],
  },
};
// ===========================================================================

const platform = Object.values(PLATFORMS).find((p) => p.host.test(location.hostname));

function clickFirstMatch(selectors) {
  for (const selector of selectors) {
    const match = document.querySelector(selector);
    if (!match) continue;
    const target = match.closest('button, [role="button"], a') || match;
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') continue;
    if (target.getClientRects().length === 0) continue; // not rendered
    target.click();
    return true;
  }
  return false;
}

// Fallback, first choice: bring the neighbouring video to the middle of the
// screen. A post is often shorter than the screen (Instagram), so scrolling by
// a full screen would overshoot and leave two half-visible posts.
function centerNeighbourVideo(direction) {
  const middle = window.innerHeight / 2;
  const centers = [...document.querySelectorAll('video')]
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return { video, center: rect.top + rect.height / 2, height: rect.height };
    })
    .filter((entry) => entry.height > 200);
  if (centers.length === 0) return false;

  const current = centers.reduce((a, b) => (Math.abs(a.center - middle) <= Math.abs(b.center - middle) ? a : b));
  const margin = current.height / 2; // skip duplicates stacked on the current video
  const candidates = centers
    .filter((entry) => (direction === 'next' ? entry.center > current.center + margin : entry.center < current.center - margin))
    .sort((a, b) => Math.abs(a.center - current.center) - Math.abs(b.center - current.center));
  if (candidates.length === 0) return false;
  candidates[0].video.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

// Fallback, last resort: find the feed's scroll container (the biggest
// vertically scrollable element) and move it by exactly one screen.
function scrollFeed(direction) {
  if (centerNeighbourVideo(direction)) return;
  let scroller = document.scrollingElement;
  let bestArea = 0;
  for (const el of document.querySelectorAll('div, main, section')) {
    if (el.scrollHeight <= el.clientHeight + 50) continue;
    if (el.clientHeight < window.innerHeight * 0.5) continue;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      bestArea = area;
      scroller = el;
    }
  }
  if (!scroller) return;
  const distance = scroller.clientHeight || window.innerHeight;
  scroller.scrollBy({ top: direction === 'next' ? distance : -distance, behavior: 'smooth' });
}

// --- Incoming: another feed was scrolled, follow it ------------------------
ipcRenderer.on('feed:advance', (_event, direction) => {
  if (direction !== 'next' && direction !== 'prev') return;
  lastSentAt = Date.now(); // we are following, not leading: don't report this step back
  const selectors = platform ? platform[direction] : [];
  if (!clickFirstMatch(selectors)) scrollFeed(direction);
});

// --- Outgoing: the user scrolled this feed ---------------------------------
// Programmatic clicks/scrolls from the handler above do not produce wheel or
// trusted key events, so synced feeds never echo back and cause a loop.
const COOLDOWN_MS = 700; // at most one video step per this interval
const GESTURE_GAP_MS = 120; // wheel silence that marks the start of a new gesture
let lastSentAt = 0;
let lastWheelAt = 0;

function report(direction) {
  lastSentAt = Date.now();
  ipcRenderer.send('feed:navigate', direction);
}

window.addEventListener(
  'wheel',
  (event) => {
    if (!event.isTrusted || event.ctrlKey) return; // ctrl+wheel is zoom
    if (Math.abs(event.deltaY) < 4 || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

    const now = Date.now();
    const newGesture = now - lastWheelAt > GESTURE_GAP_MS;
    lastWheelAt = now;

    // One step per gesture: trackpad inertia fires dozens of wheel events.
    if (!newGesture || now - lastSentAt < COOLDOWN_MS) return;
    report(event.deltaY > 0 ? 'next' : 'prev');
  },
  { capture: true, passive: true }
);

// --- Photo sliders: drag, Left/Right keys and sideways scroll --------------
const DRAG_THRESHOLD_PX = 40;
let dragStart = null;
let lastDragAt = 0;
let lastSlideAt = 0;

// The photo slider of the post currently on screen, with its two arrows.
function findPhotoSlider() {
  const config = platform && platform.photo;
  if (!config) return null;
  const item = [...document.querySelectorAll(config.item)].find((el) => {
    const rect = el.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return middle > 0 && middle < window.innerHeight;
  });
  const surface = item && item.querySelector(config.surface);
  const dots = item && item.querySelector(config.dots);
  if (!surface || !dots) return null;

  // Walk up from the dots to the row that also holds the two arrow buttons.
  let row = dots.parentElement;
  while (row && row !== item && row.querySelectorAll('button').length < 2) row = row.parentElement;
  if (!row || row === item) return null;
  const buttons = row.querySelectorAll('button');
  return { surface, prev: buttons[0], next: buttons[buttons.length - 1] };
}

function isOverSurface(slider, x, y) {
  const rect = slider.surface.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function slidePhoto(slider, direction) {
  const button = slider[direction];
  if (!button.disabled) button.click();
}

window.addEventListener(
  'pointerdown',
  (event) => {
    dragStart = null;
    if (!event.isTrusted || event.button !== 0) return;
    const slider = findPhotoSlider();
    if (slider && isOverSurface(slider, event.clientX, event.clientY)) {
      dragStart = { x: event.clientX, y: event.clientY };
    }
  },
  true
);

window.addEventListener(
  'pointerup',
  (event) => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    dragStart = null;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    const slider = findPhotoSlider();
    if (!slider) return;
    slidePhoto(slider, dx < 0 ? 'next' : 'prev');
    lastDragAt = Date.now();
  },
  true
);

// A drag ends with a click on the post, which would pause it; swallow that one.
window.addEventListener(
  'click',
  (event) => {
    if (event.isTrusted && Date.now() - lastDragAt < 300) {
      event.stopPropagation();
      event.preventDefault();
    }
  },
  true
);

window.addEventListener(
  'keydown',
  (event) => {
    if (!event.isTrusted || event.repeat) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const slider = findPhotoSlider();
    if (slider) slidePhoto(slider, event.key === 'ArrowRight' ? 'next' : 'prev');
  },
  true
);

window.addEventListener(
  'wheel',
  (event) => {
    if (!event.isTrusted || event.ctrlKey) return;
    if (Math.abs(event.deltaX) < 20 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (Date.now() - lastSlideAt < 500) return;
    const slider = findPhotoSlider();
    if (!slider || !isOverSurface(slider, event.clientX, event.clientY)) return;
    lastSlideAt = Date.now();
    slidePhoto(slider, event.deltaX > 0 ? 'next' : 'prev');
  },
  { capture: true, passive: true }
);

// --- Outgoing: the video on screen finished playing (for Auto Scroll) ------
// All three sites loop their videos, so "finished" usually shows up as the
// playhead wrapping from the end back to the start rather than an `ended`
// event. Media events don't bubble, hence the capture-phase listeners.
const END_WINDOW_S = 0.75; // how close to the end/start counts as "at" it
const lastTimes = new WeakMap();
let lastEndedAt = 0;

function isOnScreen(video) {
  const rect = video.getBoundingClientRect();
  const middle = rect.top + rect.height / 2;
  return rect.height > 0 && middle > 0 && middle < window.innerHeight;
}

function reportEnded(video) {
  if (!isOnScreen(video) || Date.now() - lastEndedAt < 1500) return;
  lastEndedAt = Date.now();
  ipcRenderer.send('feed:video-ended');
}

document.addEventListener(
  'timeupdate',
  (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return;
    const previous = lastTimes.get(video);
    lastTimes.set(video, video.currentTime);
    if (previous === undefined) return;
    const wasAtEnd = previous >= video.duration - END_WINDOW_S;
    const isAtStart = video.currentTime <= END_WINDOW_S && video.currentTime < previous;
    if (wasAtEnd && isAtStart) reportEnded(video);
  },
  true
);

document.addEventListener(
  'ended',
  (event) => {
    if (event.target instanceof HTMLVideoElement) reportEnded(event.target);
  },
  true
);

window.addEventListener(
  'keydown',
  (event) => {
    if (!event.isTrusted || event.repeat) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (Date.now() - lastSentAt < COOLDOWN_MS) return;
    report(event.key === 'ArrowDown' ? 'next' : 'prev');
  },
  { capture: true }
);
