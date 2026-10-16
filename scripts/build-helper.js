// Compiles the Swift helper at install time. If swiftc is missing the install
// still succeeds and Startbar runs in a reduced way (icons from Electron,
// no window buttons), with a note in the log on how to get the full set.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'helper', 'startbar-helper.swift');
const out = path.join(root, 'helper', 'startbar-helper');
// macOS gives the Location permission, which the Wi-Fi name needs, to the
// app bundle a process runs from, not to the app that started it. So the
// tray's status helper runs from a small bundle of its own. The .noindex
// folder keeps Spotlight from listing it as a second Startbar.
const statusApp = path.join(root, 'helper', 'status.noindex', 'Startbar.app');
const statusBin = path.join(statusApp, 'Contents', 'MacOS', 'startbar-helper');

function helperPath() {
  return fs.existsSync(out) ? out : null;
}

function statusHelperPath() {
  return fs.existsSync(statusBin) ? statusBin : helperPath();
}

const STATUS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.pratherbytecraft.startbar.status</string>
  <key>CFBundleName</key><string>Startbar</string>
  <key>CFBundleDisplayName</key><string>Startbar</string>
  <key>CFBundleExecutable</key><string>startbar-helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Startbar.icns</string>
  <key>LSUIElement</key><true/>
  <key>NSLocationUsageDescription</key><string>Startbar shows the name of your Wi-Fi network in the tray. macOS counts the network name as location.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Startbar shows the name of your Wi-Fi network in the tray. macOS counts the network name as location.</string>
</dict>
</plist>
`;

// macOS keeps the Location permission for whatever the signature's rule
// matches. An ad hoc signature's rule is a hash of this exact build, so any
// change to the helper would ask again. Naming the bundle id instead keeps
// the permission across updates.
const STATUS_RULE = 'designated => identifier "com.pratherbytecraft.startbar.status"';

function buildStatusApp() {
  fs.rmSync(path.dirname(statusApp), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(statusBin), { recursive: true });
  fs.mkdirSync(path.join(statusApp, 'Contents', 'Resources'), { recursive: true });
  fs.copyFileSync(out, statusBin);
  fs.copyFileSync(path.join(root, 'assets', 'Startbar.icns'), path.join(statusApp, 'Contents', 'Resources', 'Startbar.icns'));
  fs.writeFileSync(path.join(statusApp, 'Contents', 'Info.plist'), STATUS_PLIST);
  return spawnSync('codesign', ['--force', '--sign', '-', `-r=${STATUS_RULE}`, statusApp]).status === 0;
}

function build({ quiet = false } = {}) {
  if (process.platform !== 'darwin') return null;
  const which = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (which.status !== 0) {
    if (!quiet) {
      console.log('Startbar: swiftc was not found, so the helper was not built.');
      console.log('Startbar: install the Command Line Tools with `xcode-select --install`, then run `npm rebuild -g startbar`.');
    }
    return null;
  }
  const res = spawnSync('swiftc', ['-O', '-o', out, src], { encoding: 'utf8' });
  if (res.status !== 0) {
    if (!quiet) console.log('Startbar: the helper did not build.\n' + (res.stderr || res.stdout));
    return null;
  }
  if (!buildStatusApp()) {
    fs.rmSync(path.dirname(statusApp), { recursive: true, force: true });
    if (!quiet) console.log('Startbar: the status helper was not signed, so the tray runs without the Wi-Fi name.');
  }
  if (!quiet) console.log('Startbar: helper built.');
  return out;
}

if (require.main === module) build();

module.exports = { build, helperPath, statusHelperPath };
