// The bars (one per display, or only on the main one), the Start menu and
// the small windows that open above a bar. All frameless, all above other
// windows, all get the same state push (settings plus what the Mac looks
// like right now). Each popup remembers the bar it opened from and sits
// above that one.
import { app, BrowserWindow, screen, systemPreferences, type BrowserWindowConstructorOptions, type Display, type WebContents } from 'electron';
import path from 'path';
import * as ipc from './ipc';
import type { Payload } from './ipc';
import type { Events, Ghost, GroupPayload, Point, PopoverKind, PreviewPayload, Rect, Settings, SettingsPage, Size, Theme } from '../shared/types';

// The vibrancy a window is made with. Electron takes null there too, for
// none, the way setVibrancy does, but its types for the window options
// only list the names. So vibrancyFor's null goes in as this.
type Material = BrowserWindowConstructorOptions['vibrancy'];

interface BarEntry {
  win: BrowserWindow;
  displayId: number;
  peek: boolean;
  peekTimer: NodeJS.Timeout | undefined;
  holds: number;
}

// The button a popup belongs to: where it is in its bar, and the bar, which
// is null once that bar has closed.
interface Anchor {
  rect: Rect;
  bar: BrowserWindow | null;
}

const MENU_WIDTH = 420;
const MENU_HEIGHT = 500;
const MENU_GAP = 8;
const GROUP_WIDTH = 300;
const CALENDAR_WIDTH = 252;
const POPOVER_WIDTH = 260;
const TIP_MARGIN = 8; // room around the tooltip for its shadow
const EDGE = 2; // auto hide: how close to the bottom the mouse has to get
const LEAVE_DELAY = 600; // auto hide: how long the bar stays after the mouse leaves

const preload = path.join(__dirname, '..', 'preload.js');
const renderer = (name: string) => path.join(__dirname, '..', 'renderer', name, 'index.html');

// One entry per bar: { win, displayId, peek, peekTimer, holds }. peek is
// auto hide's "the mouse is at this bar's edge or on it", holds counts the
// native menus open on it.
const bars = new Map<number, BarEntry>();
let current: Settings | null = null; // the settings the bars were last laid out with
export let menu: BrowserWindow | null = null;
let menuBar: BrowserWindow | null = null; // the bar the Start menu opened on
let lastMenuHide = 0;
let tip: BrowserWindow | null = null;
let tipAnchor: Anchor | null = null; // { rect, bar } of the hovered button, rect in bar coordinates
let tipFollow: Point | null = null; // the screen point the tip follows as the ghost of a dragged window
let group: BrowserWindow | null = null;
let groupAnchor: (Anchor & { pid: number }) | null = null; // { pid, rect, bar } of the group button the list belongs to
let lastGroupHide: { pid: number | null; at: number } = { pid: null, at: 0 };
let calendar: BrowserWindow | null = null;
let calendarAnchor: Anchor | null = null; // { rect, bar } of the clock
let lastCalendarHide = 0;
let popover: BrowserWindow | null = null;
let popoverAnchor: (Anchor & { kind: PopoverKind }) | null = null; // { kind, rect, bar } of the tray icon it belongs to
let lastPopoverHide: { kind: PopoverKind | null; at: number } = { kind: null, at: 0 };
let theme: Theme = 'system';
let preview: BrowserWindow | null = null; // the window pictures over a window button
let previewAnchor: Anchor | null = null; // { rect, bar } of the button
let previewHover = false; // the mouse is over the pictures
let previewHide: NodeJS.Timeout | undefined;
let previewHeld = false; // a window is being dragged out of the pictures, so they stay
let previewPinned = false; // opened by a click, stays until a click elsewhere
const unpinHooks = new Set<() => void>();
const hideHooks = new Set<() => void>(); // run whenever the pictures go away
let settingsWin: BrowserWindow | null = null;
export let barHidden = false; // Hide the Bar, for this session only
const visibility = new Set<(hidden: boolean) => void>();
let overFullScreen = false; // keep the bars up over full screen apps
let fullScreenOn = new Set<number>(); // displays with a full screen window in front
let autoHide = false;
let edgeWatch: NodeJS.Timeout | undefined;

