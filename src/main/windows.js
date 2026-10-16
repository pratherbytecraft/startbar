// The bar window and the Start menu window. Both are frameless, both sit
// above other windows, both get the same state push (settings plus what
// the Mac looks like right now).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const MENU_WIDTH = 420;
const MENU_HEIGHT = 500;
const MENU_GAP = 8;

const preload = path.join(__dirname, '..', 'preload.js');
const renderer = (name) => path.join(__dirname, '..', 'renderer', name, 'index.html');

let bar = null;
let menu = null;
let lastMenuHide = 0;

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
  bar = new BrowserWindow({
    ...barBounds(settings),
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
  bar.once('ready-to-show', () => bar.showInactive());
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

function layout(settings) {
  if (bar) {
    bar.setBounds(barBounds(settings));
    bar.setVibrancy(vibrancyFor(settings));
  }
  if (menu) {
    menu.setBounds(menuBounds(settings));
    menu.setVibrancy(vibrancyFor(settings));
  }
}

function showMenu() {
  if (!menu) return;
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

function broadcast(channel, payload) {
  for (const w of [bar, menu]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

module.exports = { createBar, createMenu, layout, showMenu, hideMenu, toggleMenu, broadcast, get bar() { return bar; }, get menu() { return menu; } };
