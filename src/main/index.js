// Startbar main process. Owns the windows, the settings, the app list and
// everything that touches the Mac. Renderers only draw.
const { app, ipcMain, shell, dialog, globalShortcut, screen, Menu, nativeTheme, BrowserWindow } = require('electron');
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
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
const files = require('./files');
const updates = require('./updates');
const status = require('./status');

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
    permissions: permissions(),
    loginItem: loginItem(),
    update: updates.get(),
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
function openSettings(page) {
  windows.hideMenu();
  app.setActivationPolicy('regular');
  const fresh = !windows.settings;
  const win = windows.showSettings(() => app.setActivationPolicy('accessory'), typeof page === 'string' ? page : undefined);
  // The Dock, the login item and the permissions may have changed in System Settings.
  if (fresh) {
    win.on('focus', () => {
      refreshDock();
      status.send({ cmd: 'access' });
    });
  }
  app.focus({ steal: true });
  refreshDock();
  status.send({ cmd: 'access' });
}

// The Permissions page. Each permission is allowed, notAsked, denied, off
// (Location Services is off for the whole Mac) or null until the status
// helper reports. Accessibility comes from the window list instead.
const PANES = {
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  bluetooth: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth'
};
let askingFor = null; // the permission whose macOS prompt is up
let shownPermissions = '';

function permissions() {
  const a = status.get().access || {};
  // macOS only answers for System Events while it's running. Otherwise go
  // by the last answer Startbar saw.
  const automation = a.automation && a.automation !== 'unknown' ? a.automation : settings.get().automationAnswer || 'notAsked';
  return { automation, location: a.location || null, bluetooth: a.bluetooth || null };
}

function rememberAutomation(result) {
  if (result === 'ok') settings.update({ automationAnswer: 'allowed' });
  if (result === 'notAllowed') settings.update({ automationAnswer: 'denied' });
  status.send({ cmd: 'access' });
}

// Closing a macOS prompt hands focus to the app that was in front before.
function focusSettings() {
  if (!windows.settings) return;
  app.focus({ steal: true });
  windows.settings.focus();
}

async function askPermission(name) {
  if (name === 'accessibility') return access.openPane();
  const now = permissions()[name];
  if (!PANES[name] || now === 'allowed') return;
  if (now === 'denied' || now === 'off') return shell.openExternal(PANES[name]);
  if (name === 'automation') {
    rememberAutomation(await dock.askAutomation());
    focusSettings();
    return;
  }
  askingFor = name;
  status.send({ cmd: name === 'location' ? 'askLocation' : 'askBluetooth' });
}

function permissionsChanged() {
  const now = permissions();
  const key = JSON.stringify(now);
  if (key === shownPermissions) return;
  shownPermissions = key;
  pushState();
  if (askingFor && now[askingFor] !== 'notAsked') {
    askingFor = null;
    focusSettings();
  }
}

// Open at login, through macOS's own login items. The switch shows what
// macOS has, so a change made in System Settings shows here too.
function loginItem() {
  try {
    const { status } = app.getLoginItemSettings({ type: 'mainAppService' });
    return { on: status === 'enabled' || status === 'requires-approval', needsApproval: status === 'requires-approval' };
  } catch {
    return { on: false, needsApproval: false };
  }
}

function setLoginItem(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, type: 'mainAppService' });
  } catch (err) {
    console.log(`Startbar: could not change the login item: ${err.message}`);
  }
  pushState();
}

// Settings and pins to a file and back. The one time dialogs aren't part of it.
async function exportSettings() {
  app.focus({ steal: true });
  const { canceled, filePath } = await dialog.showSaveDialog(windows.settings, {
    title: 'Export Settings and Pins',
    buttonLabel: 'Export',
    defaultPath: path.join(os.homedir(), 'Documents', 'Startbar Settings.json'),
    filters: [{ name: 'Startbar settings', extensions: ['json'] }]
  });
  if (canceled || !filePath) return;
  const { accessibilityAsked, hideNoteShown, automationAnswer, ...saved } = settings.get();
  fs.writeFileSync(filePath, JSON.stringify({ startbar: VERSION, settings: saved, pins: pins.get() }, null, 2) + '\n');
}

