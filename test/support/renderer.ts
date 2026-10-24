// Loads the renderer's shared scripts, which attach their functions to
// window, into a fresh sandbox and returns that window. They're TypeScript,
// so this reads the built ones in dist (npm test builds first). Objects made
// in the sandbox have its own prototypes, so compare them through plain().
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import type { ClockSettings, Settings, SystemLook, Theme } from '../../src/shared/types';

const SHARED = path.join(__dirname, '..', '..', 'dist', 'renderer', 'shared');

// What a bar button looks like to shared/order.ts. The tests' apps have no
// path.
export interface OrderItem {
  kind: string;
  app?: { bundleId: string; name: string };
  win?: { id: string };
}

// What the shared scripts put on window, as the tests call them. The pages'
// own list is in src/renderer/global.d.ts, which needs the DOM types. The
// tests pass only the settings each function reads, and schemeVars gets
// colors of the wrong kind on purpose.
export interface Shared {
  schemeVars(settings: { theme: Theme; colors: Record<string, unknown> }, look: { accent: string; appearance: string }): Record<string, string>;
  schemes: {
    XP: string[];
    W95: Record<string, string[]>;
    mix(a: string, b: string, t: number): string;
    toHsl(c: string): number[];
    fromHsl(hsl: number[]): string;
  };
  resolveTheme(state: { settings: Pick<Settings, 'appearance' | 'accent'>; system: SystemLook }): { appearance: 'light' | 'dark'; accent: string; accentText: string };
  ACCENTS: Record<string, [light: string, dark: string]>;
  clockText(d: Date, c: Pick<ClockSettings, 'hour12' | 'seconds' | 'dateStyle'>): { time: string; date: string; full: string };
  dateText(d: Date, style: string): string;
  byOrder<I extends OrderItem>(items: I[], order: string[] | undefined): I[];
  orderKeys(items: OrderItem[]): string[];
}

export function load(...names: string[]) {
  const window = {};
  // theme.js listens on the document as it loads; nothing else needs it here.
  const context = vm.createContext({ window, document: { addEventListener() {} } });
  for (const name of names) vm.runInContext(fs.readFileSync(path.join(SHARED, name), 'utf8'), context, { filename: name });
  // The scripts filled it in.
  return window as Shared;
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
