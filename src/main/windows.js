// The bars (one per display, or only on the main one), the Start menu and
// the small windows that open above a bar. All frameless, all above other
// windows, all get the same state push (settings plus what the Mac looks
// like right now). Each popup remembers the bar it opened from and sits
// above that one.
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

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
const renderer = (name) => path.join(__dirname, '..', 'renderer', name, 'index.html');

// One entry per bar: { win, displayId, peek, peekTimer, holds }. peek is
// auto hide's "the mouse is at this bar's edge or on it", holds counts the
// native menus open on it.
const bars = new Map();
let current = null; // the settings the bars were last laid out with
let menu = null;
let menuBar = null; // the bar the Start menu opened on
let lastMenuHide = 0;
let tip = null;
let tipAnchor = null; // { rect, bar } of the hovered button, rect in bar coordinates
let tipFollow = null; // the screen point the tip follows as the ghost of a dragged window
let group = null;
let groupAnchor = null; // { pid, rect, bar } of the group button the list belongs to
let lastGroupHide = { pid: null, at: 0 };
let calendar = null;
let calendarAnchor = null; // { rect, bar } of the clock
let lastCalendarHide = 0;
let popover = null;
let popoverAnchor = null; // { kind, rect, bar } of the tray icon it belongs to
let lastPopoverHide = { kind: null, at: 0 };
let theme = 'system';
let preview = null; // the window pictures over a window button
let previewAnchor = null; // { rect, bar } of the button
let previewHover = false; // the mouse is over the pictures
let previewHide = null;
let previewHeld = false; // a window is being dragged out of the pictures, so they stay
let previewPinned = false; // opened by a click, stays until a click elsewhere
const unpinHooks = new Set();
let settingsWin = null;
let barHidden = false; // Hide the Bar, for this session only
const visibility = new Set();
let overFullScreen = false; // keep the bars up over full screen apps
let fullScreenOn = new Set(); // displays with a full screen window in front
let autoHide = false;
let edgeWatch = null;

// Every Space, full screen apps included. Whether the bar stays up over a
// full screen app is up to barWanted. The Start menu and the popups can
// always open there, from the bar or the shortcut. Changing this flag while
// running doesn't take on macOS, so it's set once.
function onAllSpaces(win) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// Classic 2009 blurs behind the bar only. Its Start menu and popups have
// rounded corners drawn in CSS, which the blur would fill in.
function vibrancyFor(settings, bar = false) {
  if (!settings.translucent) return null;
  if (settings.theme === 'classic-2009') return bar ? 'hud' : null;
  return settings.theme === 'system' ? 'menu' : null;
}

function barBounds(settings, display) {
  const { bounds } = display;
  const height = Number(settings.barHeight) || 36;
  return { x: bounds.x, y: bounds.y + bounds.height - height, width: bounds.width, height };
}

// MARK: which bar is which

function displayById(id) {
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function entryOf(win) {
  for (const entry of bars.values()) if (entry.win === win) return entry;
  return null;
}

// The bar a renderer message came from, or null when it came from
// another window (the group list, for one).
function barOf(webContents) {
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
const CLASSIC_MENUS = { 'classic-2009': { width: 410, height: 500 }, 'classic-2001': { width: 400, height: 480 }, 'classic-1995': { width: 380, height: 460 } };
const gapFor = (name) => (CLASSIC_MENUS[name] ? 0 : MENU_GAP);
const isClassic = (settings) => !!CLASSIC_MENUS[settings.theme];

function menuBounds(settings, barWin) {
  const entry = barWin && entryOf(barWin);
  const b = barBounds(settings, entry ? displayById(entry.displayId) : screen.getPrimaryDisplay());
  const { width, height } = CLASSIC_MENUS[settings.theme] || { width: MENU_WIDTH, height: MENU_HEIGHT };
  return { x: b.x + gapFor(settings.theme), y: b.y - height - gapFor(settings.theme), width, height };
}

// What a bar needs to know about where it is: its display, whether that's
// the main one, and where every display is (to sort windows by display).
function sendPlace(entry) {
  if (entry.win.isDestroyed()) return;
  const main = screen.getPrimaryDisplay();
  entry.win.webContents.send('bar:place', {
    id: entry.displayId,
    main: entry.displayId === main.id,
    bars: bars.size,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, main: d.id === main.id, bounds: d.bounds }))
  });
}

