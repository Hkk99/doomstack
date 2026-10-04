// The Brainrot page: three frames plus the sync logic that connects them.
// Each frame runs content.js, which talks to this page with postMessage.

const FEEDS = [
  // `fill.keepRight`: when Fill Video zooms onto the video, keep this many
  // pixels to its right in view (the like / comment / share buttons).
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/foryou', color: '#22d3ee', fill: { keepRight: 60 } },
  {
    fill: { keepRight: 60 },
    id: 'instagram',
    name: 'Instagram Reels',
    url: 'https://www.instagram.com/reels/',
    color: '#e879f9',
    // Instagram sizes a reel from the frame's width (16:9 portrait, minus
    // ~153px of side padding) and adds ~132px of space above and below. In a
    // tall, narrow column that leaves room for a second reel, so cap the frame
    // at the height one reel needs. Adjust the two numbers if Instagram
    // changes its layout.
    fitHeight: (width) => ((width - 153) * 16) / 9 + 132,
  },
  { id: 'youtube', name: 'YouTube Shorts', url: 'https://www.youtube.com/shorts/', color: '#ef4444' },
];

const MIN_LAYOUT_WIDTH = 480; // px; narrower columns are scaled down, see fitHeight

const state = {
  activeId: null, // last-hovered column; stays active when the pointer leaves
  syncAudio: true,
  syncScroll: true,
  autoScroll: false,
  fillVideo: true,
  silenced: new Set(), // columns muted by hand
};

const columns = new Map(); // feed id -> { feed, section, wrap, iframe, muteButton, videoRect }

const isMuted = (id) => state.silenced.has(id) || (state.syncAudio && state.activeId !== id);

function post(id, message) {
  const { iframe } = columns.get(id);
  // Target '*' because the frame may have navigated (e.g. to a login page);
  // content.js only accepts messages that come from this extension's origin.
  iframe.contentWindow?.postMessage({ brainrot: true, ...message }, '*');
}

function render() {
  for (const [id, { section, muteButton }] of columns) {
    const muted = isMuted(id);
    section.classList.toggle('active', state.activeId === id);
    section.classList.toggle('dimmed', state.activeId !== null && state.activeId !== id);
    muteButton.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    muteButton.classList.toggle('audible', !muted);
    muteButton.classList.toggle('silenced', state.silenced.has(id));
    muteButton.title = state.silenced.has(id) ? 'Unmute this feed' : 'Mute this feed';
    post(id, { type: 'mute', muted });
    layoutColumn(id);
  }
  document.getElementById('toggle-fill').setAttribute('aria-checked', state.fillVideo);
  document.getElementById('toggle-audio').setAttribute('aria-checked', state.syncAudio);
  document.getElementById('toggle-scroll').setAttribute('aria-checked', state.syncScroll);
  document.getElementById('toggle-auto').setAttribute('aria-checked', state.autoScroll);
}

function buildColumns() {
  const grid = document.getElementById('grid');
  const template = document.getElementById('column-template');

  for (const feed of FEEDS) {
    const section = template.content.firstElementChild.cloneNode(true);
    const iframe = section.querySelector('iframe');
    const muteButton = section.querySelector('.mute');

    section.querySelector('.dot').style.background = feed.color;
    section.querySelector('.name').textContent = feed.name;
    iframe.title = feed.name;

    section.addEventListener('mouseenter', () => {
      state.activeId = feed.id;
      render();
    });
    muteButton.addEventListener('click', () => {
      if (state.silenced.has(feed.id)) state.silenced.delete(feed.id);
      else state.silenced.add(feed.id);
      render();
    });
    section.querySelector('.reload').addEventListener('click', () => {
      iframe.src = feed.url;
    });

    const wrap = section.querySelector('.frame-wrap');
    columns.set(feed.id, { feed, section, wrap, iframe, muteButton, videoRect: null });
    new ResizeObserver(() => layoutColumn(feed.id)).observe(wrap);
    grid.append(section);
  }
}

