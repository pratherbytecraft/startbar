// The Accessibility permission. Startbar asks once, in plain words, the first
// time the helper reports it's off, and opens the right pane in System
// Settings. Without it the bar shows one button per app. Launching Startbar
// already puts it in the Accessibility list, switched off, so the pane is all
// the user needs.
const { app, dialog, shell } = require('electron');
const settings = require('./settings');

const PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

let asking = false;

async function ask() {
  if (asking) return;
  asking = true;
  app.focus({ steal: true }); // Startbar has no Dock icon, so bring the dialog forward
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: 'Allow Startbar to show your windows?',
    detail: 'Startbar needs the Accessibility permission to read window titles and to bring a window forward when you click its button.\n\n'
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

// Called on every change to the task list. Asks only the first time the
// permission is off; after that the bar's right click menu has the entry.
// Waits for the first app list and a moment more, because the bar can't
// redraw while the dialog is up and would sit empty behind it.
function check(tasks) {
  if (tasks.accessibility !== false || tasks.apps.length === 0) return;
  if (settings.get().accessibilityAsked) return;
  settings.update({ accessibilityAsked: true });
  setTimeout(ask, 800);
}

module.exports = { ask, check, openPane };
