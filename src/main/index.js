// Startbar main process. Owns the windows, the settings, the app list and
// everything that touches the Mac. Renderers only draw.
const { app, ipcMain, shell, dialog, globalShortcut, screen, Menu, nativeTheme } = require('electron');
const { execFile, execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const settings = require('./settings');
const system = require('./system');
const apps = require('./apps');
const windows = require('./windows');
const tasks = require('./tasks');
const access = require('./access');
const tray = require('./tray');
const pins = require('./pins');
const dock = require('./dock');

// From the package, not app.getVersion(): Startbar.app carries no version so
// it stays the same across updates (see scripts/build-app.js).
const VERSION = require('../../package.json').version;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  // `startbar` run again while running: just bring the menu up as a sign of life.
  windows.showMenu();
});

app.on('activate', () => {
  // Startbar.app opened again from Spotlight, the Start menu or `startbar`.
  if (app.isReady()) windows.showMenu();
});

function userName() {
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf8' }).trim() || os.userInfo().username;
  } catch {
    return os.userInfo().username;
  }
}

let shortcutError = null; // the Start menu shortcut couldn't be registered
let dockStatus = null; // { autohide, position }, read when the settings window opens

function state() {
  return {
    settings: settings.get(),
    pins: pins.get(),
    dock: dockStatus,
    shortcutError,
    system: system.snapshot(),
    user: userName(),
    version: VERSION,
    home: os.homedir()
  };
}

function pushState() {
  windows.broadcast('state', state());
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  shortcutError = null;
  const combo = settings.get().startMenu.shortcut;
  if (!combo) return;
  try {
    const ok = globalShortcut.register(combo, () => windows.toggleMenu());
    if (!ok) {
      shortcutError = 'taken';
      console.log(`Startbar: the shortcut ${combo} is taken by another app.`);
    }
  } catch (err) {
    shortcutError = 'invalid';
    console.log(`Startbar: could not register ${combo}: ${err.message}`);
  }
}

// The appearance setting also picks the window materials, so a dark choice
// on a light Mac blurs dark too.
function applyAppearance() {
  const map = { auto: 'system', light: 'light', dark: 'dark' };
  nativeTheme.themeSource = map[settings.get().appearance] || 'system';
}

// While the settings window is open Startbar is in the Dock and the app
// switcher, so the window can't get lost behind other windows.
function openSettings() {
  windows.hideMenu();
  app.setActivationPolicy('regular');
  const fresh = !windows.settings;
  const win = windows.showSettings(() => app.setActivationPolicy('accessory'));
  if (fresh) win.on('focus', refreshDock); // the Dock may have changed in System Settings
  app.focus({ steal: true });
  refreshDock();
}

async function refreshDock() {
  dockStatus = await dock.status();
  pushState();
}

async function setDockHidden(hide) {
  if (hide) {
    const { response } = await dialog.showMessageBox(windows.settings, {
      type: 'question',
      message: 'Hide the Dock?',
      detail: 'The Dock will stay out of sight until the mouse reaches the bottom of the screen, the same as "Automatically hide and show the Dock" in System Settings. You can show it again here.',
      buttons: ['Hide the Dock', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });
    if (response !== 0) return;
  }
  const result = await dock.setAutohide(hide);
  await refreshDock();
  // The first time, macOS asks for the permission, and closing its prompt
  // hands focus to the app that was in front before Startbar.
  if (windows.settings) {
    app.focus({ steal: true });
    windows.settings.focus();
  }
  if (result === 'ok') return;
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'warning',
    message: result === 'notAllowed' ? "Startbar isn't allowed to change the Dock" : "The Dock didn't change",
    detail: result === 'notAllowed'
      ? 'Turn on System Events under Startbar in Privacy and Security, Automation, then try again. Or turn on "Automatically hide and show the Dock" in Desktop and Dock.'
      : 'Try "Automatically hide and show the Dock" in System Settings, under Desktop and Dock.',
    buttons: ['Open System Settings', 'OK'],
    defaultId: 1,
    cancelId: 1
  });
  if (response === 0) {
    shell.openExternal(result === 'notAllowed'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
      : 'x-apple.systempreferences:com.apple.Desktop-Settings.extension');
  }
}