// Size and position one column's frame.
//   - In a very narrow column (e.g. the browser in split screen) the sites get
//     cut off, so each is laid out at a comfortable width and scaled down.
//   - Feeds with `fitHeight` are kept no taller than one post.
//   - With Fill Video on, the frame is then zoomed so the current video (plus
//     the action buttons beside it) fills the column, cropping the site's own
//     menus and padding.
function layoutColumn(id) {
  const column = columns.get(id);
  const { feed, wrap, iframe, videoRect } = column;
  const width = wrap.clientWidth;
  const available = wrap.clientHeight;
  if (!width || !available) return;

  const layoutWidth = Math.max(width, MIN_LAYOUT_WIDTH);
  const scale = width / layoutWidth;
  const fullHeight = available / scale;
  const layoutHeight = Math.round(feed.fitHeight ? Math.min(fullHeight, feed.fitHeight(layoutWidth)) : fullHeight);
  iframe.style.width = `${layoutWidth}px`;
  iframe.style.height = `${layoutHeight}px`;

  // Only trust a video position that was measured at the current frame size.
  const canFill =
    state.fillVideo &&
    feed.fill &&
    videoRect &&
    Math.abs(videoRect.frameWidth - layoutWidth) <= 2 &&
    Math.abs(videoRect.frameHeight - layoutHeight) <= 2;

  if (canFill) {
    const boxWidth = videoRect.w + feed.fill.keepRight;
    const zoom = Math.min(width / boxWidth, available / videoRect.h);
    const x = (width - boxWidth * zoom) / 2 - videoRect.x * zoom;
    const y = (available - videoRect.h * zoom) / 2 - videoRect.y * zoom;
    iframe.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    // Hide everything outside the video box (site header, the next post peeking in).
    const right = Math.max(0, layoutWidth - (videoRect.x + boxWidth));
    const bottom = Math.max(0, layoutHeight - (videoRect.y + videoRect.h));
    iframe.style.clipPath = `inset(${Math.max(0, videoRect.y)}px ${right}px ${bottom}px ${Math.max(0, videoRect.x)}px)`;
  } else {
    const y = (available - layoutHeight * scale) / 2;
    iframe.style.transform = `translate(0px, ${y}px) scale(${scale})`;
    iframe.style.clipPath = '';
  }
}

function bindToggle(elementId, key) {
  document.getElementById(elementId).addEventListener('click', () => {
    state[key] = !state[key];
    render();
  });
}

// Messages from the frames (see content.js).
window.addEventListener('message', (event) => {
  if (!event.data?.brainrot) return;
  const entry = [...columns].find(([, column]) => column.iframe.contentWindow === event.source);
  if (!entry) return;
  const [sourceId] = entry;
  const others = FEEDS.map((feed) => feed.id).filter((id) => id !== sourceId);

  switch (event.data.type) {
    case 'ready': // frame (re)loaded: tell it its current mute state
      post(sourceId, { type: 'mute', muted: isMuted(sourceId) });
      columns.get(sourceId).videoRect = null; // new page: wait for a fresh position
      layoutColumn(sourceId);
      break;

    case 'video-rect': { // where the current video sits inside the frame
      const { x, y, w, h, frameWidth, frameHeight } = event.data;
      if (![x, y, w, h, frameWidth, frameHeight].every(Number.isFinite) || w <= 0 || h <= 0) break;
      columns.get(sourceId).videoRect = { x, y, w, h, frameWidth, frameHeight };
      layoutColumn(sourceId);
      break;
    }

    case 'navigate': // the user scrolled this feed: the others follow
      if (!state.syncScroll) break;
      if (event.data.direction !== 'next' && event.data.direction !== 'prev') break;
      for (const id of others) post(id, { type: 'advance', direction: event.data.direction });
      break;

    case 'ended': // this feed's video finished playing
      if (!state.autoScroll) break;
      if (!state.syncScroll) {
        // Independent feeds: each one moves on when its own video ends.
        post(sourceId, { type: 'advance', direction: 'next' });
        break;
      }
      // Synced feeds: only the leader (hovered feed, else the first) sets the
      // pace, so the three stay in step despite different video lengths.
      if (sourceId !== (state.activeId ?? FEEDS[0].id)) break;
      for (const feed of FEEDS) post(feed.id, { type: 'advance', direction: 'next' });
      break;
  }
});

async function start() {
  buildColumns();
  bindToggle('toggle-audio', 'syncAudio');
  bindToggle('toggle-scroll', 'syncScroll');
  bindToggle('toggle-auto', 'autoScroll');
  bindToggle('toggle-fill', 'fillVideo');
  render();

  // The sites refuse to be framed unless the background worker has lifted
  // that restriction for this tab, so wait for it before loading them.
  const response = await chrome.runtime.sendMessage({ type: 'allow-framing' });
  if (!response?.ok) console.error('Brainrot: could not enable framing', response?.error);
  for (const feed of FEEDS) columns.get(feed.id).iframe.src = feed.url;
}

start();
