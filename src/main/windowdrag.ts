// Moving windows by their drag areas on macOS 27.2 and later.
//
// On 27.2 the Mac often turns down the drag Chromium asks for when a drag
// area is pressed, so a window stays put for a few seconds after a move
// (Chrome does the same). There the pages make their drag areas no-drag
// and tell main about a press instead, and main moves the window after the
// pointer until the button comes up. Earlier versions keep the Mac's own drag.
// STARTBAR_WINDOW_DRAG=code or =mac picks one by hand, for testing.
// A window let go against a screen's left or right edge takes that half,
// as Filedrawer's windows do.
import { BrowserWindow, screen, systemPreferences } from 'electron';
import * as ipc from './ipc';

function wanted() {
  const forced = process.env.STARTBAR_WINDOW_DRAG;
  if (forced === 'code') return true;
  if (forced === 'mac') return false;
  if (process.platform !== 'darwin') return false;
  const [major, minor] = process.getSystemVersion().split('.').map(Number);
  return major > 27 || (major === 27 && minor >= 2);
}

export const codeDrag = wanted();

const STEP = 8; // ms between moves, about two a frame
const EDGE = 2; // points from a screen's outer edge that count as against it
const moving = new Map<BrowserWindow, Move>();
const hooked = new WeakSet<BrowserWindow>(); // windows whose blur and close end a move

type Side = 'left' | 'right';
interface Move {
  timer: NodeJS.Timeout;
  side: Side | null; // the edge the pointer is against, while it is
}

// Near enough the same frame.
const near = (a: Electron.Rectangle, b: Electron.Rectangle) =>
  Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;

// A window that took half the screen: where it was before, and the half.
const tiled = new WeakMap<BrowserWindow, { from: Electron.Rectangle; to: Electron.Rectangle }>();

// How much of a frame's bottom a bar covers, so a window stops above it.
let barCut: (frame: Electron.Rectangle) => number = () => 0;

// The left or right edge of a screen the pointer is pressed against. An edge
// with another screen beyond it doesn't count, so windows still cross over.
function sideAt(p: Electron.Point): { side: Side; display: Electron.Display } | null {
  const display = screen.getDisplayNearestPoint(p);
  const b = display.bounds;
  const beyond = (x: number) => screen.getAllDisplays().some((d) => d.id !== display.id &&
    x >= d.bounds.x && x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height);
  if (p.x <= b.x + EDGE - 1 && !beyond(b.x - 1)) return { side: 'left', display };
  if (p.x >= b.x + b.width - EDGE && !beyond(b.x + b.width)) return { side: 'right', display };
  return null;
}

// The half a window takes against that edge, above any bar.
function half(side: Side, display: Electron.Display): Electron.Rectangle {
  const a = display.workArea;
  const w = Math.round(a.width / 2);
  const to = side === 'left' ? { x: a.x, y: a.y, width: w, height: a.height } : { x: a.x + w, y: a.y, width: a.width - w, height: a.height };
  to.height -= barCut(to);
  return to;
}

// A window too wide or tall for the half stays as it is.
function fits(win: BrowserWindow, to: Electron.Rectangle) {
  const [w, h] = win.getMinimumSize();
  return w <= to.width && h <= to.height;
}

// The frosted outline of the half a window will take, just under that
// window, like the Mac's own. Startbar only gives buttons to the windows of
// apps in the Dock, so the outline never shows up on its bar.
const INSET = 6;
let outline: BrowserWindow | null = null;

function makeOutline() {
  const made = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  made.setIgnoreMouseEvents(true);
  made.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><html><body style="margin:0;height:100vh;box-sizing:border-box;border:1px solid rgba(255,255,255,.55);border-radius:10px"></body></html>'));
  made.on('closed', () => {
    if (outline === made) outline = null;
  });
  return made;
}

function showOutline(win: BrowserWindow, frame: Electron.Rectangle | null) {
  if (!frame) {
    if (outline && !outline.isDestroyed()) outline.hide();
    return;
  }
  if (!outline || outline.isDestroyed()) outline = makeOutline();
  outline.setBounds({ x: frame.x + INSET, y: frame.y + INSET, width: frame.width - INSET * 2, height: frame.height - INSET * 2 });
  outline.showInactive();
  win.moveTop(); // the dragged window stays over its outline
}