async function importSettings() {
  app.focus({ steal: true });
  const { canceled, filePaths } = await dialog.showOpenDialog(windows.settings, {
    title: 'Import Settings and Pins',
    buttonLabel: 'Import',
    defaultPath: path.join(os.homedir(), 'Documents'),
    properties: ['openFile'],
    filters: [{ name: 'Startbar settings', extensions: ['json'] }]
  });
  if (canceled || !filePaths.length) return;
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch {
    data = null;
  }
  if (!data || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    await dialog.showMessageBox(windows.settings, {
      type: 'warning',
      message: "That file isn't a Startbar settings file",
      detail: 'Pick a file made with Export on this page.',
      buttons: ['OK']
    });
    return;
  }
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'warning',
    message: 'Replace your settings and pins?',
    detail: 'Every page here and the pinned apps will match the file. Export first if you want to keep what you have now.',
    buttons: ['Replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  });
  if (response !== 0) return;
  settings.replace(data.settings);
  if (Array.isArray(data.pins)) pins.set(data.pins);
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
  rememberAutomation(result);
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

// Tells the helper where the bars are so it can move windows up off them.
// Not while the bars hide themselves, since then windows can use the whole
// screen.
function updateKeepOff() {
  const t = settings.get().taskbar;
  if (windows.barHidden || t.autoHide || !t.moveWindowsUp) return tasks.setKeepOff([]);
  tasks.setKeepOff(windows.barAreas().map(({ top, bottom, screen: b }) => ({
    top,
    bottom,
    screen: { x: b.x, y: b.y, w: b.width, h: b.height }
  })));
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

// The displays with a full screen window in front, by id. The bar there
// steps aside unless the setting says otherwise.
function fullScreenDisplays(t) {
  const ids = new Set();
  for (const a of t.apps) {
    for (const w of a.windows) {
      if (w.fullScreen && w.onScreen) ids.add(screen.getDisplayNearestPoint({ x: w.x + w.w / 2, y: w.y + w.h / 2 }).id);
    }
  }
  return [...ids];
}

// Menus that open from a bar keep it up (with auto hide on) until they
// close. A menu from another window, the group list for one, opens there.
function popupOnBar(menu, sender) {
  const barWin = sender ? windows.barOf(sender) : windows.bar;
  const win = barWin || (sender && BrowserWindow.fromWebContents(sender)) || windows.bar;
  if (!win) return;
  menu.popup({ window: win, callback: windows.holdBar(barWin) });
}

// Right click on an empty part of the bar. Kept short: everything else lives
// in the settings window.
function showBarMenu(sender) {
  popupOnBar(Menu.buildFromTemplate([
    { label: 'Hide the Bar', click: () => hideBar() },
    { label: 'Startbar Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit Startbar', click: () => app.quit() }
  ]), sender);
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
function showPinMenu(appPath, sender) {
  if (!pins.has(appPath)) return;
  popupOnBar(Menu.buildFromTemplate([pinItem(appPath)]), sender);
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

// Folders added to the Start menu's right column.
async function addFolders() {
  app.focus({ steal: true }); // the picker is a sheet, which waits for Startbar to be in front
  const { canceled, filePaths } = await dialog.showOpenDialog(windows.settings, {
    title: 'Add Folders to the Start Menu',
    buttonLabel: 'Add',
    defaultPath: os.homedir(),
    properties: ['openDirectory', 'multiSelections']
  });
  if (canceled) return;
  setFolders([...settings.get().startMenu.folders, ...filePaths]);
}

function setFolders(list) {
  const clean = (Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && path.isAbsolute(p));
  settings.update({ startMenu: { folders: [...new Set(clean)] } });
}

// Files from the home folder for the Start menu search, with icons.
async function searchFiles(q) {
  if (settings.get().startMenu.search !== 'files') return [];
  const found = await files.search(q);
  const icons = await apps.icons(found.map((f) => f.path));
  return found.map((f) => ({ ...f, icon: icons[f.path] || '' }));
}

async function addPins() {
  app.focus({ steal: true }); // the picker is a sheet, which waits for Startbar to be in front
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
function showTaskMenu(target, sender) {
  const app = tasks.get().apps.find((a) => a.pid === target.pid);
  if (!app) return;
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
  popupOnBar(Menu.buildFromTemplate(items), sender);
}

function wireIpc() {
  ipcMain.handle('state', () => state());
  ipcMain.on('bar:start', (e) => windows.toggleMenu(windows.barOf(e.sender)));
  ipcMain.on('bar:menu', (e) => showBarMenu(e.sender));
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
    if (target === 'update') return openSettings('about');
    if (target === 'settings') return openSettings();
    if (places[target]) shell.openPath(places[target]);
  });
  ipcMain.handle('menu:files', (_e, q) => searchFiles(q));
  ipcMain.on('menu:openFile', (_e, file) => {
    if (typeof file !== 'string' || !file.startsWith(os.homedir() + path.sep)) return;
    windows.hideMenu();
    shell.openPath(file);
  });
  ipcMain.on('menu:openFolder', (_e, folder) => {
    if (!settings.get().startMenu.folders.includes(folder)) return;
    windows.hideMenu();
    shell.openPath(folder);
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
  ipcMain.on('access:ask', (_e, name) => askPermission(name));
  ipcMain.on('pins:launch', (_e, appPath) => {
    if (pins.has(appPath)) shell.openPath(appPath);
  });
  ipcMain.on('pins:menu', (e, appPath) => showPinMenu(appPath, e.sender));
  ipcMain.on('pins:set', (_e, list) => pins.set(list));
  ipcMain.on('pins:remove', (_e, appPath) => pins.remove(appPath));
  ipcMain.on('pins:add', () => addPins());
  ipcMain.on('dock:hidden', (_e, hide) => setDockHidden(!!hide));
  ipcMain.on('folders:add', () => addFolders());
  ipcMain.on('login:set', (_e, on) => setLoginItem(on));
  ipcMain.on('updates:check', () => updates.check(VERSION));
  ipcMain.on('settings:export', () => exportSettings());
  ipcMain.on('settings:import', () => importSettings());
  ipcMain.on('folders:set', (_e, list) => setFolders(list));
  // The shortcut field records keys, so the global shortcut steps aside.
  ipcMain.on('shortcut:pause', () => globalShortcut.unregisterAll());
  ipcMain.on('shortcut:resume', () => {
    registerShortcut();
    pushState();
  });
  ipcMain.handle('tasks:get', () => tasks.get());
  ipcMain.handle('tasks:command', (_e, command) => tasks.send(command));
  ipcMain.handle('tasks:icons', (_e, paths) => apps.icons(Array.isArray(paths) ? paths : []));
  ipcMain.on('tasks:menu', (e, target) => showTaskMenu(target || {}, e.sender));
  ipcMain.on('tip:show', (e, { text, rect }) => windows.showTip(String(text), rect, windows.barOf(e.sender)));
  ipcMain.on('tip:size', (_e, size) => windows.sizeTip(size));
  ipcMain.on('tip:hide', () => windows.hideTip());
  ipcMain.on('group:show', (e, payload) => windows.showGroup(payload, windows.barOf(e.sender)));
  ipcMain.on('group:size', (_e, size) => windows.sizeGroup(size));
  ipcMain.on('group:hide', () => windows.hideGroup());
  ipcMain.on('clock:click', (e, rect) => {
    const action = settings.get().clock.click;
    if (action === 'calendar') windows.toggleCalendar(rect, windows.barOf(e.sender));
    else if (action === 'app') shell.openPath('/System/Applications/Calendar.app');
  });
  ipcMain.on('calendar:size', (_e, size) => windows.sizeCalendar(size));
  ipcMain.handle('status:get', () => status.get());
  ipcMain.on('tray:click', (e, { kind, rect }) => {
    if (['volume', 'wifi', 'battery', 'bluetooth'].includes(kind)) windows.togglePopover(kind, rect, windows.barOf(e.sender));
  });
  ipcMain.on('tray:command', (_e, command) => {
    if (!command) return;
    if (command.cmd === 'setVolume') status.send({ cmd: 'setVolume', level: Math.max(0, Math.min(1, Number(command.level) || 0)) });
    if (command.cmd === 'setMuted') status.send({ cmd: 'setMuted', muted: !!command.muted });
    if (command.cmd === 'setWifi') status.send({ cmd: 'setWifi', on: !!command.on });
    if (command.cmd === 'setBluetooth') status.send({ cmd: 'setBluetooth', on: !!command.on });
    if (command.cmd === 'setConnected' && /^[0-9a-f]{2}([-:][0-9a-f]{2}){5}$/i.test(command.address)) {
      status.send({ cmd: 'setConnected', address: command.address, on: !!command.on });
    }
  });
  ipcMain.on('tray:settings', (_e, name) => {
    const panes = {
      volume: 'x-apple.systempreferences:com.apple.Sound-Settings.extension',
      wifi: 'x-apple.systempreferences:com.apple.wifi-settings-extension',
      battery: 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
      bluetooth: 'x-apple.systempreferences:com.apple.BluetoothSettings'
    };
    if (!panes[name]) return;
    windows.hidePopover();
    shell.openExternal(panes[name]);
  });
  ipcMain.on('popover:size', (_e, size) => windows.sizePopover(size));
  ipcMain.on('popover:hide', () => windows.hidePopover());
  ipcMain.on('calendar:hide', () => windows.hideCalendar());
}

app.whenReady().then(() => {
  app.setActivationPolicy('accessory'); // no Dock icon, no app switcher entry
  settings.init();
  applyAppearance();
  setAppMenu();
  wireIpc();
  windows.createBars(settings.get());
  windows.createMenu(settings.get());
  windows.createTip();
  windows.createGroup(settings.get());
  windows.createCalendar(settings.get());
  windows.createPopover(settings.get());
  registerShortcut();
  updateTray();
  windows.onBarVisibility(() => {
    updateTray();
    updateKeepOff();
  });
  apps.load(); // warm the icon cache before the first click
  tasks.onChange((t) => {
    windows.setFullScreenDisplays(fullScreenDisplays(t));
    windows.broadcast('tasks', t);
    access.check(t);
  });
  updateKeepOff();
  tasks.setSpaces(settings.get().spaces.show === 'all');
  tasks.start();
  status.onChange((s) => {
    windows.broadcast('status', s);
    permissionsChanged();
  });
  status.start();

  settings.onChange((s) => {
    tasks.setSpaces(s.spaces.show === 'all');
    applyAppearance();
    windows.layout(s);
    registerShortcut();
    updateTray();
    updateKeepOff();
    pushState();
  });
  pins.onChange(pushState);
  updates.onChange(pushState);
  updates.schedule(VERSION, () => settings.get().updates.auto);
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
app.on('will-quit', () => status.stop());
app.on('will-quit', () => globalShortcut.unregisterAll());
