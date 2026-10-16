// Builds Startbar.app at install time from Electron's own app bundle.
//
// Why: macOS lists an app under its bundle name in the Accessibility list,
// so without this the permission entry would say Electron. A real app bundle
// also lets Spotlight and the Start menu open Startbar again after a quit.
//
// The bundle goes to ~/Applications/Startbar.app. It is an APFS clone of
// Electron.app, so it takes no extra disk space. Spotlight does not index
// symlinks, which is why it is a copy and not a link. If ~/Applications can't
// be used, the bundle is built inside the package instead.
//
// The bundle holds no Startbar code and no version number, only a stamp of
// what it was built from (see bundleStamp).
// Contents/Resources/app is a two file stub that loads src/main from the
// installed package, so an update to the package is picked up as is.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUNDLE_ID = 'com.pratherbytecraft.startbar';

// Homebrew keeps each version in its own Cellar folder and links the current
// one at opt/startbar. The bundle points at the opt path, so it stays the
// same across brew upgrades and macOS keeps its Accessibility permission.
function stableRoot(dir) {
  const m = dir.match(/^(.*)\/Cellar\/startbar\/[^/]+\/(.*)$/);
  if (!m) return dir;
  const opt = `${m[1]}/opt/startbar/${m[2]}`;
  return fs.existsSync(opt) ? opt : dir;
}

const root = stableRoot(path.join(__dirname, '..'));
const mainScript = path.join(root, 'src', 'main', 'index.js');

const userBundle = path.join(os.homedir(), 'Applications', 'Startbar.app');
const localBundle = path.join(root, 'bundle', 'Startbar.app');

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout;
}

function plistValue(bundle, key) {
  const res = spawnSync('plutil', ['-extract', key, 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], {
    encoding: 'utf8'
  });
  return res.status === 0 ? res.stdout.trim() : null;
}

// What goes into the bundle besides the stub: the icon, this script and
// Electron. When one of them changes the bundle is built again, which a
// Homebrew upgrade would otherwise skip (the bundle's path stays the same).
function bundleStamp() {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(root, 'assets', 'Startbar.icns')));
  hash.update(fs.readFileSync(__filename));
  try {
    hash.update(require('electron/package.json').version);
  } catch {
    // no Electron yet, the build fixes that first
  }
  return hash.digest('hex').slice(0, 16);
}

// The stub a built bundle carries, or null when it isn't one of ours.
function bundleStub(bundle) {
  try {
    if (plistValue(bundle, 'CFBundleIdentifier') !== BUNDLE_ID) return null;
    return JSON.parse(fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// The Startbar.app built for this package, or null when there isn't one or
// it was built from an older icon, script or Electron.
function appPath() {
  for (const bundle of [userBundle, localBundle]) {
    const stub = bundleStub(bundle);
    if (stub && stub.startbarPackage === root && stub.bundleStamp === bundleStamp()) return bundle;
  }
  return null;
}

function electronApp() {
  // require('electron') from Node gives the path to Electron.app/Contents/MacOS/Electron.
  return path.resolve(require('electron'), '..', '..', '..');
}

function pickDest() {
  // Never replace a Startbar.app that isn't ours.
  if (fs.existsSync(userBundle) && plistValue(userBundle, 'CFBundleIdentifier') !== BUNDLE_ID) return localBundle;
  try {
    fs.mkdirSync(path.dirname(userBundle), { recursive: true });
    fs.accessSync(path.dirname(userBundle), fs.constants.W_OK);
    return userBundle;
  } catch {
    return localBundle;
  }
}

function writeStub(dest) {
  const stubDir = path.join(dest, 'Contents', 'Resources', 'app');
  fs.mkdirSync(stubDir, { recursive: true });
  const stubPkg = {
    name: 'startbar',
    productName: 'Startbar',
    private: true,
    main: 'index.js',
    startbarPackage: root,
    bundleStamp: bundleStamp()
  };
  fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify(stubPkg, null, 2) + '\n');
  fs.writeFileSync(
    path.join(stubDir, 'index.js'),
    `// Written by startbar/scripts/build-app.js. Loads Startbar from the installed package.
const fs = require('fs');
const target = ${JSON.stringify(mainScript)};
if (fs.existsSync(target)) {
  require(target);
} else {
  const { app, dialog } = require('electron');
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      message: 'Startbar is not installed anymore.',
      detail: 'Run npm install -g startbar in Terminal to install it again, or move this app to the Trash.'
    });
    app.quit();
  });
}
`
  );
}

function setPlist(dest) {
  const plist = path.join(dest, 'Contents', 'Info.plist');
  const set = (key, type, value) => run('plutil', ['-replace', key, `-${type}`, String(value), plist]);
  set('CFBundleName', 'string', 'Startbar');
  set('CFBundleDisplayName', 'string', 'Startbar');
  set('CFBundleIdentifier', 'string', BUNDLE_ID);
  set('CFBundleIconFile', 'string', 'Startbar.icns');
  set('LSApplicationCategoryType', 'string', 'public.app-category.utilities');
  set('LSUIElement', 'bool', 'true'); // no Dock icon, not even for a moment at launch
  set('NSHumanReadableCopyright', 'string', 'Prather Bytecraft. All rights reserved.');
  // Bluetooth belongs to Startbar.app even when the status helper asks, since
  // Startbar started it. macOS stops any process that touches Bluetooth
  // without this line in the app's Info.plist.
  set('NSBluetoothAlwaysUsageDescription', 'string', 'Startbar shows your Bluetooth devices and their battery in the tray.');
  // Electron asks for the other usage strings by default and Startbar uses
  // none of them. The version keys go too: the bundle stays the same from one
  // Startbar version to the next, so macOS keeps the Accessibility permission
  // across updates. Startbar reads its version from the package instead.
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription',
    'NSBluetoothPeripheralUsageDescription']) {
    spawnSync('plutil', ['-remove', key, plist]);
  }
}

function build({ quiet = false } = {}) {
  if (process.platform !== 'darwin') return null;
  const log = (msg) => quiet || console.log(msg);
  let dest = pickDest();
  try {
    const src = electronApp();
    if (!fs.existsSync(src)) throw new Error(`Electron.app was not found at ${src}`);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // -c clones on APFS. Other file systems get a plain copy.
    if (spawnSync('cp', ['-cR', src, dest]).status !== 0) run('cp', ['-R', src, dest]);
    fs.copyFileSync(path.join(root, 'assets', 'Startbar.icns'), path.join(dest, 'Contents', 'Resources', 'Startbar.icns'));
    setPlist(dest);
    writeStub(dest);
    run('codesign', ['--force', '--deep', '--sign', '-', dest]);
    // macOS ties Accessibility and the other permissions to an ad hoc app's
    // exact signature, so any change to the bundle (a new icon) would ask
    // again. Naming the bundle id instead keeps them across updates. Only the
    // outer bundle gets the rule; the Electron helpers inside keep their own.
    run('codesign', ['--force', '--sign', '-', `-r=designated => identifier "${BUNDLE_ID}"`, dest]);
    // Tell Spotlight and Launch Services about the new bundle right away.
    spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', dest]);
    log(`Startbar: app built at ${dest}`);
    return dest;
  } catch (err) {
    log(`Startbar: the app bundle was not built, Startbar will run as Electron.\n${err.message}`);
    return null;
  }
}

if (require.main === module) build();

module.exports = { build, appPath, BUNDLE_ID };
