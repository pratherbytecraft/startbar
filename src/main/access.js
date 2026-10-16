// The Accessibility permission. Startbar asks once, in plain words, the first
// time the helper reports it's off, and opens the right pane in System
// Settings. Without it the bar shows one button per app. Launching Startbar
// already puts it in the Accessibility list, switched off, so the pane is all
// the user needs.
//
// An update that rebuilds Startbar.app (a new icon, a new Electron) can leave
// the old entry in the list: its switch looks on but no longer counts, and
// switching it off and on doesn't help. So when the permission worked under
// an older build and is off now, Startbar clears its own entry and asks once
// more. A permission switched off by hand, under the same build, is left be.
const { app, dialog, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { BUNDLE_ID } = require('../../scripts/build-app');

const PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

let asking = false;

async function ask({ again = false } = {}) {
  if (asking) return;
  asking = true;
  app.focus({ steal: true }); // Startbar has no Dock icon, so bring the dialog forward
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: again ? 'Turn on Accessibility for Startbar again' : 'Allow Startbar to show your windows?',
    detail: (again ? 'Startbar was updated, and macOS needs the Accessibility switch turned on once more for the new version.\n\n'
      : 'Startbar needs the Accessibility permission to read window titles and to bring a window forward when you click its button.\n\n')
      + 'Turn on Startbar in the list that opens. The bar picks it up on its own, no restart needed.\n\n'
      + 'Without it the bar shows one button per app, and clicking one brings that app forward.',
    buttons: ['Open Accessibility Settings', 'Not Now'],
    defaultId: 0,
    cancelId: 1
  });
  asking = false;
  if (response === 0) openPane();
}

function openPane() {
  shell.openExternal(PANE);
}

// The stamp of the Startbar.app this runs from (see scripts/build-app.js),
// or '' when it runs as plain Electron.
let stamp = null;
function buildStamp() {
  if (stamp === null) {
    try {
      stamp = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).bundleStamp || '';
    } catch {
      stamp = '';
    }
  }
  return stamp;
}

// Clears Startbar's entry in the Accessibility list. The next check from the
// helper puts it back, switched off, ready to turn on.
function forgetOldEntry(done) {
  execFile('tccutil', ['reset', 'Accessibility', BUNDLE_ID], () => done());
}

// Called on every change to the task list. Asks the first time the
// permission is off, and once more after an update that lost it; otherwise
// the bar's right click menu has the entry. Waits for the first app list and
// a moment more, because the bar can't redraw while the dialog is up and
// would sit empty behind it.
function check(tasks, { restartHelper } = {}) {
  const s = settings.get();
  const now = buildStamp();
  if (tasks.accessibility === true) {
    if (now && s.accessibilityStamp !== now) settings.update({ accessibilityStamp: now });
    return;
  }
  if (tasks.accessibility !== false || tasks.apps.length === 0) return;
  if (!s.accessibilityAsked) {
    settings.update({ accessibilityAsked: true, accessibilityStamp: now });
    setTimeout(ask, 800);
    return;
  }
  // Asked before, and the app has changed since: an update.
  if (now && s.accessibilityStamp !== now) {
    settings.update({ accessibilityStamp: now });
    forgetOldEntry(() => {
      if (restartHelper) restartHelper();
      setTimeout(() => ask({ again: true }), 800);
    });
  }
}

module.exports = { ask, check, openPane, buildStamp, BUNDLE_ID };