async function resetSettings() {
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'warning',
    message: 'Reset all settings to the defaults?',
    detail: 'The theme, the bar, the Start menu and the clock go back to how they were when Startbar was installed.',
    buttons: ['Reset', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  });
  if (response === 0) settings.reset();
}

async function runPower(action) {
  const names = { sleep: 'sleep', logout: 'log out', shutdown: 'shut down' };
  const verb = names[action];
  if (!verb) return;
  if (settings.get().startMenu.confirmPower && action !== 'sleep') {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: [action === 'logout' ? 'Log Out' : 'Shut Down', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: action === 'logout' ? 'Log out now?' : 'Shut down now?',
      detail: 'Open apps will be asked to close first.'
    });
    if (response !== 0) return;
  }
  execFile('osascript', ['-e', `tell application "System Events" to ${verb}`]);
}

async function showAbout() {
  app.focus({ steal: true }); // opened from the menu bar icon, Startbar isn't in front
  const { response } = await dialog.showMessageBox({
    type: 'none',
    title: 'About Startbar',
    message: `Startbar ${VERSION}`,
    detail: 'A taskbar for macOS. Free to use.\nPrather Bytecraft. All rights reserved.',
    buttons: ['OK', 'Support on Ko-fi', 'Report an Issue', 'Quit Startbar'],
    defaultId: 0,
    cancelId: 0
  });
  if (response === 1) shell.openExternal('https://ko-fi.com/prathercc');
  if (response === 2) shell.openExternal('https://github.com/pratherbytecraft/startbar/issues');
  if (response === 3) app.quit();
}

// Hide the Bar is for this session only. The first time, say how to get it back.
async function hideBar() {
  windows.hideBar();
  if (settings.get().hideNoteShown) return;
  settings.update({ hideNoteShown: true });
  const combo = settings.get().startMenu.shortcut;
  const ways = ['click the Startbar icon in the menu bar'];
  if (combo) ways.push(`press ${combo.split('+').join(' ')}`);
  ways.push('open Startbar again from Spotlight');
  const last = ways.pop();
  app.focus({ steal: true }); // Startbar has no Dock icon, so bring the dialog forward
  await dialog.showMessageBox({
    type: 'info',
    message: 'The bar is hidden',
    detail: `To bring it back, ${ways.join(', ')} or ${last}.`,
    buttons: ['OK']
  });
}

function toggleBar() {
  if (windows.barHidden) windows.showBar();
  else hideBar();
}

// Tells the helper where the bar is so it can move windows up off it. Not
// while the bar hides itself, since then windows can use the whole screen.
function updateKeepOff() {
  const bar = windows.bar;
  const t = settings.get().taskbar;
  if (!bar || windows.barHidden || t.autoHide || !t.moveWindowsUp) return tasks.setKeepOff(null);
  const { bounds, workArea } = screen.getPrimaryDisplay();
  tasks.setKeepOff({
    top: workArea.y,
    bottom: bar.getBounds().y,
    screen: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }
  });
}

function updateTray() {
  tray.update(settings.get().menuBarIcon, {
    hidden: windows.barHidden,
    toggleBar,
    openMenu: () => windows.showMenu(),
    settings: openSettings,
    about: () => showAbout(),
    quit: () => app.quit()
  });
}

// A full screen window in front on the main display. The bar steps aside for
// it unless the setting says otherwise.
function fullScreenUp(t) {
  const { bounds } = screen.getPrimaryDisplay();
  const onMain = (w) => w.x >= bounds.x && w.x < bounds.x + bounds.width && w.y >= bounds.y && w.y < bounds.y + bounds.height;
  return t.apps.some((a) => a.windows.some((w) => w.fullScreen && w.onScreen && onMain(w)));
}

// Menus that open from the bar keep an auto hidden bar up until they close.
function popupOnBar(menu) {
  if (!windows.bar) return;
  menu.popup({ window: windows.bar, callback: windows.holdBar() });
}

