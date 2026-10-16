// The bar window and the Start menu window. Both are frameless, both sit
// above other windows, both get the same state push (settings plus what
// the Mac looks like right now).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const MENU_WIDTH = 420;
const MENU_HEIGHT = 500;
const MENU_GAP = 8;
const GROUP_WIDTH = 300;
const TIP_MARGIN = 8; // room around the tooltip for its shadow
const EDGE = 2; // auto hide: how close to the bottom the mouse has to get
const LEAVE_DELAY = 600; // auto hide: how long the bar stays after the mouse leaves

const preload = path.join(__dirname, '..', 'preload.js');
const renderer = (name) => path.join(__dirname, '..', 'renderer', name, 'index.html');

let bar = null;
let menu = null;
let lastMenuHide = 0;
let tip = null;
let tipAnchor = null; // the hovered button, in bar coordinates
let group = null;
let groupAnchor = null; // { pid, rect } of the group button the list belongs to
let lastGroupHide = { pid: null, at: 0 };
let theme = 'system';
let settingsWin = null;
let barHidden = false; // Hide the Bar, for this session only
const visibility = new Set();
let overFullScreen = false; // keep the bar up over full screen apps
let fullScreenUp = false; // a full screen window is in front on the main display
let autoHide = false;
let peek = false; // auto hide: the mouse is at the edge or on the bar
let peekTimer = null;
let edgeWatch = null;
let holds = 0; // native menus open on the bar

// Every Space, full screen apps included. Whether the bar stays up over a
// full screen app is up to barWanted. The Start menu and the popups can
// always open there, from the bar or the shortcut. Changing this flag while
// running doesn't take on macOS, so it's set once.
function onAllSpaces(win) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function vibrancyFor(settings) {
  return settings.theme === 'system' && settings.translucent ? 'menu' : null;
}

function barBounds(settings) {
  const { bounds } = screen.getPrimaryDisplay();
  const height = Number(settings.barHeight) || 36;
  return { x: bounds.x, y: bounds.y + bounds.height - height, width: bounds.width, height };
}

function menuBounds(settings) {
  const b = barBounds(settings);
  const isClassic = settings.theme === 'classic-2001';
  return {
    x: b.x + (isClassic ? 0 : MENU_GAP),
    y: b.y - MENU_HEIGHT - (isClassic ? 0 : MENU_GAP),
    width: isClassic ? 400 : MENU_WIDTH,
    height: isClassic ? 480 : MENU_HEIGHT
  };
}

