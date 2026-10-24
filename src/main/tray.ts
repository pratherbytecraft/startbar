// Startbar's own menu bar icon. By default it's only there while the bar is
// hidden, so there is always a way back. The glyph is drawn here as a
// template image (a screen with a bar along the bottom), so macOS tints it
// for the light or dark menu bar.
import { Tray, Menu, nativeImage } from 'electron';
import type { Settings } from '../shared/types';

const SIZE = 18; // points
const SCALE = 2;

let tray: Tray | null = null;

// What the menu bar icon's menu does, and whether the bar is hidden.
export interface TrayActions {
  hidden: boolean;
  toggleBar: () => void;
  openMenu: () => void;
  settings: () => void;
  about: () => void;
  quit: () => void;
}

function glyph() {
  const px = SIZE * SCALE;
  const buf = Buffer.alloc(px * px * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) buf.writeUInt32LE(0xff000000, (y * px + x) * 4);
    }
  };
  // Screen outline, 3px lines at 2x.
  fill(3, 7, 33, 10);
  fill(3, 7, 6, 30);
  fill(30, 7, 33, 30);
  // The bar, filled, with a gap above it for the start button notch.
  fill(3, 23, 33, 30);
  const image = nativeImage.createFromBitmap(buf, { width: px, height: px, scaleFactor: SCALE });
  image.setTemplateImage(true);
  return image;
}

// actions: { hidden, toggleBar, openMenu, settings, about, quit }
function build(actions: TrayActions) {
  return Menu.buildFromTemplate([
    actions.hidden
      ? { label: 'Show the Bar', click: actions.toggleBar }
      : { label: 'Hide the Bar', click: actions.toggleBar },
    { label: 'Open Start Menu', click: actions.openMenu },
    { type: 'separator' },
    { label: 'Startbar Settings…', click: actions.settings },
    { label: 'About Startbar', click: actions.about },
    { type: 'separator' },
    { label: 'Quit Startbar', click: actions.quit }
  ]);
}

// mode is the menuBarIcon setting: hidden (only while the bar is hidden) or
// always.
export function update(mode: Settings['menuBarIcon'], actions: TrayActions) {
  const show = actions.hidden || mode === 'always';
  if (!show) {
    if (tray) tray.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(glyph());
    tray.setToolTip('Startbar');
  }
  tray.setContextMenu(build(actions));
}