// Right click on an empty part of the bar. Kept short: everything else lives
// in the settings window.
function showBarMenu() {
  if (!windows.bar) return;
  popupOnBar(Menu.buildFromTemplate([
    { label: 'Hide the Bar', click: () => hideBar() },
    { label: 'Startbar Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit Startbar', click: () => app.quit() }
  ]));
}

// The menu bar while one of Startbar's windows has focus (the Start menu, a
// group list, the settings window, a dialog). Replaces Electron's default
// File, View, Window and Help menus. Edit stays so copy and paste work in
// the search boxes.
function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Startbar',
      submenu: [
        { label: 'About Startbar', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: openSettings },
        { type: 'separator' },
        { label: 'Hide the Bar', click: () => hideBar() },
        { label: 'Close Window', accelerator: 'Command+W', role: 'close' },
        { label: 'Quit Startbar', click: () => app.quit() }
      ]
    },
    { role: 'editMenu' }
  ]));
}

function launchApp(appPath) {
  windows.hideMenu();
  apps.noteLaunch(appPath);
  shell.openPath(appPath);
}

function pinItem(appPath) {
  return pins.has(appPath)
    ? { label: 'Unpin from Bar', click: () => pins.remove(appPath) }
    : { label: 'Pin to Bar', click: () => pins.add(appPath) };
}

// Right click on a pinned app.
function showPinMenu(appPath) {
  if (!windows.bar || !pins.has(appPath)) return;
  popupOnBar(Menu.buildFromTemplate([pinItem(appPath)]));
}

// Right click on an app in the Start menu.
function showAppMenu(appPath) {
  if (!windows.menu || !pins.isApp(appPath)) return;
  Menu.buildFromTemplate([
    { label: 'Open', click: () => launchApp(appPath) },
    { type: 'separator' },
    pinItem(appPath)
  ]).popup({ window: windows.menu });
}

async function addPins() {
  const { canceled, filePaths } = await dialog.showOpenDialog(windows.settings, {
    title: 'Pin Apps to the Bar',
    buttonLabel: 'Pin',
    defaultPath: '/Applications',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Apps', extensions: ['app'] }]
  });
  if (!canceled) pins.add(...filePaths);
}

// Right click on a window, group or app button.
function showTaskMenu(target) {
  const app = tasks.get().apps.find((a) => a.pid === target.pid);
  if (!app || !windows.bar) return;
  const send = (cmd, extra) => tasks.send({ cmd, ...extra });
  const items = [];
  if (target.kind === 'window') {
    const win = app.windows.find((w) => w.id === target.id);
    if (win) {
      items.push(
        win.minimized
          ? { label: 'Restore', click: () => send('unminimize', { id: win.id }) }
          : { label: 'Minimize', click: () => send('minimize', { id: win.id }) },
        { label: 'Close', click: () => send('close', { id: win.id }) },
        { type: 'separator' }
      );
    }
  } else if (target.kind === 'group' && Array.isArray(target.ids)) {
    items.push(
      { label: 'Minimize All', click: () => target.ids.forEach((id) => send('minimize', { id })) },
      { label: 'Close All', click: () => target.ids.forEach((id) => send('close', { id })) },
      { type: 'separator' }
    );
  }
  if (pins.isApp(app.path)) items.push(pinItem(app.path), { type: 'separator' });
  items.push({ label: `Quit ${app.name}`, click: () => send('quitApp', { pid: app.pid }) });
  popupOnBar(Menu.buildFromTemplate(items));
}