// Every Space, full screen apps included. Whether the bar stays up over a
// full screen app is up to barWanted. The Start menu and the popups can
// always open there, from the bar or the shortcut. Changing this flag while
// running doesn't take on macOS, so it's set once.
function onAllSpaces(win: BrowserWindow) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// Classic 2009 blurs behind the bar only. Its Start menu and popups have
// rounded corners drawn in CSS, which the blur would fill in.
function vibrancyFor(settings: Settings, bar = false): 'hud' | 'menu' | null {
  if (!settings.translucent) return null;
  if (settings.theme === 'classic-2009') return bar ? 'hud' : null;
  return settings.theme === 'system' ? 'menu' : null;
}

function barBounds(settings: Settings, display: Display) {
  const { bounds } = display;
  const height = Number(settings.barHeight) || 36;
  return { x: bounds.x, y: bounds.y + bounds.height - height, width: bounds.width, height };
}

// MARK: which bar is which

function displayById(id: number) {
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function entryOf(win: BrowserWindow) {
  for (const entry of bars.values()) if (entry.win === win) return entry;
  return null;
}

// The bar a renderer message came from, or null when it came from
// another window (the group list, for one).
export function barOf(webContents: WebContents) {
  for (const entry of bars.values()) if (entry.win.webContents === webContents) return entry.win;
  return null;
}

// The main display's bar, or any bar when there's none there.
function mainBar() {
  const main = bars.get(screen.getPrimaryDisplay().id);
  if (main) return main.win;
  const first = bars.values().next().value;
  return first ? first.win : null;
}

// The bar on the display the mouse is on, for the shortcut and for opening
// Startbar again. The main bar when that display has none.
function barUnderMouse() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const entry = bars.get(display.id);
  return entry ? entry.win : mainBar();
}

// The classic themes' Start menus sit right on the bar, each at its own size.
const CLASSIC_MENUS: Partial<Record<Theme, Size>> = { 'classic-2009': { width: 410, height: 500 }, 'classic-2001': { width: 400, height: 480 }, 'classic-1995': { width: 380, height: 460 } };
const gapFor = (name: Theme) => (CLASSIC_MENUS[name] ? 0 : MENU_GAP);
const isClassic = (settings: Settings) => !!CLASSIC_MENUS[settings.theme];

function menuBounds(settings: Settings, barWin: BrowserWindow | null) {
  const entry = barWin && entryOf(barWin);
  const b = barBounds(settings, entry ? displayById(entry.displayId) : screen.getPrimaryDisplay());
  const { width, height } = CLASSIC_MENUS[settings.theme] || { width: MENU_WIDTH, height: MENU_HEIGHT };
  return { x: b.x + gapFor(settings.theme), y: b.y - height - gapFor(settings.theme), width, height };
}

// What a bar needs to know about where it is: its display, whether that's
// the main one, and where every display is (to sort windows by display).
function sendPlace(entry: BarEntry) {
  if (entry.win.isDestroyed()) return;
  const main = screen.getPrimaryDisplay();
  ipc.send(entry.win.webContents, 'bar:place', {
    id: entry.displayId,
    main: entry.displayId === main.id,
    bars: bars.size,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, main: d.id === main.id, bounds: d.bounds }))
  });
}

