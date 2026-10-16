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
// The bundle holds no Startbar code and no version number.
// Contents/Resources/app is a two file stub that loads src/main from the
// installed package, so an update to the package is picked up as is.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUNDLE_ID = 'com.pratherbytecraft.startbar';
const root = path.join(__dirname, '..');
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

// The package a built bundle points at, or null when it isn't one of ours.
function bundleTarget(bundle) {
  try {
    if (plistValue(bundle, 'CFBundleIdentifier') !== BUNDLE_ID) return null;
    const stub = JSON.parse(fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
    return stub.startbarPackage || null;
  } catch {
    return null;
  }
}

// The Startbar.app built for this package, or null when there isn't one.
function appPath() {
  for (const bundle of [userBundle, localBundle]) {
    if (bundleTarget(bundle) === root) return bundle;
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
    startbarPackage: root
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