// drop: the button came up, so a window against an edge takes that half.
function stop(win: BrowserWindow, drop = false) {
  const move = moving.get(win);
  if (!move) return;
  clearInterval(move.timer);
  moving.delete(win);
  showOutline(win, null);
  if (!drop || !move.side || win.isDestroyed()) return;
  const hit = sideAt(screen.getCursorScreenPoint());
  if (!hit || hit.side !== move.side) return;
  const to = half(hit.side, hit.display);
  if (!fits(win, to)) return;
  const was = tiled.get(win);
  tiled.set(win, { from: was ? was.from : win.getBounds(), to });
  win.setBounds(to, true);
}

function start(win: BrowserWindow, x: number, y: number) {
  stop(win);
  // The page's points times its zoom are the window's points.
  const zoom = win.webContents.getZoomFactor();
  const off = { x: x * zoom, y: y * zoom };
  const from = screen.getCursorScreenPoint();
  // A window still on the half it took goes back to its old size once it
  // moves, keeping the pointer at the same share across it.
  const t = tiled.get(win);
  let untile = t && near(win.getBounds(), t.to) ? t.from : null;
  if (t && !untile) tiled.delete(win); // moved or resized since; its old size is no longer wanted
  const canTile = win.isResizable();
  const move: Move = {
    side: null,
    timer: setInterval(() => {
      if (win.isDestroyed()) return stop(win);
      const p = screen.getCursorScreenPoint();
      if (untile) {
        if (Math.abs(p.x - from.x) < 4 && Math.abs(p.y - from.y) < 4) return;
        off.x = Math.round(off.x / win.getBounds().width * untile.width);
        win.setBounds({ x: Math.round(p.x - off.x), y: Math.round(p.y - off.y), width: untile.width, height: untile.height });
        tiled.delete(win);
        untile = null;
        return;
      }
      win.setPosition(Math.round(p.x - off.x), Math.round(p.y - off.y));
      const hit = canTile ? sideAt(p) : null;
      const to = hit ? half(hit.side, hit.display) : null;
      const side = hit && to && fits(win, to) ? hit.side : null;
      if (side !== move.side) {
        move.side = side;
        showOutline(win, side ? to : null);
      }
    }, STEP)
  };
  moving.set(win, move);
  if (!hooked.has(win)) {
    hooked.add(win);
    win.on('blur', () => stop(win));
    win.on('closed', () => stop(win));
  }
}

// Zoom the way the Mac does: a window still where zoom put it goes back to
// where it was, any other window fills the screen. Electron's isMaximized
// can't tell, so the frames are kept here.
const zoomed = new WeakMap<BrowserWindow, { from: Electron.Rectangle; to?: Electron.Rectangle }>();

function zoom(win: BrowserWindow) {
  const now = win.getBounds();
  const z = zoomed.get(win);
  if (z && z.to && near(now, z.to)) {
    zoomed.delete(win);
    win.setBounds(z.from, true);
    return;
  }
  const entry: { from: Electron.Rectangle; to?: Electron.Rectangle } = { from: now };
  zoomed.set(win, entry);
  win.maximize();
  // The zoom animates; its frame is read once it has settled.
  setTimeout(() => {
    if (!win.isDestroyed() && zoomed.get(win) === entry) entry.to = win.getBounds();
  }, 600);
}

// What a double click on a title bar does, from Desktop and Dock settings.
function titleDouble(win: BrowserWindow) {
  const action = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
  const minimize = action === 'Minimize' || (!action && systemPreferences.getUserDefault('AppleMiniaturizeOnDoubleClick', 'boolean'));
  if (action === 'None') return;
  if (minimize) {
    if (win.isMinimizable()) win.minimize();
  } else if (win.isMaximizable() && win.isResizable()) {
    zoom(win);
  }
}

// cut: how much of a frame's bottom a bar covers, for the halves.
// onStart: told when a drag starts, before the first move.
export function init({ cut, onStart }: { cut?: (frame: Electron.Rectangle) => number; onStart?: () => void } = {}) {
  if (cut) barCut = cut;
  ipc.handle('window:codeDrag', () => codeDrag);
  const of = (e: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender);
  ipc.on('window:dragStart', (e, x, y) => {
    const win = of(e);
    if (!codeDrag || !win || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (onStart) onStart();
    start(win, x, y);
  });
  ipc.on('window:dragEnd', (e) => {
    const win = of(e);
    if (win) stop(win, true);
  });
  ipc.on('window:titleDouble', (e) => {
    const win = of(e);
    if (codeDrag && win) titleDouble(win);
  });
}