function createBar(settings: Settings, display: Display) {
  const bar = new BrowserWindow({
    ...barBounds(settings, display),
    // A non-activating panel gets mouse moves (hover, tooltips) while another
    // app is in front. A plain window that can't take focus doesn't.
    type: 'panel',
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    acceptFirstMouse: true, // a window that never takes focus still gets the first click
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings, true) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  bar.setAlwaysOnTop(true, 'floating');
  onAllSpaces(bar);
  const entry: BarEntry = { win: bar, displayId: display.id, peek: false, peekTimer: undefined, holds: 0 };
  bars.set(display.id, entry);
  bar.loadFile(renderer('bar'));
  bar.webContents.on('did-finish-load', () => sendPlace(entry));
  bar.once('ready-to-show', () => syncBar(entry));
  bar.on('closed', () => {
    clearTimeout(entry.peekTimer);
    if (bars.get(entry.displayId) === entry) bars.delete(entry.displayId);
  });
  return bar;
}

// A bar for each display that should have one, at the bottom of it. Bars
// for displays that went away (or that shouldn't have one any more) close.
function syncDisplays(settings: Settings) {
  const main = screen.getPrimaryDisplay();
  const wanted = settings.displays.bars === 'main' ? [main] : screen.getAllDisplays();
  const ids = new Set(wanted.map((d) => d.id));
  for (const [id, entry] of bars) {
    if (ids.has(id)) continue;
    bars.delete(id);
    for (const anchor of [tipAnchor, groupAnchor, calendarAnchor, popoverAnchor]) {
      if (anchor && anchor.bar === entry.win) anchor.bar = null;
    }
    if (menuBar === entry.win) menuBar = null;
    entry.win.destroy();
  }
  for (const display of wanted) {
    const entry = bars.get(display.id);
    if (!entry) createBar(settings, display);
    else entry.win.setBounds(barBounds(settings, display));
  }
  for (const entry of bars.values()) sendPlace(entry);
}

export function createBars(settings: Settings) {
  current = settings;
  theme = settings.theme;
  overFullScreen = !settings.taskbar.hideInFullScreen;
  syncDisplays(settings);
  setAutoHide(settings.taskbar.autoHide);
}

export function createMenu(settings: Settings) {
  popupsClassic = isClassic(settings);
  menu = new BrowserWindow({
    ...menuBounds(settings, mainBar()),
    // A non-activating panel takes typing without making Startbar the
    // active app, which macOS doesn't always allow, so the search box gets
    // the keys while the app in front stays in front.
    type: 'panel',
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: !isClassic(settings), // see remakePopups
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  menu.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(menu);
  menu.loadFile(renderer('menu'));
  menu.on('blur', () => hideMenu());
  menu.on('closed', () => { menu = null; });
  return menu;
}

// The tooltip and the group list sit above the bar, so they need their own
// windows. Both are created once and moved into place when shown.
export function createTip() {
  tip = new BrowserWindow({
    width: 10,
    height: 10,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  tip.setIgnoreMouseEvents(true);
  tip.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(tip);
  tip.loadFile(renderer('tip'));
  tip.on('closed', () => { tip = null; });
  return tip;
}

export function createGroup(settings: Settings) {
  group = new BrowserWindow({
    width: GROUP_WIDTH,
    height: 100,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: !isClassic(settings), // see remakePopups
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  group.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(group);
  group.loadFile(renderer('group'));
  group.on('blur', () => hideGroup());
  group.on('closed', () => { group = null; });
  return group;
}

// Pictures of a button's windows, shown on hover when previews are on. A
// non-activating panel like the bar, so it takes hovers and clicks without
// pulling focus from the app in front.
export function createPreview(settings: Settings) {
  preview = new BrowserWindow({
    width: 200,
    height: 150,
    type: 'panel',
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: !isClassic(settings), // see remakePopups
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  preview.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(preview);
  preview.loadFile(renderer('preview'));
  preview.on('closed', () => { preview = null; });
  return preview;
}

export function showPreview(payload: PreviewPayload, barWin: BrowserWindow | null) {
  if (!preview || !liveBar(barWin) || previewPinned) return;
  clearTimeout(previewHide);
  previewAnchor = { rect: payload.rect, bar: barWin };
  ipc.send(preview.webContents, 'preview:show', payload);
}

export function sendPreview<K extends keyof Events>(channel: K, ...data: Payload<K>) {
  if (preview && !preview.isDestroyed()) ipc.send(preview.webContents, channel, ...data);
}

// The pictures laid out. Open them above the button, centered on it.
export function sizePreview({ width, height }: Size) {
  if (!preview || !previewAnchor || !liveBar(previewAnchor.bar)) return;
  const b = previewAnchor.bar!.getBounds();
  const { rect } = previewAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - width / 2, width, previewAnchor.bar);
  preview.setBounds({ x, y: b.y - height - gapFor(theme), width, height });
  if (!preview.isVisible()) preview.showInactive();
}

// The mouse left the button. The pictures stay a moment, so the mouse can
// move up onto them.
export function leavePreview() {
  clearTimeout(previewHide);
  if (previewHeld || previewPinned) return;
  previewHide = setTimeout(() => { if (!previewHover) hidePreview(); }, 250);
}

// Keep the pictures up while a window is dragged out of them.
export function holdPreview(on: boolean) {
  previewHeld = !!on;
  if (previewHeld) clearTimeout(previewHide);
  else if (!previewHover) leavePreview();
}

export function hoverPreview(on: boolean) {
  previewHover = !!on;
  if (previewHover) clearTimeout(previewHide);
  else leavePreview();
}

export function hidePreview() {
  clearTimeout(previewHide);
  previewAnchor = null;
  previewHover = false;
  previewHeld = false;
  if (previewPinned) {
    previewPinned = false;
    for (const fn of unpinHooks) fn();
  }
  if (preview && preview.isVisible()) preview.hide();
  for (const fn of hideHooks) fn();
}

// With previews on, a click on a group opens its pictures and keeps them
// up until a click elsewhere; a second click on the button closes them.
// True when the pictures were opened, false when the click closed them.
export function pinPreview(payload: PreviewPayload, barWin: BrowserWindow | null) {
  if (!preview || !liveBar(barWin)) return false;
  const sameButton = previewAnchor && previewAnchor.bar === barWin && previewAnchor.rect.x === payload.rect.x && previewAnchor.rect.width === payload.rect.width;
  if (previewPinned && sameButton) {
    hidePreview();
    return false;
  }
  clearTimeout(previewHide);
  previewPinned = true;
  previewAnchor = { rect: payload.rect, bar: barWin };
  ipc.send(preview.webContents, 'preview:show', payload);
  return true;
}

// A screen point on the pinned pictures or on the button they belong to,
// where a click is theirs to handle.
export function previewHit(point: Point) {
  if (!previewPinned || !preview || !previewAnchor || !liveBar(previewAnchor.bar)) return false;
  const inside = (b: Rect) => point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
  const bar = previewAnchor.bar!.getBounds();
  const { rect } = previewAnchor;
  return inside(preview.getBounds()) || inside({ x: bar.x + rect.x, y: bar.y + rect.y, width: rect.width, height: rect.height });
}

export function onPreviewUnpinned(fn: () => void) {
  unpinHooks.add(fn);
}

export function onPreviewHidden(fn: () => void) {
  hideHooks.add(fn);
}

// The tray's volume, Wi-Fi and battery panels share one window.
export function createPopover(settings: Settings) {
  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: 120,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: !isClassic(settings), // see remakePopups
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  popover.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(popover);
  popover.loadFile(renderer('popover'));
  popover.on('blur', () => hidePopover());
  popover.on('closed', () => { popover = null; });
  return popover;
}

// The small calendar above the clock.
export function createCalendar(settings: Settings) {
  calendar = new BrowserWindow({
    width: CALENDAR_WIDTH,
    height: 280,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: !isClassic(settings), // see remakePopups
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: vibrancyFor(settings) as Material,
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  calendar.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(calendar);
  calendar.loadFile(renderer('calendar'));
  calendar.on('blur', () => hideCalendar());
  calendar.on('closed', () => { calendar = null; });
  return calendar;
}

// Keeps a window of this width inside the display the bar is on.
function clampX(x: number, width: number, barWin: BrowserWindow | null) {
  const entry = barWin && entryOf(barWin);
  const { bounds } = entry ? displayById(entry.displayId) : screen.getPrimaryDisplay();
  return Math.round(Math.max(bounds.x + 4, Math.min(x, bounds.x + bounds.width - width - 4)));
}

// A popup anchored to a bar that has gone away has nothing to sit on. The
// anchors' bars below are known to be there (the !) after this check.
const liveBar = (barWin: BrowserWindow | null | undefined) => barWin && !barWin.isDestroyed() && entryOf(barWin) ? barWin : null;

// A button whose own panel is open doesn't get a tooltip on top of it.
function panelOpenAt(rect: Rect, barWin: BrowserWindow | null) {
  return ([[popover, popoverAnchor], [calendar, calendarAnchor], [group, groupAnchor]] satisfies [BrowserWindow | null, Anchor | null][]).some(([win, anchor]) =>
    win && win.isVisible() && anchor && anchor.bar === barWin && anchor.rect.x === rect.x && anchor.rect.width === rect.width);
}

export function showTip(text: string, rect: Rect, barWin: BrowserWindow | null) {
  if (!tip || !liveBar(barWin) || panelOpenAt(rect, barWin)) return;
  tipAnchor = { rect, bar: barWin };
  tipFollow = null;
  ipc.send(tip.webContents, 'tip:text', text);
}

// The tooltip renderer measured its text. Center it over the button, or
// put it by the cursor when it's the ghost of a dragged window.
export function sizeTip({ width, height }: Size) {
  if (!tip) return;
  const w = width + TIP_MARGIN * 2;
  const h = height + TIP_MARGIN * 2;
  if (tipFollow) {
    tip.setBounds({ ...ghostAt(tipFollow), width: w, height: h });
    tip.showInactive();
    return;
  }
  if (!tipAnchor || !liveBar(tipAnchor.bar)) return;
  const b = tipAnchor.bar!.getBounds();
  const { rect } = tipAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - w / 2, w, tipAnchor.bar);
  const y = b.y - 6 - height - TIP_MARGIN;
  tip.setBounds({ x, y, width: w, height: h });
  tip.showInactive();
}

export function hideTip() {
  tipAnchor = null;
  tipFollow = null;
  if (tip && tip.isVisible()) tip.hide();
}

// MARK: a window dragged out of its group

const ghostAt = (p: Point) => ({ x: Math.round(p.x + 12), y: Math.round(p.y + 12) });

// The tip as the ghost under the cursor: the window's icon and title.
export function showGhost(payload: Ghost, point: Point) {
  if (!tip) return;
  tipAnchor = null;
  tipFollow = point;
  ipc.send(tip.webContents, 'tip:text', payload);
}

export function moveGhost(point: Point) {
  tipFollow = point;
  if (tip && tip.isVisible()) {
    const { x, y } = ghostAt(point);
    tip.setPosition(x, y);
  }
}

// The bar under a screen point, if any.
export function barAt(point: Point) {
  for (const entry of bars.values()) {
    if (entry.win.isDestroyed() || !entry.win.isVisible()) continue;
    const b = entry.win.getBounds();
    if (point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height) return entry.win;
  }
  return null;
}

export function showGroup(payload: GroupPayload, barWin: BrowserWindow | null) {
  if (!group || !liveBar(barWin)) return;
  hidePreview();
  // A click on the bar doesn't always blur the list, so check for it open.
  if (group.isVisible() && groupAnchor && groupAnchor.pid === payload.pid && groupAnchor.bar === barWin) return hideGroup();
  // Clicking the group button while its list is open blurs the list first,
  // which hides it. Treat that click as "close", like the Start button.
  if (lastGroupHide.pid === payload.pid && Date.now() - lastGroupHide.at < 250) return;
  groupAnchor = { pid: payload.pid, rect: payload.rect, bar: barWin };
  ipc.send(group.webContents, 'group:show', payload);
}

// The group list renderer laid out its rows. Open it above the button.
export function sizeGroup({ height }: { height: number }) {
  if (!group || !groupAnchor || !liveBar(groupAnchor.bar)) return;
  const b = groupAnchor.bar!.getBounds();
  const { workArea } = displayById(entryOf(groupAnchor.bar!)!.displayId);
  const h = Math.min(height, Math.round(workArea.height * 0.6));
  const gap = gapFor(theme);
  const x = clampX(b.x + groupAnchor.rect.x, GROUP_WIDTH, groupAnchor.bar);
  group.setBounds({ x, y: b.y - h - gap, width: GROUP_WIDTH, height: h });
  group.show();
  group.focus();
}

export function hideGroup() {
  if (!group || !group.isVisible()) return;
  lastGroupHide = { pid: groupAnchor && groupAnchor.pid, at: Date.now() };
  groupAnchor = null;
  group.hide();
  syncBars();
}

export function toggleCalendar(rect: Rect, barWin: BrowserWindow | null) {
  if (!calendar || !liveBar(barWin)) return;
  if (calendar.isVisible()) return hideCalendar();
  // When a click on the clock does blur the calendar, that hides it first.
  // Treat that click as "close" too.
  if (Date.now() - lastCalendarHide < 250) return;
  calendarAnchor = { rect, bar: barWin };
  ipc.send(calendar.webContents, 'calendar:show');
}

// The calendar laid out this month. Open it above the clock, lined up with
// its right edge.
export function sizeCalendar({ height }: { height: number }) {
  if (!calendar || !calendarAnchor || !liveBar(calendarAnchor.bar)) return;
  const b = calendarAnchor.bar!.getBounds();
  const { rect } = calendarAnchor;
  const gap = gapFor(theme);
  const x = clampX(b.x + rect.x + rect.width - CALENDAR_WIDTH, CALENDAR_WIDTH, calendarAnchor.bar);
  calendar.setBounds({ x, y: b.y - height - gap, width: CALENDAR_WIDTH, height });
  if (!calendar.isVisible()) {
    calendar.show();
    calendar.focus();
  }
}

export function hideCalendar() {
  if (!calendar || !calendar.isVisible()) return;
  lastCalendarHide = Date.now();
  calendarAnchor = null;
  calendar.hide();
  syncBars();
}

// A click on a tray icon opens its panel, or closes it when it's the one open.
export function togglePopover(kind: PopoverKind, rect: Rect, barWin: BrowserWindow | null) {
  if (!popover || !liveBar(barWin)) return;
  const same = popoverAnchor && popoverAnchor.kind === kind && popoverAnchor.bar === barWin;
  if (popover.isVisible() && same) return hidePopover();
  if (lastPopoverHide.kind === kind && Date.now() - lastPopoverHide.at < 250) return;
  popoverAnchor = { kind, rect, bar: barWin };
  ipc.send(popover.webContents, 'popover:show', kind);
}

// The panel laid out its content. Open it above the icon, centered on it.
export function sizePopover({ height }: { height: number }) {
  if (!popover || !popoverAnchor || !liveBar(popoverAnchor.bar)) return;
  const b = popoverAnchor.bar!.getBounds();
  const gap = gapFor(theme);
  const { rect } = popoverAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - POPOVER_WIDTH / 2, POPOVER_WIDTH, popoverAnchor.bar);
  popover.setBounds({ x, y: b.y - height - gap, width: POPOVER_WIDTH, height });
  if (!popover.isVisible()) {
    popover.show();
    popover.focus();
  }
}

export function hidePopover() {
  if (!popover || !popover.isVisible()) return;
  lastPopoverHide = { kind: popoverAnchor && popoverAnchor.kind, at: Date.now() };
  popoverAnchor = null;
  popover.hide();
  syncBars();
}

// MARK: showing and hiding the bars

// Hide the Bar wins, then a full screen app on that display when the bars
// hide for those. With auto hide on, a bar shows while the mouse is at its
// edge or on it, or while something opened from it is up: the Start menu,
// a group list, the calendar, a tray panel or a right click menu.
function barWanted(entry: BarEntry) {
  if (barHidden || (fullScreenOn.has(entry.displayId) && !overFullScreen)) return false;
  if (!autoHide) return true;
  if (entry.peek || entry.holds > 0) return true;
  const open = (win: BrowserWindow | null, anchorBar: BrowserWindow | null | undefined) => win && win.isVisible() && anchorBar === entry.win;
  return open(menu, menuBar) || open(group, groupAnchor && groupAnchor.bar)
    || open(calendar, calendarAnchor && calendarAnchor.bar) || open(popover, popoverAnchor && popoverAnchor.bar);
}

function syncBar(entry: BarEntry) {
  if (entry.win.isDestroyed()) return;
  const want = barWanted(entry);
  if (want && !entry.win.isVisible()) entry.win.showInactive();
  else if (!want && entry.win.isVisible()) {
    if (tipAnchor && tipAnchor.bar === entry.win) hideTip();
    entry.win.hide();
  }
}

function syncBars() {
  for (const entry of bars.values()) syncBar(entry);
}

function watchEdge() {
  const p = screen.getCursorScreenPoint();
  for (const entry of bars.values()) {
    if (entry.win.isDestroyed()) continue;
    const { bounds } = displayById(entry.displayId);
    const inX = p.x >= bounds.x && p.x < bounds.x + bounds.width;
    const inDisplay = inX && p.y >= bounds.y && p.y < bounds.y + bounds.height;
    const atEdge = inDisplay && p.y >= bounds.y + bounds.height - EDGE;
    const onBar = inDisplay && entry.win.isVisible() && p.y >= entry.win.getBounds().y;
    if (atEdge || onBar) {
      clearTimeout(entry.peekTimer);
      entry.peekTimer = undefined;
      if (!entry.peek) {
        entry.peek = true;
        syncBar(entry);
      }
    } else if (entry.peek && !entry.peekTimer) {
      entry.peekTimer = setTimeout(() => {
        entry.peekTimer = undefined;
        entry.peek = false;
        syncBar(entry);
      }, LEAVE_DELAY);
    }
  }
}

function setAutoHide(on: boolean) {
  if (!!on === autoHide) return;
  autoHide = !!on;
  clearInterval(edgeWatch);
  edgeWatch = undefined;
  for (const entry of bars.values()) {
    clearTimeout(entry.peekTimer);
    entry.peekTimer = undefined;
    entry.peek = false;
  }
  if (autoHide) edgeWatch = setInterval(watchEdge, 80);
  syncBars();
}

// Keeps an auto hidden bar up while a native menu from it is open. Call the
// returned function when the menu closes.
export function holdBar(barWin: BrowserWindow | null) {
  const entry = barWin && entryOf(barWin);
  if (!entry) return () => {};
  entry.holds += 1;
  syncBar(entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holds -= 1;
    syncBar(entry);
  };
}

function setOverFullScreen(show: boolean) {
  if (show === overFullScreen) return;
  overFullScreen = show;
  syncBars();
}

// The displays that have a full screen window in front, by id.
export function setFullScreenDisplays(ids: number[]) {
  const next = new Set(ids);
  if (next.size === fullScreenOn.size && [...next].every((id) => fullScreenOn.has(id))) return;
  fullScreenOn = next;
  syncBars();
}

// Where each bar is, for moving windows up off them.
export function barAreas() {
  if (barHidden) return [];
  return [...bars.values()].filter((e) => !e.win.isDestroyed()).map((entry) => {
    const display = displayById(entry.displayId);
    return { top: display.workArea.y, bottom: entry.win.getBounds().y, screen: display.bounds };
  });
}

// macOS rounds a borderless window's corners and outlines it, which suits
// the System theme only. That's fixed when a window is made, so the popups
// are made again when the theme changes between System and a classic one.
let popupsClassic: boolean | null = null;

function remakePopups(settings: Settings) {
  const classic = isClassic(settings);
  if (popupsClassic === null || popupsClassic === classic) return;
  hideMenu();
  hidePreview();
  for (const win of [menu, group, calendar, popover, preview]) {
    if (!win || win.isDestroyed()) continue;
    win.removeAllListeners('closed');
    win.removeAllListeners('blur');
    win.destroy();
  }
  createMenu(settings);
  createGroup(settings);
  createCalendar(settings);
  createPopover(settings);
  createPreview(settings);
}

export function layout(settings: Settings) {
  current = settings;
  theme = settings.theme;
  remakePopups(settings);
  setOverFullScreen(!settings.taskbar.hideInFullScreen);
  syncDisplays(settings);
  setAutoHide(settings.taskbar.autoHide);
  for (const entry of bars.values()) entry.win.setVibrancy(vibrancyFor(settings, true));
  if (menu) {
    menu.setBounds(menuBounds(settings, menuBar || mainBar()));
    menu.setVibrancy(vibrancyFor(settings));
  }
  if (group) group.setVibrancy(vibrancyFor(settings));
  if (calendar) calendar.setVibrancy(vibrancyFor(settings));
  if (popover) popover.setVibrancy(vibrancyFor(settings));
  if (preview) preview.setVibrancy(vibrancyFor(settings));
  hidePreview();
  hideTip();
  hideGroup();
  hideCalendar();
  hidePopover();
}

export function hideBar() {
  if (bars.size === 0 || barHidden) return;
  barHidden = true;
  hideMenu();
  hidePreview();
  hideTip();
  hideGroup();
  hideCalendar();
  hidePopover();
  syncBars();
  for (const fn of visibility) fn(true);
}

export function showBar() {
  if (bars.size === 0 || !barHidden) return;
  barHidden = false;
  syncBars();
  for (const fn of visibility) fn(false);
}

export function onBarVisibility(fn: (hidden: boolean) => void) {
  visibility.add(fn);
  return () => visibility.delete(fn);
}

// Fades a window in from clear, the whole window at once: the blur behind
// it and its shadow come from macOS and can't be moved by the page, so a
// page that slid in on its own would shift inside them. Starting clear also
// hides the last frame from the time before, which a shown window draws
// until the page has caught up. Not with Reduce motion on.
const FADE = 140;
const fades = new WeakMap<BrowserWindow, NodeJS.Timeout>();
function fadeIn(win: BrowserWindow) {
  clearInterval(fades.get(win));
  if (systemPreferences.getAnimationSettings().prefersReducedMotion) {
    win.setOpacity(1);
    return;
  }
  win.setOpacity(0);
  const start = Date.now();
  fades.set(win, setInterval(() => {
    if (win.isDestroyed()) return clearInterval(fades.get(win));
    const t = Math.min(1, (Date.now() - start) / FADE);
    win.setOpacity(1 - (1 - t) ** 3);
    if (t === 1) clearInterval(fades.get(win));
  }, 1000 / 60));
}

// Opens the Start menu above barWin's Start button, or above the bar on the
// display the mouse is on.
export function showMenu(barWin?: BrowserWindow | null) {
  if (!menu) return;
  showBar(); // the Start menu sits on the bar, so opening it brings a hidden bar back
  menuBar = liveBar(barWin) || barUnderMouse();
  hidePreview();
  if (current) menu.setBounds(menuBounds(current, menuBar));
  fadeIn(menu);
  menu.show();
  syncBars();
  menu.focus();
  ipc.send(menu.webContents, 'menu:shown');
  if (menuBar) ipc.send(menuBar.webContents, 'menu:state', true);
}

export function hideMenu() {
  if (!menu || !menu.isVisible()) return;
  lastMenuHide = Date.now();
  menu.hide();
  for (const entry of bars.values()) ipc.send(entry.win.webContents, 'menu:state', false);
  syncBars();
}

export function toggleMenu(barWin?: BrowserWindow | null) {
  if (!menu) return;
  // Clicking Start while the menu is open blurs the menu first, which hides it.
  // Treat a click right after that hide as "close", not "open again".
  if (menu.isVisible()) return hideMenu();
  if (Date.now() - lastMenuHide < 250) return;
  showMenu(barWin);
}

// The settings window is made when it's opened and dropped when it's
// closed, on the page asked for (or the last one). onClosed runs once it's gone. Startbar comes forward with it:
// without that the window can open in front while another app stays
// active, and sheets on it (the file pickers) wait until Startbar is.
export function showSettings(onClosed: () => void, page?: SettingsPage) {
  if (settingsWin) {
    if (page) ipc.send(settingsWin.webContents, 'settings:page', page);
    settingsWin.show();
    app.focus({ steal: true });
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 760,
    minHeight: 480,
    title: 'Startbar Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    fullscreenable: false,
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWin.loadFile(renderer('settings'), page ? { hash: page } : undefined);
  // Ready to show comes before closed, so the window is still there.
  settingsWin.once('ready-to-show', () => {
    settingsWin!.show();
    app.focus({ steal: true });
    settingsWin!.focus();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (onClosed) onClosed();
  });
  return settingsWin;
}

export function broadcast<K extends keyof Events>(channel: K, ...payload: Payload<K>) {
  const wins = [...[...bars.values()].map((e) => e.win), menu, tip, group, calendar, popover, settingsWin];
  for (const w of wins) {
    if (w && !w.isDestroyed()) ipc.send(w.webContents, channel, ...payload);
  }
}

const isPinned = () => previewPinned;
const isShown = () => !!(preview && preview.isVisible());
export const bar = () => mainBar();
export { isPinned as previewPinned, isShown as previewShown, settingsWin as settings };
