// Startbar main process. Owns the windows, the settings, the app list and
// everything that touches the Mac. Renderers only draw.
const { app, ipcMain, shell, dialog, globalShortcut, screen, Menu } = require('electron');
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

function state() {
  return {
    settings: settings.get(),
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
  const combo = settings.get().startMenu.shortcut;
  if (!combo) return;
  try {
    const ok = globalShortcut.register(combo, () => windows.toggleMenu());
    if (!ok) console.log(`Startbar: the shortcut ${combo} is taken by another app.`);
  } catch (err) {
    console.log(`Startbar: could not register ${combo}: ${err.message}`);
  }
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

function updateTray() {
  tray.update(settings.get().menuBarIcon, {
    hidden: windows.barHidden,
    toggleBar,
    openMenu: () => windows.showMenu(),
    about: () => showAbout(),
    quit: () => app.quit()
  });
}

// Right click on an empty part of the bar. Kept short: everything else lives
// in the settings window. Allow Window Buttons stays here while the permission
// is off until the settings window has its Accessibility row.
function showBarMenu() {
  if (!windows.bar) return;
  const items = [{ label: 'Hide the Bar', click: () => hideBar() }];
  if (tasks.get().accessibility === false) {
    items.push({ label: 'Allow Window Buttons…', click: () => access.ask() });
  }
  items.push(
    { label: 'Startbar Settings', enabled: false }, // slice 3
    { type: 'separator' },
    { label: 'Quit Startbar', click: () => app.quit() }
  );
  Menu.buildFromTemplate(items).popup({ window: windows.bar });
}

// The menu bar while one of Startbar's windows has focus (the Start menu, a
// group list, a dialog). Replaces Electron's default File, View, Window and
// Help menus. Edit stays so copy and paste work in the search box.
function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Startbar',
      submenu: [
        { label: 'About Startbar', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Hide the Bar', click: () => hideBar() },
        { label: 'Quit Startbar', click: () => app.quit() }
      ]
    },
    { role: 'editMenu' }
  ]));
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
  items.push({ label: `Quit ${app.name}`, click: () => send('quitApp', { pid: app.pid }) });
  Menu.buildFromTemplate(items).popup({ window: windows.bar });
}

function wireIpc() {
  ipcMain.handle('state', () => state());
  ipcMain.on('bar:start', () => windows.toggleMenu());
  ipcMain.on('bar:menu', () => showBarMenu());
  ipcMain.on('menu:hide', () => windows.hideMenu());
  ipcMain.handle('menu:apps', () => apps.load());
  ipcMain.handle('menu:recent', () => apps.recent(settings.get().startMenu.recentCount));
  ipcMain.on('menu:launch', (_e, appPath) => {
    windows.hideMenu();
    apps.noteLaunch(appPath);
    shell.openPath(appPath);
  });
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
    if (target === 'settings') return; // slice 3
    if (places[target]) shell.openPath(places[target]);
  });
  ipcMain.on('menu:power', (_e, action) => {
    windows.hideMenu();
    runPower(action);
  });
  ipcMain.handle('settings:update', (_e, patch) => settings.update(patch));
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
  setAppMenu();
  wireIpc();
  windows.createBar(settings.get());
  windows.createMenu(settings.get());
  windows.createTip();
  windows.createGroup(settings.get());
  registerShortcut();
  updateTray();
  windows.onBarVisibility(updateTray);
  apps.load(); // warm the icon cache before the first click
  tasks.onChange((t) => {
    windows.broadcast('tasks', t);
    access.check(t);
  });
  tasks.start();

  settings.onChange((s) => {
    windows.layout(s);
    registerShortcut();
    updateTray();
    pushState();
  });
  system.watch(pushState);
  screen.on('display-metrics-changed', () => windows.layout(settings.get()));
  screen.on('display-added', () => windows.layout(settings.get()));
  screen.on('display-removed', () => windows.layout(settings.get()));
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => tasks.stop());
app.on('will-quit', () => globalShortcut.unregisterAll());
