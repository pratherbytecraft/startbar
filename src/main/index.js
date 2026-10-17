// Startbar main process. Owns the windows, the settings, the app list and
// everything that touches the Mac. Renderers only draw.
const { app, ipcMain, shell, dialog, globalShortcut, screen, Menu, nativeTheme, BrowserWindow, clipboard, powerMonitor } = require('electron');
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
const quitter = require('./quitter');
const ungrouped = require('./ungrouped');

// From the package, not app.getVersion(): Startbar.app carries no version so
// it stays the same across updates (see scripts/build-app.js).
const VERSION = require('../../package.json').version;
const { helperPath } = require('../../scripts/build-helper');
const { appPath } = require('../../scripts/build-app');

// The line that updates this copy, for the About page: Homebrew keeps what
// it installs in its Cellar folder, npm in a node_modules folder.
const UPDATE_COMMAND = /\/Cellar\/startbar\//.test(fs.realpathSync(__dirname)) ? 'brew upgrade startbar' : 'npm install -g startbar';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  // `startbar` run again while running: just bring the menu up as a sign of life.
  windows.showMenu();
});

// When Startbar opens itself to come forward (see bringForward), that's
// not a reopen from Spotlight, so no Start menu.
let selfOpenAt = 0;

app.on('activate', () => {
  if (Date.now() - selfOpenAt < 3000) {
    if (windows.settings) windows.settings.focus();
    return;
  }
  // Startbar.app opened again from Spotlight, the Start menu or `startbar`.
  if (app.isReady()) windows.showMenu();
});

// Since macOS 14 an app's own request to come forward can be turned down
// while another app is in front, which left the settings window behind
// it. Opening Startbar.app through Launch Services is allowed, as it is
// for the window helper's clicks.
function bringForward() {
  app.focus({ steal: true });
  const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
  if (!bundle.endsWith('.app')) return;
  selfOpenAt = Date.now();
  execFile('open', ['-a', bundle]);
}

function userName() {
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf8' }).trim() || os.userInfo().username;
  } catch {
    return os.userInfo().username;
  }
}