function createBar(settings) {
  theme = settings.theme;
  overFullScreen = !settings.taskbar.hideInFullScreen;
  bar = new BrowserWindow({
    ...barBounds(settings),
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
    vibrancy: vibrancyFor(settings),
    visualEffectState: 'active',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  bar.setAlwaysOnTop(true, 'floating');
  onAllSpaces(bar);
  bar.loadFile(renderer('bar'));
  bar.once('ready-to-show', () => {
    setAutoHide(settings.taskbar.autoHide);
    syncBar();
  });
  bar.on('closed', () => { bar = null; });
  return bar;
}

function createMenu(settings) {
  menu = new BrowserWindow({
    ...menuBounds(settings),
    frame: false,
    transparent: true,
    hasShadow: true,
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

// Keeps a window of this width inside the display the bar is on.
function clampX(x, width) {
  const { bounds } = screen.getPrimaryDisplay();
  return Math.round(Math.max(bounds.x + 4, Math.min(x, bounds.x + bounds.width - width - 4)));
}

function showTip(text, rect) {
  if (!tip || !bar) return;
  tipAnchor = rect;
  tip.webContents.send('tip:text', text);
}

// The tooltip renderer measured its text. Center it over the button.
function sizeTip({ width, height }) {
  if (!tip || !bar || !tipAnchor) return;
  const b = bar.getBounds();
  const w = width + TIP_MARGIN * 2;
  const h = height + TIP_MARGIN * 2;
  const x = clampX(b.x + tipAnchor.x + tipAnchor.width / 2 - w / 2, w);
  const y = b.y - 6 - height - TIP_MARGIN;
  tip.setBounds({ x, y, width: w, height: h });
  tip.showInactive();
}

function hideTip() {
  tipAnchor = null;
  if (tip && tip.isVisible()) tip.hide();
}

function showGroup(payload) {
  if (!group || !bar) return;
  // Clicking the group button while its list is open blurs the list first,
  // which hides it. Treat that click as "close", like the Start button.
  if (lastGroupHide.pid === payload.pid && Date.now() - lastGroupHide.at < 250) return;
  groupAnchor = { pid: payload.pid, rect: payload.rect };
  group.webContents.send('group:show', payload);
}

// The group list renderer laid out its rows. Open it above the button.
function sizeGroup({ height }) {
  if (!group || !bar || !groupAnchor) return;
  const b = bar.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const h = Math.min(height, Math.round(workArea.height * 0.6));
  const gap = theme === 'classic-2001' ? 0 : MENU_GAP;
  const x = clampX(b.x + groupAnchor.rect.x, GROUP_WIDTH);
  group.setBounds({ x, y: b.y - h - gap, width: GROUP_WIDTH, height: h });
  group.show();
  group.focus();
}

function hideGroup() {
  if (!group || !group.isVisible()) return;
  lastGroupHide = { pid: groupAnchor && groupAnchor.pid, at: Date.now() };
  groupAnchor = null;
  group.hide();
  syncBar();
}

// MARK: showing and hiding the bar

// Hide the Bar wins, then a full screen app when the bar hides for those.
// With auto hide on, the bar shows while the mouse is at the edge or on it,
// or while the Start menu, a group list or one of the bar's right click
// menus is open.
function barWanted() {
  if (barHidden || (fullScreenUp && !overFullScreen)) return false;
  if (!autoHide) return true;
  return peek || holds > 0 || !!(menu && menu.isVisible()) || !!(group && group.isVisible());
}

function syncBar() {
  if (!bar) return;
  const want = barWanted();
  if (want && !bar.isVisible()) bar.showInactive();
  else if (!want && bar.isVisible()) {
    hideTip();
    bar.hide();
  }
}

function watchEdge() {
  if (!bar) return;
  const p = screen.getCursorScreenPoint();
  const { bounds } = screen.getPrimaryDisplay();
  const inX = p.x >= bounds.x && p.x < bounds.x + bounds.width;
  const atEdge = inX && p.y >= bounds.y + bounds.height - EDGE;
  const onBar = inX && bar.isVisible() && p.y >= bar.getBounds().y;
  if (atEdge || onBar) {
    clearTimeout(peekTimer);
    peekTimer = null;
    if (!peek) {
      peek = true;
      syncBar();
    }
  } else if (peek && !peekTimer) {
    peekTimer = setTimeout(() => {
      peekTimer = null;
      peek = false;
      syncBar();
    }, LEAVE_DELAY);
  }
}

function setAutoHide(on) {
  if (!!on === autoHide) return;
  autoHide = !!on;
  clearInterval(edgeWatch);
  clearTimeout(peekTimer);
  edgeWatch = null;
  peekTimer = null;
  peek = false;
  if (autoHide) edgeWatch = setInterval(watchEdge, 80);
  syncBar();
}

// Keeps an auto hidden bar up while a native menu from it is open. Call the
// returned function when the menu closes.
function holdBar() {
  holds += 1;
  syncBar();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    syncBar();
  };
}

function setOverFullScreen(show) {
  if (show === overFullScreen) return;
  overFullScreen = show;
  syncBar();
}

function setFullScreenUp(up) {
  if (up === fullScreenUp) return;
  fullScreenUp = up;
  syncBar();
}

function layout(settings) {
  theme = settings.theme;
  setOverFullScreen(!settings.taskbar.hideInFullScreen);
  setAutoHide(settings.taskbar.autoHide);
  if (bar) {
    bar.setBounds(barBounds(settings));
    bar.setVibrancy(vibrancyFor(settings));
  }
  if (menu) {
    menu.setBounds(menuBounds(settings));
    menu.setVibrancy(vibrancyFor(settings));
  }
  if (group) group.setVibrancy(vibrancyFor(settings));
  hideTip();
  hideGroup();
}

function hideBar() {
  if (!bar || barHidden) return;
  barHidden = true;
  hideMenu();
  hideTip();
  hideGroup();
  syncBar();
  for (const fn of visibility) fn(true);
}

function showBar() {
  if (!bar || !barHidden) return;
  barHidden = false;
  syncBar();
  for (const fn of visibility) fn(false);
}

function onBarVisibility(fn) {
  visibility.add(fn);
  return () => visibility.delete(fn);
}

function showMenu() {
  if (!menu) return;
  showBar(); // the Start menu sits on the bar, so opening it brings a hidden bar back
  menu.show();
  syncBar();
  menu.focus();
  menu.webContents.send('menu:shown');
  if (bar) bar.webContents.send('menu:state', true);
}

function hideMenu() {
  if (!menu || !menu.isVisible()) return;
  lastMenuHide = Date.now();
  menu.hide();
  if (bar) bar.webContents.send('menu:state', false);
  syncBar();
}

function toggleMenu() {
  if (!menu) return;
  // Clicking Start while the menu is open blurs the menu first, which hides it.
  // Treat a click right after that hide as "close", not "open again".
  if (menu.isVisible()) return hideMenu();
  if (Date.now() - lastMenuHide < 250) return;
  showMenu();
}

// The settings window is made when it's opened and dropped when it's
// closed. onClosed runs once it's gone.
function showSettings(onClosed) {
  if (settingsWin) {
    settingsWin.show();
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
  settingsWin.loadFile(renderer('settings'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (onClosed) onClosed();
  });
  return settingsWin;
}

function broadcast(channel, payload) {
  for (const w of [bar, menu, tip, group, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

module.exports = {
  createBar, createMenu, createTip, createGroup, layout, showMenu, hideMenu, toggleMenu,
  showTip, sizeTip, hideTip, showGroup, sizeGroup, hideGroup, broadcast,
  hideBar, showBar, onBarVisibility, holdBar, setFullScreenUp, showSettings,
  get bar() { return bar; },
  get barHidden() { return barHidden; },
  get menu() { return menu; },
  get settings() { return settingsWin; }
};
