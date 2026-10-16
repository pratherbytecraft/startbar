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
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  bar.loadFile(renderer('bar'));
  bar.once('ready-to-show', () => { if (!barHidden) bar.showInactive(); });
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
  menu.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
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
  tip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
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
  group.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
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
}

function layout(settings) {
  theme = settings.theme;
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
  bar.hide();
  for (const fn of visibility) fn(true);
}

function showBar() {
  if (!bar || !barHidden) return;
  barHidden = false;
  bar.showInactive();
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
  menu.focus();
  menu.webContents.send('menu:shown');
  if (bar) bar.webContents.send('menu:state', true);
}

function hideMenu() {
  if (!menu || !menu.isVisible()) return;
  lastMenuHide = Date.now();
  menu.hide();
  if (bar) bar.webContents.send('menu:state', false);
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
  hideBar, showBar, onBarVisibility, showSettings,
  get bar() { return bar; },
  get barHidden() { return barHidden; },
  get menu() { return menu; },
  get settings() { return settingsWin; }
};