// The account picture from System Settings, as a small data URL, or '' when
// there isn't one. The directory record keeps it as image data (JPEG or
// TIFF), or only as the path of a picture file. sips turns either into a PNG.
let userPictureUrl = null;
function readRecord(key) {
  return new Promise((resolve) => {
    execFile('dscl', ['.', '-read', `/Users/${os.userInfo().username}`, key], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}
function toPng(source, dest) {
  return new Promise((resolve) => {
    execFile('sips', ['-s', 'format', 'png', '-Z', '128', source, '--out', dest], (err) => resolve(!err && fs.existsSync(dest)));
  });
}
async function userPicture() {
  if (userPictureUrl !== null) return userPictureUrl;
  userPictureUrl = '';
  const raw = path.join(settings.dataDir(), 'picture-raw');
  const png = path.join(settings.dataDir(), 'picture.png');
  try {
    const hex = (await readRecord('JPEGPhoto')).replace(/^[^\n]*\n/, '').replace(/\s+/g, '');
    let source = '';
    if (hex) {
      fs.writeFileSync(raw, Buffer.from(hex, 'hex'));
      source = raw;
    } else {
      source = (await readRecord('Picture')).replace(/^Picture:\s*/, '').trim();
    }
    if (source && (await toPng(source, png))) userPictureUrl = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
  } catch {
    userPictureUrl = '';
  }
  fs.rmSync(raw, { force: true });
  return userPictureUrl;
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
    home: os.homedir(),
    filedrawer: !!filedrawerApp(),
    updateCommand: UPDATE_COMMAND,
    swiftQuit: quitter.swiftQuitRunning(),
    // Shown greyed at the top of the Leave these apps running list.
    alwaysRunning: ['/System/Library/CoreServices/Finder.app', filedrawerApp(), appPath()].filter(Boolean)
  };
}

// Filedrawer, Prather Bytecraft's file manager, when it's installed. Looked
// up now and then, not on every redraw.
const FILEDRAWER_ID = 'com.pratherbytecraft.filedrawer';
let filedrawerSeen = { at: 0, path: null };

function filedrawerApp() {
  if (Date.now() - filedrawerSeen.at < 30 * 1000) return filedrawerSeen.path;
  const places = [path.join(os.homedir(), 'Applications', 'Filedrawer.app'), '/Applications/Filedrawer.app'];
  let found = null;
  for (const p of places) {
    try {
      const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(p, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
      if (id === FILEDRAWER_ID) {
        found = p;
        break;
      }
    } catch {
      // not there
    }
  }
  filedrawerSeen = { at: Date.now(), path: found };
  return found;
}

// Whether Filedrawer is running and opening Finder's folder windows as its
// own (its takeOverFinder setting, on unless turned off). Its settings file
// is read now and then, not on every redraw.
let takeOverSeen = { at: 0, on: false };

function filedrawerTakesFinder(apps) {
  if (!apps.some((a) => a.bundleId === FILEDRAWER_ID)) return false;
  if (Date.now() - takeOverSeen.at < 5 * 1000) return takeOverSeen.on;
  let on = true;
  try {
    const file = path.join(os.homedir(), 'Library', 'Application Support', 'Filedrawer', 'settings.json');
    on = JSON.parse(fs.readFileSync(file, 'utf8')).takeOverFinder !== false;
  } catch {
    // no settings saved yet, so it's on
  }
  takeOverSeen = { at: Date.now(), on };
  return on;
}

// A folder from the Start menu opens in Filedrawer when that's picked and
// installed, and in Finder otherwise. Apps and files open as usual.
function openFolder(p) {
  let isFolder = false;
  try {
    isFolder = fs.statSync(p).isDirectory() && !/\.(app|bundle|framework|pkg)$/i.test(p);
  } catch {
    isFolder = false;
  }
  const fd = isFolder && settings.get().openFoldersWith === 'filedrawer' ? filedrawerApp() : null;
  if (fd) return execFile('open', ['-a', fd, p], (err) => err && shell.openPath(p));
  // Finder picked, while Filedrawer may be opening folders in place of
  // Finder: ask it to leave this window alone first.
  const helper = isFolder && filedrawerApp() ? helperPath() : null;
  if (helper) execFile(helper, ['pass-finder'], () => shell.openPath(p));
  else shell.openPath(p);
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
    // A new window can show before the switch to a regular app has taken,
    // when the first ask to come forward goes nowhere, so ask again.
    win.once('ready-to-show', bringForward);
    win.on('focus', () => {
      refreshDock();
      status.send({ cmd: 'access' });
      checkScreen();
      quitter.checkSwiftQuit(pushState);
    });
  }
  bringForward();
  refreshDock();
  status.send({ cmd: 'access' });
  checkScreen();
  quitter.checkSwiftQuit(pushState);
}

// The Permissions page. Each permission is allowed, notAsked, denied, off
// (Location Services is off for the whole Mac) or null until the status
// helper reports. Accessibility comes from the window list instead.
// The icons in the Start menu's right column. The folder icons come from the
// system's own icon files, not from the folders, so drawing them never needs
// access to Documents or Downloads.
const CORE_ICONS = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/';
const STARTBAR_ICON = path.join(__dirname, '..', '..', 'assets', 'Startbar.icns');
const PLACE_ICONS = {
  applications: CORE_ICONS + 'ApplicationsFolderIcon.icns',
  documents: CORE_ICONS + 'DocumentsFolderIcon.icns',
  downloads: CORE_ICONS + 'DownloadsFolder.icns',
  home: CORE_ICONS + 'HomeFolderIcon.icns',
  folder: CORE_ICONS + 'GenericFolderIcon.icns', // added folders
  systemSettings: '/System/Applications/System Settings.app',
  settings: STARTBAR_ICON,
  update: STARTBAR_ICON,
  about: STARTBAR_ICON
};

async function placeIcons() {
  const found = await apps.icons(Object.values(PLACE_ICONS));
  return Object.fromEntries(Object.entries(PLACE_ICONS).map(([key, p]) => [key, found[p] || '']));
}

const PANES = {
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  bluetooth: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
};
let askingFor = null; // { name, at }: the permission whose macOS prompt is up
let shownPermissions = '';

// Clicks in a background window count: on with the setting, once the
// helper has Accessibility for its event tap.
function updateClickThrough() {
  tasks.setClickThrough(settings.get().taskbar.clickThrough && tasks.get().accessibility === true);
}

function permissions() {
  const a = status.get().access || {};
  // macOS only answers for System Events while it's running. Otherwise go
  // by the last answer Startbar saw.
  const automation = a.automation && a.automation !== 'unknown' ? a.automation : settings.get().automationAnswer || 'notAsked';
  return { automation, location: a.location || null, bluetooth: a.bluetooth || null, screen: screenNow };
}

// Screen Recording, for window previews. A process that's already running
// may not see a new grant, so a short helper run checks each time. macOS
// can't say whether it was asked before, so Startbar remembers.
let screenNow = null; // allowed | notAsked | denied
function checkScreen() {
  const helper = helperPath();
  if (!helper) return;
  execFile(helper, ['screen-access'], { timeout: 5000 }, (err, out) => {
    let allowed = false;
    try {
      allowed = !err && JSON.parse(out).allowed === true;
    } catch {
      allowed = false;
    }
    if (screenAfterUpdate(allowed)) return;
    const next = allowed ? 'allowed' : settings.get().screenAsked ? 'denied' : 'notAsked';
    if (next === screenNow) return;
    const granted = screenNow !== null && next === 'allowed';
    screenNow = next;
    // The window helper takes pictures, so a new one starts with the grant.
    if (granted) tasks.restart();
    permissionsChanged();
  });
}

// An update that rebuilt Startbar.app can leave the old Screen Recording
// entry in the list, switched on but no longer counting (it happened with the
// move to name based signing in 0.2.0). With previews on, when it worked under
// another build, or before builds were stamped, Startbar clears its entry and
// asks once more, the way access.js does for Accessibility.
function screenAfterUpdate(allowed) {
  const s = settings.get();
  const now = access.buildStamp();
  if (!now) return false;
  if (allowed) {
    if (s.screenStamp !== now) settings.update({ screenStamp: now });
    return false;
  }
  if (!s.taskbar.previews || !s.screenAsked || s.screenStamp === now) return false;
  settings.update({ screenStamp: now, screenAsked: false });
  screenNow = 'notAsked';
  execFile('tccutil', ['reset', 'ScreenCapture', access.BUNDLE_ID], () => askPermission('screen'));
  return true;
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
  askingFor = { name, at: Date.now() };
  if (name === 'screen') {
    settings.update({ screenAsked: true });
    tasks.send({ cmd: 'askScreen' });
    // macOS answers in System Settings, so look again for a while.
    let tries = 0;
    const look = setInterval(() => {
      checkScreen();
      if (++tries >= 30 || screenNow === 'allowed') clearInterval(look);
    }, 2000);
    return;
  }
  status.send({ cmd: name === 'location' ? 'askLocation' : 'askBluetooth' });
}

function permissionsChanged() {
  // Keep what macOS said about System Events, for when it isn't running.
  const seen = (status.get().access || {}).automation;
  if ((seen === 'allowed' || seen === 'denied') && settings.get().automationAnswer !== seen) settings.update({ automationAnswer: seen });
  const now = permissions();
  const key = JSON.stringify(now);
  if (key === shownPermissions) return;
  shownPermissions = key;
  pushState();
  // Screen Recording reads as denied as soon as it's asked, while macOS
  // still waits on System Settings, so only an allow counts as the answer.
  const answered = askingFor && (askingFor.name === 'screen' ? now.screen === 'allowed' : now[askingFor.name] !== 'notAsked');
  if (answered) {
    // Only right after the prompt. A prompt left open and answered much
    // later shouldn't pull the settings window over whatever is in front.
    const recent = Date.now() - askingFor.at < 60000;
    askingFor = null;
    if (recent) focusSettings();
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
  const saved = settings.forExport();
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
  await dockChanged(await dock.setAutohide(hide), '"Automatically hide and show the Dock"');
}

async function moveDockToBottom() {
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'question',
    message: 'Move the Dock to the bottom?',
    detail: 'Minimized windows shrink toward the Dock. With the Dock at the bottom they go down toward the bar instead of off to the side.',
    buttons: ['Move the Dock', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  });
  if (response !== 0) return;
  await dockChanged(await dock.moveToBottom(), '"Position on screen"');
}

// setting is the name of the same switch in System Settings, Desktop and Dock.
async function dockChanged(result, setting) {
  rememberAutomation(result);
  await refreshDock();
  // The first time, macOS asks for the permission, and closing its prompt
  // hands focus to the app that was in front before Startbar.
  focusSettings();
  if (result === 'ok') return;
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'warning',
    message: result === 'notAllowed' ? "Startbar isn't allowed to change the Dock" : "The Dock didn't change",
    detail: result === 'notAllowed'
      ? `Turn on System Events under Startbar in Privacy and Security, Automation, then try again. Or change ${setting} in Desktop and Dock.`
      : `Try ${setting} in System Settings, under Desktop and Dock.`,
    buttons: ['Open System Settings', 'OK'],
    defaultId: 1,
    cancelId: 1
  });
  if (response === 0) {
    shell.openExternal(result === 'notAllowed' ? PANES.automation : 'x-apple.systempreferences:com.apple.Desktop-Settings.extension');
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

const THEME_NAMES = { system: 'System', 'classic-2009': 'Classic 2009', 'classic-2001': 'Classic 2001', 'classic-1995': 'Classic 1995' };

async function resetThemeSettings() {
  const name = THEME_NAMES[settings.get().theme] || 'this theme';
  const { response } = await dialog.showMessageBox(windows.settings, {
    type: 'warning',
    message: `Reset the ${name} settings to the defaults?`,
    detail: 'The look and size of the bar go back to how they were the first time you picked this theme. The other themes keep their settings.',
    buttons: ['Reset', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  });
  if (response === 0) settings.resetTheme();
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
    detail: 'A taskbar for macOS. Free to use.\nCopyright 2026 Prather Bytecraft. All rights reserved.',
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

// Like Quick Launch: opens a new window of an app that already has one,
// raised on its own, and opens the app otherwise (which gives a running app
// with no windows its first one).
function openApp(appPath) {
  const running = tasks.get().apps.find((a) => a.path === appPath);
  if (running && running.windows.length > 0) tasks.send({ cmd: 'newWindow', pid: running.pid });
  else shell.openPath(appPath);
}

function launchApp(appPath) {
  windows.hideMenu();
  apps.noteLaunch(appPath);
  openApp(appPath);
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
function showAppMenu(appPath, fromRecent) {
  if (!windows.menu || !pins.isApp(appPath)) return;
  const items = [{ label: 'Open', click: () => launchApp(appPath) }, { type: 'separator' }, pinItem(appPath)];
  if (fromRecent) {
    items.push({
      label: 'Remove from Recent',
      click: () => {
        apps.forgetRecent(appPath);
        windows.menu.webContents.send('menu:recentChanged');
      }
    });
  }
  Menu.buildFromTemplate(items).popup({ window: windows.menu });
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

// The Add button under Leave these apps running: the running apps first,
// then any app from Applications.
function addKeepRunning(sender) {
  const listed = new Set([...settings.get().quitApps.keepRunning, ...state().alwaysRunning]);
  const running = tasks.get().apps.filter((a) => a.path && !listed.has(a.path) && !quitter.ALWAYS.has(a.bundleId));
  const items = [...new Map(running.map((a) => [a.path, a])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ label: a.name, click: () => setKeepRunning([...settings.get().quitApps.keepRunning, a.path]) }));
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: 'Choose from Applications…', click: () => chooseKeepRunning() });
  Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(sender) });
}

async function chooseKeepRunning() {
  app.focus({ steal: true }); // the picker is a sheet, which waits for Startbar to be in front
  const { canceled, filePaths } = await dialog.showOpenDialog(windows.settings, {
    title: 'Leave Apps Running',
    buttonLabel: 'Add',
    defaultPath: '/Applications',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Apps', extensions: ['app'] }]
  });
  if (!canceled) setKeepRunning([...settings.get().quitApps.keepRunning, ...filePaths]);
}

function setKeepRunning(list) {
  const clean = (Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && path.isAbsolute(p));
  settings.update({ quitApps: { keepRunning: [...new Set(clean)] } });
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
async function showTaskMenu(target, sender) {
  const app = tasks.get().apps.find((a) => a.pid === target.pid);
  if (!app) return;
  const send = (cmd, extra) => tasks.send({ cmd, ...extra });
  const items = [];
  // The app's own New Window item, when its menus have one. A slow app
  // doesn't hold the menu up for long.
  const found = await Promise.race([send('newWindowItem', { pid: app.pid }), new Promise((r) => setTimeout(() => r({ ok: false }), 500))]);
  if (found.ok && found.title) items.push({ label: found.title, click: () => send('newWindow', { pid: app.pid }) }, { type: 'separator' });
  if (target.kind === 'window') {
    const win = app.windows.find((w) => w.id === target.id);
    if (win) {
      // A window pulled out of its group can go back; a window in a group
      // (a row of the group list or a preview picture) can be pulled out.
      if (ungrouped.ids().includes(win.id)) {
        items.unshift({ label: 'Put back in the group', click: () => ungrouped.regroup(win.id) }, { type: 'separator' });
      } else if (target.inGroup) {
        items.unshift({ label: 'Give its own button', click: () => ungroupWindow(win.id) }, { type: 'separator' });
      }
      items.push(
        win.minimized
          ? { label: 'Restore', click: () => send('unminimize', { id: win.id }) }
          : { label: 'Minimize', click: () => minimize({ cmd: 'minimize', id: win.id }) },
        { label: 'Close', click: () => send('close', { id: win.id }) },
        { type: 'separator' }
      );
    }
  } else if (target.kind === 'group' && Array.isArray(target.ids)) {
    items.push(
      { label: 'Minimize All', click: () => target.ids.forEach((id) => minimize({ cmd: 'minimize', id })) },
      { label: 'Close All', click: () => target.ids.forEach((id) => send('close', { id })) },
      { type: 'separator' }
    );
  }
  if (pins.isApp(app.path)) items.push(pinItem(app.path), { type: 'separator' });
  items.push({ label: `Quit ${app.name}`, click: () => send('quitApp', { pid: app.pid }) });
  popupOnBar(Menu.buildFromTemplate(items), sender);
}

// The list or the preview the window came from closes with it.
function ungroupWindow(id) {
  windows.hideGroup();
  windows.hidePreview();
  ungrouped.ungroup(id, tasks.get());
}

// The task state the bars draw from, with the ungrouped window ids.
const taskState = () => ungrouped.withIds(tasks.get());

// A window dragged out of the group list or the preview, see
// renderer/shared/dragout.js. The bar under the pointer shows a slot for
// it; dropping there pulls the window out of its group. The tip window is
// the ghost under the cursor.
let drag = null; // { id, pid, bar }
function dragOut(d) {
  if (!d || typeof d !== 'object') return;
  const point = { x: Number(d.x) || 0, y: Number(d.y) || 0 };
  if (d.phase === 'start') {
    drag = { id: String(d.id), pid: d.pid, bar: null };
    windows.holdPreview(true);
    windows.showGhost({ text: String(d.title || ''), icon: typeof d.icon === 'string' ? d.icon : '' }, point);
  }
  if (!drag) return;
  const over = windows.barAt(point);
  if (over !== drag.bar) {
    if (drag.bar && !drag.bar.isDestroyed()) drag.bar.webContents.send('tasks:dragOver', null);
    drag.bar = over;
    if (over) over.webContents.send('tasks:dragOver', { pid: drag.pid });
  }
  if (d.phase === 'move') return windows.moveGhost(point);
  if (d.phase !== 'drop' && d.phase !== 'cancel') return;
  const { id, bar } = drag;
  drag = null;
  if (bar && !bar.isDestroyed()) bar.webContents.send('tasks:dragOver', null);
  windows.hideTip();
  windows.holdPreview(false);
  if (bar && d.phase === 'drop') ungroupWindow(id);
}

// Window pictures for the hover previews, from the window helper. A fresh
// one is taken after a few seconds; until then the kept one is shown, so
// moving back and forth between buttons is quick. A minimized window can't
// be pictured, so it shows the last one taken, and Startbar takes one
// right before it minimizes a window itself.
const PREVIEW_SIZE = { width: 190, height: 120 };
const pictures = new Map(); // window id -> { image, at }
function takePicture(id) {
  return tasks.send({ cmd: 'thumb', id, ...PREVIEW_SIZE }).then((reply) => {
    if (!reply.ok || !reply.image) return null;
    pictures.delete(id);
    pictures.set(id, { image: reply.image, at: Date.now() });
    if (pictures.size > 60) pictures.delete(pictures.keys().next().value);
    return reply.image;
  });
}
async function minimize(command) {
  if (settings.get().taskbar.previews && screenNow === 'allowed') {
    await Promise.race([takePicture(command.id), new Promise((r) => setTimeout(r, 400))]);
  }
  return tasks.send(command);
}
function showPreview(payload, sender) {
  const bar = windows.barOf(sender);
  windows.showPreview(payload, bar);
  takePictures(payload);
}

// A click on a group with previews on: the pictures open and stay until a
// click elsewhere, which the helper reports while they're up. A click on
// the pictures or on their button is theirs to handle.
function pinPreview(payload, sender) {
  const bar = windows.barOf(sender);
  if (!windows.pinPreview(payload, bar)) return;
  takePictures(payload);
  tasks.setWatchClicks(true);
}

function takePictures(payload) {
  if (screenNow !== 'allowed') return;
  for (const w of payload.windows) {
    const kept = pictures.get(w.id);
    if (kept) windows.sendPreview('preview:image', { id: w.id, image: kept.image, minimized: w.minimized });
    if (w.minimized || (kept && Date.now() - kept.at < 3000)) continue;
    takePicture(w.id).then((image) => image && windows.sendPreview('preview:image', { id: w.id, image }));
  }
}

// Resting on a picture in a preview shows that window alone; moving off,
// or the pictures going away, puts the window that was in front back.
let peeking = false;
function peek(id) {
  if (id && settings.get().taskbar.peek) {
    peeking = true;
    tasks.send({ cmd: 'peek', id });
  } else if (peeking) {
    peeking = false;
    tasks.send({ cmd: 'unpeek' });
  }
}

function wireIpc() {
  ipcMain.on('preview:show', (e, payload) => showPreview(payload, e.sender));
  ipcMain.on('preview:peek', (_e, id) => peek(id));
  ipcMain.on('preview:pin', (e, payload) => pinPreview(payload, e.sender));
  ipcMain.on('preview:size', (_e, size) => windows.sizePreview(size));
  ipcMain.on('preview:leave', () => windows.leavePreview());
  ipcMain.on('preview:hover', (_e, on) => windows.hoverPreview(on));
  ipcMain.on('preview:hide', () => windows.hidePreview());
  ipcMain.handle('state', () => state());
  ipcMain.on('bar:start', (e) => windows.toggleMenu(windows.barOf(e.sender)));
  ipcMain.on('bar:menu', (e) => showBarMenu(e.sender));
  ipcMain.on('menu:hide', () => windows.hideMenu());
  ipcMain.handle('menu:apps', () => apps.load());
  ipcMain.handle('menu:recent', () => (settings.get().startMenu.showRecent ? apps.recent(settings.get().startMenu.recentCount) : []));
  ipcMain.on('menu:launch', (_e, appPath) => launchApp(appPath));
  ipcMain.on('menu:appMenu', (_e, appPath, fromRecent) => showAppMenu(appPath, !!fromRecent));
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
    if (places[target]) openFolder(places[target]);
  });
  ipcMain.handle('menu:files', (_e, q) => searchFiles(q));
  ipcMain.handle('menu:placeIcons', () => placeIcons());
  ipcMain.handle('menu:userPicture', () => userPicture());
  ipcMain.on('menu:openFile', (_e, file) => {
    if (typeof file !== 'string' || !file.startsWith(os.homedir() + path.sep)) return;
    windows.hideMenu();
    openFolder(file);
  });
  ipcMain.on('menu:openFolder', (_e, folder) => {
    if (!settings.get().startMenu.folders.includes(folder)) return;
    windows.hideMenu();
    openFolder(folder);
  });
  ipcMain.on('menu:power', (_e, action) => {
    windows.hideMenu();
    runPower(action);
  });
  ipcMain.handle('settings:update', (_e, patch) => settings.update(patch));
  ipcMain.on('settings:reset', () => resetSettings());
  ipcMain.on('settings:resetTheme', () => resetThemeSettings());
  ipcMain.on('settings:link', (_e, name) => {
    const links = {
      kofi: 'https://ko-fi.com/prathercc',
      issues: 'https://github.com/pratherbytecraft/startbar/issues'
    };
    if (links[name]) shell.openExternal(links[name]);
  });
  ipcMain.on('access:ask', (_e, name) => askPermission(name));
  ipcMain.on('pins:launch', (_e, appPath) => {
    if (pins.has(appPath)) openApp(appPath);
  });
  ipcMain.on('pins:menu', (e, appPath) => showPinMenu(appPath, e.sender));
  ipcMain.on('pins:set', (_e, list) => pins.set(list));
  ipcMain.on('pins:remove', (_e, appPath) => pins.remove(appPath));
  ipcMain.on('pins:add', () => addPins());
  ipcMain.on('dock:hidden', (_e, hide) => setDockHidden(!!hide));
  ipcMain.on('dock:bottom', () => moveDockToBottom());
  ipcMain.on('folders:add', () => addFolders());
  ipcMain.on('login:set', (_e, on) => setLoginItem(on));
  ipcMain.on('updates:check', () => updates.check(VERSION));
  ipcMain.on('clipboard:text', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.on('settings:export', () => exportSettings());
  ipcMain.on('settings:import', () => importSettings());
  ipcMain.on('folders:set', (_e, list) => setFolders(list));
  ipcMain.on('keepRunning:add', (e) => addKeepRunning(e.sender));
  ipcMain.on('keepRunning:set', (_e, list) => setKeepRunning(list));
  // The shortcut field records keys, so the global shortcut steps aside.
  ipcMain.on('shortcut:pause', () => globalShortcut.unregisterAll());
  ipcMain.on('shortcut:resume', () => {
    registerShortcut();
    pushState();
  });
  ipcMain.handle('tasks:get', () => taskState());
  ipcMain.on('tasks:ungroup', (_e, id) => ungroupWindow(String(id)));
  ipcMain.on('tasks:regroup', (_e, id) => ungrouped.regroup(String(id)));
  ipcMain.on('tasks:dragOut', (_e, d) => dragOut(d));
  ipcMain.on('tasks:putAllBack', () => ungrouped.putAllBack());
  ipcMain.handle('tasks:command', (_e, command) => (command && command.cmd === 'minimize' ? minimize(command) : tasks.send(command)));
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
  windows.createPreview(settings.get());
  registerShortcut();
  updateTray();
  windows.onBarVisibility(() => {
    updateTray();
    updateKeepOff();
  });
  apps.load(); // warm the icon cache before the first click
  tasks.onChange((t) => {
    windows.setFullScreenDisplays(fullScreenDisplays(t));
    windows.broadcast('tasks', ungrouped.withIds(t));
    access.check(t, { restartHelper: tasks.restart });
    updateClickThrough();
  });
  ungrouped.onChange(() => windows.broadcast('tasks', taskState()));
  windows.onPreviewUnpinned(() => tasks.setWatchClicks(false));
  windows.onPreviewHidden(() => peek(null));
  tasks.onClick((point) => {
    if (windows.previewPinned() && !windows.previewHit(point)) windows.hidePreview();
  });
  updateKeepOff();
  tasks.setSpaces(settings.get().spaces.show === 'all');
  tasks.setHoldFinder(filedrawerTakesFinder);
  quitter.start();
  powerMonitor.on('lock-screen', () => quitter.setLocked(true));
  powerMonitor.on('unlock-screen', () => quitter.setLocked(false));
  tasks.start();
  status.onChange((s) => {
    windows.broadcast('status', s);
    permissionsChanged();
  });
  status.start();
  checkScreen();
  // A new install opens at login, the way a taskbar should. The switch on
  // the General page turns it off. Saving makes it a one time thing.
  if (settings.firstRun()) {
    setLoginItem(true);
    settings.update({});
  }

  let previewsWere = settings.get().taskbar.previews;
  settings.onChange((s) => {
    // Turning previews on asks for Screen Recording, the first time.
    if (s.taskbar.previews && !previewsWere && screenNow === 'notAsked') askPermission('screen');
    previewsWere = s.taskbar.previews;
    tasks.setSpaces(s.spaces.show === 'all');
    updateClickThrough();
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