function wireIpc() {
  ipcMain.handle('state', () => state());
  ipcMain.on('bar:start', () => windows.toggleMenu());
  ipcMain.on('bar:menu', () => showBarMenu());
  ipcMain.on('menu:hide', () => windows.hideMenu());
  ipcMain.handle('menu:apps', () => apps.load());
  ipcMain.handle('menu:recent', () => apps.recent(settings.get().startMenu.recentCount));
  ipcMain.on('menu:launch', (_e, appPath) => launchApp(appPath));
  ipcMain.on('menu:appMenu', (_e, appPath) => showAppMenu(appPath));
  ipcMain.on('menu:open', (_e, target) => {
    windows.hideMenu();
    const home = os.homedir();
    const places = {
      applications: '/Applications',
      documents: path.join(home, 'Documents'),
      downloads: path.join(home, 'Downloads'),
      home,
      systemSettings: '/System/Applications/System Settings.app'
    };
    if (target === 'about') return showAbout();
    if (target === 'settings') return openSettings();
    if (places[target]) shell.openPath(places[target]);
  });
  ipcMain.on('menu:power', (_e, action) => {
    windows.hideMenu();
    runPower(action);
  });
  ipcMain.handle('settings:update', (_e, patch) => settings.update(patch));
  ipcMain.on('settings:reset', () => resetSettings());
  ipcMain.on('settings:link', (_e, name) => {
    const links = {
      kofi: 'https://ko-fi.com/prathercc',
      issues: 'https://github.com/pratherbytecraft/startbar/issues'
    };
    if (links[name]) shell.openExternal(links[name]);
  });
  ipcMain.on('access:open', () => access.openPane());
  ipcMain.on('pins:launch', (_e, appPath) => {
    if (pins.has(appPath)) shell.openPath(appPath);
  });
  ipcMain.on('pins:menu', (_e, appPath) => showPinMenu(appPath));
  ipcMain.on('pins:set', (_e, list) => pins.set(list));
  ipcMain.on('pins:remove', (_e, appPath) => pins.remove(appPath));
  ipcMain.on('pins:add', () => addPins());
  ipcMain.on('dock:hidden', (_e, hide) => setDockHidden(!!hide));
  // The shortcut field records keys, so the global shortcut steps aside.
  ipcMain.on('shortcut:pause', () => globalShortcut.unregisterAll());
  ipcMain.on('shortcut:resume', () => {
    registerShortcut();
    pushState();
  });
  ipcMain.handle('tasks:get', () => tasks.get());
  ipcMain.handle('tasks:command', (_e, command) => tasks.send(command));
  ipcMain.handle('tasks:icons', (_e, paths) => apps.icons(Array.isArray(paths) ? paths : []));
  ipcMain.on('tasks:menu', (_e, target) => showTaskMenu(target || {}));
  ipcMain.on('tip:show', (_e, { text, rect }) => windows.showTip(String(text), rect));
  ipcMain.on('tip:size', (_e, size) => windows.sizeTip(size));
  ipcMain.on('tip:hide', () => windows.hideTip());
  ipcMain.on('group:show', (_e, payload) => windows.showGroup(payload));
  ipcMain.on('group:size', (_e, size) => windows.sizeGroup(size));
  ipcMain.on('group:hide', () => windows.hideGroup());
}

app.whenReady().then(() => {
  app.setActivationPolicy('accessory'); // no Dock icon, no app switcher entry
  settings.init();
  applyAppearance();
  setAppMenu();
  wireIpc();
  windows.createBar(settings.get());
  windows.createMenu(settings.get());
  windows.createTip();
  windows.createGroup(settings.get());
  registerShortcut();
  updateTray();
  windows.onBarVisibility(() => {
    updateTray();
    updateKeepOff();
  });
  apps.load(); // warm the icon cache before the first click
  tasks.onChange((t) => {
    windows.setFullScreenUp(fullScreenUp(t));
    windows.broadcast('tasks', t);
    access.check(t);
  });
  updateKeepOff();
  tasks.start();

  settings.onChange((s) => {
    applyAppearance();
    windows.layout(s);
    registerShortcut();
    updateTray();
    updateKeepOff();
    pushState();
  });
  pins.onChange(pushState);
  system.watch(pushState);
  const relayout = () => {
    windows.layout(settings.get());
    updateKeepOff();
  };
  screen.on('display-metrics-changed', relayout);
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => tasks.stop());
app.on('will-quit', () => globalShortcut.unregisterAll());
