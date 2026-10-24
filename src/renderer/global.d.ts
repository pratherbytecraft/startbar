// What every page gets from the preload and the shared scripts, and the
// shared types under the names the pages use. The pages are plain scripts
// that share globals, so these are global too.
import type * as T from '../shared/types';

declare global {
  interface Window {
    startbar: T.StartbarApi;

    // shared/theme.ts
    applyTheme(state: T.State): void;
    playOpen(el: HTMLElement | null): void;
    playRows(el: HTMLElement | null): void;
    resolveTheme(state: T.State): ResolvedTheme;
    ACCENTS: Record<string, [light: string, dark: string]>;

    // shared/schemes.ts
    schemeVars(settings: T.Settings, look: SchemeLook): Record<string, string>;
    schemes: Schemes;

    // shared/clock.ts
    clockText(d: Date, c: T.ClockSettings): ClockText;
    dateText(d: Date, style: string): string;

    // shared/order.ts
    byOrder<I extends OrderItem>(items: I[], order: string[] | undefined): I[];
    orderKeys(items: OrderItem[]): string[];
    orderKey(item: OrderItem): string;

    // shared/reorder.ts
    reorderable(list: HTMLElement, options: ReorderOptions): void;

    // shared/dragout.ts
    dragOut(list: HTMLElement, options: { payload: (el: HTMLElement) => DragPayload }): void;

    // shared/trayicons.ts
    trayIcons: TrayIcons;
  }

  // Pages keep a timer as null until it's set. The browser takes
  // clearTimeout(null) and does nothing.
  function clearTimeout(id: number | null | undefined): void;

  type State = T.State;
  type Settings = T.Settings;
  type Colors = T.Colors;
  type ClockSettings = T.ClockSettings;
  type TaskbarSettings = T.TaskbarSettings;
  type Tasks = T.Tasks;
  type UpdateStatus = T.UpdateStatus;
  type Theme = T.Theme;
  type TaskApp = T.TaskApp;
  type TaskWindow = T.TaskWindow;
  type TaskState = T.TaskState;
  type Status = T.Status;
  type Volume = T.Volume;
  type Wifi = T.Wifi;
  type Battery = T.Battery;
  type Bluetooth = T.Bluetooth;
  type BluetoothDevice = T.BluetoothDevice;
  type TrayKind = T.TrayKind;
  type PopoverKind = T.PopoverKind;
  type AppEntry = T.AppEntry;
  type FileHit = T.FileHit;
  type MenuTarget = T.MenuTarget;
  type PowerAction = T.PowerAction;
  type LinkKey = T.LinkKey;
  // The DOM has its own PermissionName.
  type PermissionKey = T.PermissionName;
  type SettingsPage = T.SettingsPage;
  type BarPlace = T.BarPlace;
  type Rect = T.Rect;
  type ListedWindow = T.ListedWindow;
  type GroupPayload = T.GroupPayload;
  type PreviewPayload = T.PreviewPayload;
  type SiblingKey = T.SiblingKey;

  // Light or dark and the accent color, with the Mac's filled in.
  interface ResolvedTheme {
    appearance: 'light' | 'dark';
    accent: string;
    accentText: string;
  }

  // What a color scheme needs besides the theme's own colors.
  interface SchemeLook {
    accent: string;
    appearance: string;
  }

  interface Schemes {
    XP: string[];
    // [name, bar and buttons, selected items, title from, title to]
    W95: Record<string, string[]>;
    // [name, color], no color for System
    GLASS: Record<string, [name: string, color: string | null]>;
    w95Colors(c: Colors, look: SchemeLook): string[];
    glassColor(c: Colors, look: SchemeLook): string;
    mix(a: string, b: string, t: number): string;
    toHsl(c: string): number[];
    fromHsl(hsl: number[]): string;
  }

  interface ClockText {
    time: string;
    date: string;
    full: string;
  }

  // What shared/order.ts reads of a bar button. Pins and the drop slot have
  // no app; a window button has its window.
  interface OrderItem {
    kind: string;
    app?: { bundleId: string; path: string; name: string };
    win?: { id: string };
  }

  interface ReorderOptions {
    axis?: 'x' | 'y';
    onStart?: () => void;
    onDrop: (keys: string[]) => void;
  }

  // The window a dragged element stands for, see shared/dragout.ts.
  interface DragPayload {
    id: string;
    pid: number;
    title: string;
    icon: string;
  }

  // Any one tray reading. Each drawing reads only its own kind's fields.
  type TrayReading = Volume & Wifi & Battery & Bluetooth;

  interface TrayIcons {
    volume(v: Volume): string;
    wifi(w: Wifi): string;
    battery(b: Battery): string;
    bluetooth(b: Bluetooth): string;
    shotdrawer(): string;
    device(kind: string): string;
    tip(kind: TrayKind, s: TrayReading): string;
    shown(settings: Settings, status: Status | null, shotdrawerInstalled: boolean): TrayKind[];
    hours(minutes: number): string;
  }
}

export {};