function createBar(settings, display) {
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
    vibrancy: vibrancyFor(settings, true),
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  bar.setAlwaysOnTop(true, 'floating');
  onAllSpaces(bar);
  const entry = { win: bar, displayId: display.id, peek: false, peekTimer: null, holds: 0 };
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
function syncDisplays(settings) {
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

function createBars(settings) {
  current = settings;
  theme = settings.theme;
  overFullScreen = !settings.taskbar.hideInFullScreen;
  syncDisplays(settings);
  setAutoHide(settings.taskbar.autoHide);
}

function createMenu(settings) {
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
    vibrancy: vibrancyFor(settings),
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
function createTip() {
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

function createGroup(settings) {
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
    vibrancy: vibrancyFor(settings),
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
function createPreview(settings) {
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
    vibrancy: vibrancyFor(settings),
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  preview.setAlwaysOnTop(true, 'pop-up-menu');
  onAllSpaces(preview);
  preview.loadFile(renderer('preview'));
  preview.on('closed', () => { preview = null; });
  return preview;
}

function showPreview(payload, barWin) {
  if (!preview || !liveBar(barWin) || previewPinned) return;
  clearTimeout(previewHide);
  previewAnchor = { rect: payload.rect, bar: barWin };
  preview.webContents.send('preview:show', payload);
}

function sendPreview(channel, data) {
  if (preview && !preview.isDestroyed()) preview.webContents.send(channel, data);
}

// The pictures laid out. Open them above the button, centered on it.
function sizePreview({ width, height }) {
  if (!preview || !previewAnchor || !liveBar(previewAnchor.bar)) return;
  const b = previewAnchor.bar.getBounds();
  const { rect } = previewAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - width / 2, width, previewAnchor.bar);
  preview.setBounds({ x, y: b.y - height - gapFor(theme), width, height });
  if (!preview.isVisible()) preview.showInactive();
}

// The mouse left the button. The pictures stay a moment, so the mouse can
// move up onto them.
function leavePreview() {
  clearTimeout(previewHide);
  if (previewHeld || previewPinned) return;
  previewHide = setTimeout(() => { if (!previewHover) hidePreview(); }, 250);
}

// Keep the pictures up while a window is dragged out of them.
function holdPreview(on) {
  previewHeld = !!on;
  if (previewHeld) clearTimeout(previewHide);
  else if (!previewHover) leavePreview();
}

function hoverPreview(on) {
  previewHover = !!on;
  if (previewHover) clearTimeout(previewHide);
  else leavePreview();
}

function hidePreview() {
  clearTimeout(previewHide);
  previewAnchor = null;
  previewHover = false;
  previewHeld = false;
  if (previewPinned) {
    previewPinned = false;
    for (const fn of unpinHooks) fn();
  }
  if (preview && preview.isVisible()) preview.hide();
}

// With previews on, a click on a group opens its pictures and keeps them
// up until a click elsewhere; a second click on the button closes them.
// True when the pictures were opened, false when the click closed them.
function pinPreview(payload, barWin) {
  if (!preview || !liveBar(barWin)) return false;
  const sameButton = previewAnchor && previewAnchor.bar === barWin && previewAnchor.rect.x === payload.rect.x && previewAnchor.rect.width === payload.rect.width;
  if (previewPinned && sameButton) {
    hidePreview();
    return false;
  }
  clearTimeout(previewHide);
  previewPinned = true;
  previewAnchor = { rect: payload.rect, bar: barWin };
  preview.webContents.send('preview:show', payload);
  return true;
}

// A screen point on the pinned pictures or on the button they belong to,
// where a click is theirs to handle.
function previewHit(point) {
  if (!previewPinned || !preview || !previewAnchor || !liveBar(previewAnchor.bar)) return false;
  const inside = (b) => point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
  const bar = previewAnchor.bar.getBounds();
  const { rect } = previewAnchor;
  return inside(preview.getBounds()) || inside({ x: bar.x + rect.x, y: bar.y + rect.y, width: rect.width, height: rect.height });
}

function onPreviewUnpinned(fn) {
  unpinHooks.add(fn);
}

// The tray's volume, Wi-Fi and battery panels share one window.
function createPopover(settings) {
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
    vibrancy: vibrancyFor(settings),
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
function createCalendar(settings) {
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
    vibrancy: vibrancyFor(settings),
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
function clampX(x, width, barWin) {
  const entry = barWin && entryOf(barWin);
  const { bounds } = entry ? displayById(entry.displayId) : screen.getPrimaryDisplay();
  return Math.round(Math.max(bounds.x + 4, Math.min(x, bounds.x + bounds.width - width - 4)));
}

// A popup anchored to a bar that has gone away has nothing to sit on.
const liveBar = (barWin) => barWin && !barWin.isDestroyed() && entryOf(barWin) ? barWin : null;

// A button whose own panel is open doesn't get a tooltip on top of it.
function panelOpenAt(rect, barWin) {
  return [[popover, popoverAnchor], [calendar, calendarAnchor], [group, groupAnchor]].some(([win, anchor]) =>
    win && win.isVisible() && anchor && anchor.bar === barWin && anchor.rect.x === rect.x && anchor.rect.width === rect.width);
}

function showTip(text, rect, barWin) {
  if (!tip || !liveBar(barWin) || panelOpenAt(rect, barWin)) return;
  tipAnchor = { rect, bar: barWin };
  tipFollow = null;
  tip.webContents.send('tip:text', text);
}

// The tooltip renderer measured its text. Center it over the button, or
// put it by the cursor when it's the ghost of a dragged window.
function sizeTip({ width, height }) {
  if (!tip) return;
  const w = width + TIP_MARGIN * 2;
  const h = height + TIP_MARGIN * 2;
  if (tipFollow) {
    tip.setBounds({ ...ghostAt(tipFollow), width: w, height: h });
    tip.showInactive();
    return;
  }
  if (!tipAnchor || !liveBar(tipAnchor.bar)) return;
  const b = tipAnchor.bar.getBounds();
  const { rect } = tipAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - w / 2, w, tipAnchor.bar);
  const y = b.y - 6 - height - TIP_MARGIN;
  tip.setBounds({ x, y, width: w, height: h });
  tip.showInactive();
}

function hideTip() {
  tipAnchor = null;
  tipFollow = null;
  if (tip && tip.isVisible()) tip.hide();
}

// MARK: a window dragged out of its group

const ghostAt = (p) => ({ x: Math.round(p.x + 12), y: Math.round(p.y + 12) });

// The tip as the ghost under the cursor: the window's icon and title.
function showGhost(payload, point) {
  if (!tip) return;
  tipAnchor = null;
  tipFollow = point;
  tip.webContents.send('tip:text', payload);
}

function moveGhost(point) {
  tipFollow = point;
  if (tip && tip.isVisible()) {
    const { x, y } = ghostAt(point);
    tip.setPosition(x, y);
  }
}

// The bar under a screen point, if any.
function barAt(point) {
  for (const entry of bars.values()) {
    if (entry.win.isDestroyed() || !entry.win.isVisible()) continue;
    const b = entry.win.getBounds();
    if (point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height) return entry.win;
  }
  return null;
}

function showGroup(payload, barWin) {
  if (!group || !liveBar(barWin)) return;
  hidePreview();
  // A click on the bar doesn't always blur the list, so check for it open.
  if (group.isVisible() && groupAnchor && groupAnchor.pid === payload.pid && groupAnchor.bar === barWin) return hideGroup();
  // Clicking the group button while its list is open blurs the list first,
  // which hides it. Treat that click as "close", like the Start button.
  if (lastGroupHide.pid === payload.pid && Date.now() - lastGroupHide.at < 250) return;
  groupAnchor = { pid: payload.pid, rect: payload.rect, bar: barWin };
  group.webContents.send('group:show', payload);
}

// The group list renderer laid out its rows. Open it above the button.
function sizeGroup({ height }) {
  if (!group || !groupAnchor || !liveBar(groupAnchor.bar)) return;
  const b = groupAnchor.bar.getBounds();
  const { workArea } = displayById(entryOf(groupAnchor.bar).displayId);
  const h = Math.min(height, Math.round(workArea.height * 0.6));
  const gap = gapFor(theme);
  const x = clampX(b.x + groupAnchor.rect.x, GROUP_WIDTH, groupAnchor.bar);
  group.setBounds({ x, y: b.y - h - gap, width: GROUP_WIDTH, height: h });
  group.show();
  group.focus();
}

function hideGroup() {
  if (!group || !group.isVisible()) return;
  lastGroupHide = { pid: groupAnchor && groupAnchor.pid, at: Date.now() };
  groupAnchor = null;
  group.hide();
  syncBars();
}

function toggleCalendar(rect, barWin) {
  if (!calendar || !liveBar(barWin)) return;
  if (calendar.isVisible()) return hideCalendar();
  // When a click on the clock does blur the calendar, that hides it first.
  // Treat that click as "close" too.
  if (Date.now() - lastCalendarHide < 250) return;
  calendarAnchor = { rect, bar: barWin };
  calendar.webContents.send('calendar:show');
}

// The calendar laid out this month. Open it above the clock, lined up with
// its right edge.
function sizeCalendar({ height }) {
  if (!calendar || !calendarAnchor || !liveBar(calendarAnchor.bar)) return;
  const b = calendarAnchor.bar.getBounds();
  const { rect } = calendarAnchor;
  const gap = gapFor(theme);
  const x = clampX(b.x + rect.x + rect.width - CALENDAR_WIDTH, CALENDAR_WIDTH, calendarAnchor.bar);
  calendar.setBounds({ x, y: b.y - height - gap, width: CALENDAR_WIDTH, height });
  if (!calendar.isVisible()) {
    calendar.show();
    calendar.focus();
  }
}

function hideCalendar() {
  if (!calendar || !calendar.isVisible()) return;
  lastCalendarHide = Date.now();
  calendarAnchor = null;
  calendar.hide();
  syncBars();
}

// A click on a tray icon opens its panel, or closes it when it's the one open.
function togglePopover(kind, rect, barWin) {
  if (!popover || !liveBar(barWin)) return;
  const same = popoverAnchor && popoverAnchor.kind === kind && popoverAnchor.bar === barWin;
  if (popover.isVisible() && same) return hidePopover();
  if (lastPopoverHide.kind === kind && Date.now() - lastPopoverHide.at < 250) return;
  popoverAnchor = { kind, rect, bar: barWin };
  popover.webContents.send('popover:show', kind);
}

// The panel laid out its content. Open it above the icon, centered on it.
function sizePopover({ height }) {
  if (!popover || !popoverAnchor || !liveBar(popoverAnchor.bar)) return;
  const b = popoverAnchor.bar.getBounds();
  const gap = gapFor(theme);
  const { rect } = popoverAnchor;
  const x = clampX(b.x + rect.x + rect.width / 2 - POPOVER_WIDTH / 2, POPOVER_WIDTH, popoverAnchor.bar);
  popover.setBounds({ x, y: b.y - height - gap, width: POPOVER_WIDTH, height });
  if (!popover.isVisible()) {
    popover.show();
    popover.focus();
  }
}

function hidePopover() {
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
function barWanted(entry) {
  if (barHidden || (fullScreenOn.has(entry.displayId) && !overFullScreen)) return false;
  if (!autoHide) return true;
  if (entry.peek || entry.holds > 0) return true;
  const open = (win, anchorBar) => win && win.isVisible() && anchorBar === entry.win;
  return open(menu, menuBar) || open(group, groupAnchor && groupAnchor.bar)
    || open(calendar, calendarAnchor && calendarAnchor.bar) || open(popover, popoverAnchor && popoverAnchor.bar);
}

function syncBar(entry) {
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
      entry.peekTimer = null;
      if (!entry.peek) {
        entry.peek = true;
        syncBar(entry);
      }
    } else if (entry.peek && !entry.peekTimer) {
      entry.peekTimer = setTimeout(() => {
        entry.peekTimer = null;
        entry.peek = false;
        syncBar(entry);
      }, LEAVE_DELAY);
    }
  }
}

function setAutoHide(on) {
  if (!!on === autoHide) return;
  autoHide = !!on;
  clearInterval(edgeWatch);
  edgeWatch = null;
  for (const entry of bars.values()) {
    clearTimeout(entry.peekTimer);
    entry.peekTimer = null;
    entry.peek = false;
  }
  if (autoHide) edgeWatch = setInterval(watchEdge, 80);
  syncBars();
}

// Keeps an auto hidden bar up while a native menu from it is open. Call the
// returned function when the menu closes.
function holdBar(barWin) {
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

function setOverFullScreen(show) {
  if (show === overFullScreen) return;
  overFullScreen = show;
  syncBars();
}

// The displays that have a full screen window in front, by id.
function setFullScreenDisplays(ids) {
  const next = new Set(ids);
  if (next.size === fullScreenOn.size && [...next].every((id) => fullScreenOn.has(id))) return;
  fullScreenOn = next;
  syncBars();
}

// Where each bar is, for moving windows up off them.
function barAreas() {
  if (barHidden) return [];
  return [...bars.values()].filter((e) => !e.win.isDestroyed()).map((entry) => {
    const display = displayById(entry.displayId);
    return { top: display.workArea.y, bottom: entry.win.getBounds().y, screen: display.bounds };
  });
}

// macOS rounds a borderless window's corners and outlines it, which suits
// the System theme only. That's fixed when a window is made, so the popups
// are made again when the theme changes between System and a classic one.
let popupsClassic = null;

function remakePopups(settings) {
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

function layout(settings) {
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

function hideBar() {
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

function showBar() {
  if (bars.size === 0 || !barHidden) return;
  barHidden = false;
  syncBars();
  for (const fn of visibility) fn(false);
}

function onBarVisibility(fn) {
  visibility.add(fn);
  return () => visibility.delete(fn);
}

// Opens the Start menu above barWin's Start button, or above the bar on the
// display the mouse is on.
function showMenu(barWin) {
  if (!menu) return;
  showBar(); // the Start menu sits on the bar, so opening it brings a hidden bar back
  menuBar = liveBar(barWin) || barUnderMouse();
  hidePreview();
  if (current) menu.setBounds(menuBounds(current, menuBar));
  menu.show();
  syncBars();
  menu.focus();
  menu.webContents.send('menu:shown');
  if (menuBar) menuBar.webContents.send('menu:state', true);
}

function hideMenu() {
  if (!menu || !menu.isVisible()) return;
  lastMenuHide = Date.now();
  menu.hide();
  for (const entry of bars.values()) entry.win.webContents.send('menu:state', false);
  syncBars();
}

function toggleMenu(barWin) {
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
function showSettings(onClosed, page) {
  if (settingsWin) {
    if (page) settingsWin.webContents.send('settings:page', page);
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
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    app.focus({ steal: true });
    settingsWin.focus();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (onClosed) onClosed();
  });
  return settingsWin;
}

function broadcast(channel, payload) {
  const wins = [...[...bars.values()].map((e) => e.win), menu, tip, group, calendar, popover, settingsWin];
  for (const w of wins) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

module.exports = {
  createBars, createMenu, createTip, createGroup, createCalendar, createPopover, createPreview, layout, showMenu, hideMenu, toggleMenu,
  showPreview, sendPreview, sizePreview, leavePreview, hoverPreview, hidePreview, holdPreview, showGhost, moveGhost, barAt,
  pinPreview, previewHit, previewPinned: () => previewPinned, onPreviewUnpinned,
  showTip, sizeTip, hideTip, showGroup, sizeGroup, hideGroup, toggleCalendar, sizeCalendar, hideCalendar,
  togglePopover, sizePopover, hidePopover, broadcast,
  hideBar, showBar, onBarVisibility, holdBar, setFullScreenDisplays, barAreas, barOf, showSettings,
  get bar() { return mainBar(); },
  get barHidden() { return barHidden; },
  get menu() { return menu; },
  get settings() { return settingsWin; }
};
