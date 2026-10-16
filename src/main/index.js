// Startbar main process. Owns the windows, the settings, the app list and
// everything that touches the Mac. Renderers only draw.
const { app, ipcMain, shell, dialog, globalShortcut, screen } = require('electron');
const { execFile, execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const settings = require('./settings');
const system = require('./system');
const apps = require('./apps');
const windows = require('./windows');
const tasks = require('./tasks');

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

function wireIpc() {
  ipcMain.handle('state', () => state());
  ipcMain.on('bar:start', () => windows.toggleMenu());
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
}

app.whenReady().then(() => {
  app.setActivationPolicy('accessory'); // no Dock icon, no app switcher entry
  settings.init();
  wireIpc();
  windows.createBar(settings.get());
  windows.createMenu(settings.get());
  registerShortcut();
  apps.load(); // warm the icon cache before the first click
  tasks.onChange((t) => windows.broadcast('tasks', t));
  tasks.start();

  settings.onChange((s) => {
    windows.layout(s);
    registerShortcut();
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
