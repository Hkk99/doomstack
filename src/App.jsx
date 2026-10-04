import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ChevronsDown, Copy, Minus, RotateCw, Square, Volume2, VolumeX, X } from 'lucide-react';

const api = window.brainrot;
const isMac = api.platform === 'darwin';
const isWindows = api.platform === 'win32';

const FEEDS = [
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/foryou', dot: 'bg-cyan-400' },
  { id: 'instagram', name: 'Instagram Reels', url: 'https://www.instagram.com/reels/', dot: 'bg-fuchsia-400' },
  { id: 'youtube', name: 'YouTube Shorts', url: 'https://www.youtube.com/shorts/', dot: 'bg-red-500' },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-5 items-end gap-[3px]">
        <span className="h-3 w-1.5 rounded-sm bg-cyan-400" />
        <span className="h-5 w-1.5 rounded-sm bg-indigo-500" />
        <span className="h-3.5 w-1.5 rounded-sm bg-fuchsia-400" />
      </div>
      <span className="bg-gradient-to-r from-cyan-300 via-indigo-300 to-fuchsia-300 bg-clip-text text-sm font-semibold tracking-[0.2em] text-transparent">
        BRAINROT
      </span>
    </div>
  );
}

function Toggle({ icon: Icon, label, title, enabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title={title}
      onClick={() => onChange(!enabled)}
      className={`no-drag flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
        enabled
          ? 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40'
          : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

// Custom caption buttons, only rendered on Windows (frame: false).
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    api.window.isMaximized().then(setMaximized);
    return api.window.onMaximizedChange(setMaximized);
  }, []);

  const button = 'no-drag flex h-full w-11 items-center justify-center text-zinc-400 transition-colors';
  return (
    <div className="flex h-full">
      <button type="button" aria-label="Minimize" onClick={api.window.minimize} className={`${button} hover:bg-white/10 hover:text-white`}>
        <Minus size={16} />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={api.window.toggleMaximize}
        className={`${button} hover:bg-white/10 hover:text-white`}
      >
        {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}
      </button>
      <button type="button" aria-label="Close" onClick={api.window.close} className={`${button} hover:bg-red-600 hover:text-white`}>
        <X size={16} />
      </button>
    </div>
  );
}

// `silenced` is the user's manual mute for this column; `muted` is the
// effective state (manual mute, or muted because another column is hovered).
function FeedColumn({ feed, active, dimmed, muted, silenced, onToggleSilenced, onActivate, onGuestReady }) {
  const webviewRef = useRef(null);
  const [ready, setReady] = useState(false);

  // <webview> methods are only callable after its first dom-ready.
  useEffect(() => {
    const webview = webviewRef.current;
    const onReady = () => {
      setReady(true);
      onGuestReady(webview.getWebContentsId());
    };
    webview.addEventListener('dom-ready', onReady);
    return () => webview.removeEventListener('dom-ready', onReady);
  }, []);

  useEffect(() => {
    if (ready) webviewRef.current.setAudioMuted(muted);
  }, [ready, muted]);

  return (
    <section
      onMouseEnter={onActivate}
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl bg-zinc-900 transition-all duration-300 ${
        active
          ? 'ring-2 ring-indigo-500/50 shadow-[0_0_36px_-6px_rgba(99,102,241,0.55)]'
          : 'ring-1 ring-white/5'
      } ${dimmed ? 'opacity-50' : 'opacity-100'}`}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/5 px-3 text-xs text-zinc-400">
        <span className={`h-2 w-2 rounded-full ${feed.dot}`} />
        <span className="font-medium text-zinc-200">{feed.name}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label={`${silenced ? 'Unmute' : 'Mute'} ${feed.name}`}
            aria-pressed={silenced}
            title={silenced ? 'Unmute this feed' : 'Mute this feed'}
            onClick={onToggleSilenced}
            className={`rounded p-0.5 hover:bg-white/10 hover:text-white ${silenced ? 'text-red-400' : ''}`}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} className="text-indigo-300" />}
          </button>
          <button
            type="button"
            aria-label={`Reload ${feed.name}`}
            title="Reload"
            onClick={() => ready && webviewRef.current.reload()}
            className="rounded p-0.5 hover:bg-white/10 hover:text-white"
          >
            <RotateCw size={13} />
          </button>
        </span>
      </div>
      <div className="relative flex-1">
        {/* Security prefs and the preload script are enforced in main.js (will-attach-webview). */}
        <webview ref={webviewRef} src={feed.url} partition="persist:feeds" allowpopups="true" className="absolute inset-0 h-full w-full" />
      </div>
    </section>
  );
}

export default function App() {
  // The last-hovered column stays active so audio doesn't cut out when the
  // pointer moves up to the header.
  const [activeId, setActiveId] = useState(null);
  const [syncAudio, setSyncAudio] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const [silencedIds, setSilencedIds] = useState([]);
  const [guestIds, setGuestIds] = useState({}); // feed id -> webContents id

  useEffect(() => {
    api.setAutoScroll(autoScroll);
  }, [autoScroll]);

  // The hovered feed paces Auto Scroll; before any hover, the first one does.
  const leaderGuestId = guestIds[activeId ?? FEEDS[0].id] ?? null;
  useEffect(() => {
    api.setLeader(leaderGuestId);
  }, [leaderGuestId]);

  const toggleSilenced = (id) =>
    setSilencedIds((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));

  useEffect(() => {
    api.setSyncScroll(syncScroll);
  }, [syncScroll]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header
        className={`drag flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-900/70 backdrop-blur-md ${
          isMac ? 'pl-20 pr-3' : 'pl-4'
        } ${isWindows ? '' : 'pr-3'}`}
      >
        <Logo />
        <div className="flex h-full items-center gap-2">
          <Toggle
            icon={syncAudio ? Volume2 : VolumeX}
            label="Sync Audio"
            title="On: only the hovered feed plays sound. Off: all three play sound."
            enabled={syncAudio}
            onChange={setSyncAudio}
          />
          <Toggle
            icon={ArrowDownUp}
            label="Sync Scroll"
            title="On: scrolling one feed advances the other two."
            enabled={syncScroll}
            onChange={setSyncScroll}
          />
          <Toggle
            icon={ChevronsDown}
            label="Auto Scroll"
            title="On: go to the next video when the current one finishes. With Sync Scroll on, the hovered feed sets the pace."
            enabled={autoScroll}
            onChange={setAutoScroll}
          />
          {isWindows && (
            <div className="ml-2 h-full">
              <WindowControls />
            </div>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-3 gap-3 p-3">
        {FEEDS.map((feed) => (
          <FeedColumn
            key={feed.id}
            feed={feed}
            active={activeId === feed.id}
            dimmed={activeId !== null && activeId !== feed.id}
            muted={silencedIds.includes(feed.id) || (syncAudio && activeId !== feed.id)}
            silenced={silencedIds.includes(feed.id)}
            onToggleSilenced={() => toggleSilenced(feed.id)}
            onActivate={() => setActiveId(feed.id)}
            onGuestReady={(guestId) => setGuestIds((ids) => (ids[feed.id] === guestId ? ids : { ...ids, [feed.id]: guestId }))}
          />
        ))}
      </main>
    </div>
  );
}
