// What the main process and the pages say to each other: the settings, the
// task list from the window helper, the state the pages draw from, and every
// message between them. src/main/ipc.ts and the main modules use these now,
// and the preload and the pages will, so a message with the wrong name or
// the wrong payload fails the type check.

// MARK: settings

export type Theme = 'system' | 'classic-2009' | 'classic-2001' | 'classic-1995';
export type Appearance = 'auto' | 'light' | 'dark';
export type Labels = 'icon-and-title' | 'icons-only';

export interface TaskbarSettings {
  showStartLabel: boolean;
  showPins: boolean;
  showDesktop: boolean;
  pinsPlace: 'own' | 'row';
  grouping: 'always' | 'full' | 'never';
  clickActiveMinimizes: boolean;
  clickThrough: boolean;
  titleOnHover: boolean;
  previews: boolean;
  peek: boolean;
  showWindowless: boolean;
  order: 'opened' | 'app';
  hideInFullScreen: boolean;
  autoHide: boolean;
  moveWindowsUp: boolean;
}

export interface TraySettings {
  shotdrawer: boolean;
  volume: boolean;
  wifi: boolean;
  battery: boolean;
  bluetooth: boolean;
  collapseArrow: boolean;
  collapsed: boolean;
}

export interface ClockSettings {
  hour12: boolean;
  seconds: boolean;
  showDate: boolean;
  dateStyle: 'short' | 'weekday' | 'numeric' | 'dayFirst';
  click: 'calendar' | 'app' | 'nothing';
}

export interface RightColumn {
  applications: boolean;
  documents: boolean;
  downloads: boolean;
  home: boolean;
  systemSettings: boolean;
}

export interface StartMenuSettings {
  showRecent: boolean;
  recentCount: number;
  focusSearch: boolean;
  search: 'apps' | 'files';
  rightColumn: RightColumn;
  folders: string[];
  showPower: boolean;
  confirmPower: boolean;
  shortcut: string;
}

export interface DisplaySettings {
  bars: 'all' | 'main';
  buttons: 'display' | 'all';
  tray: 'every' | 'main';
}

export interface Colors {
  scheme: string;
  face: string;
  selected: string;
  title1: string;
  title2: string;
  tint: string;
  intensity: number;
}

// The look and layout settings a theme keeps while another one is picked,
// in the same nested shape as Settings. See THEME_KEYS in main/settings.ts.
export interface ThemeLook {
  appearance?: Appearance;
  accent?: string;
  translucent?: boolean;
  barHeight?: number;
  labels?: Labels;
  maxButtonWidth?: number;
  taskbar?: Partial<Pick<TaskbarSettings, 'showStartLabel' | 'showPins' | 'pinsPlace' | 'showDesktop' | 'grouping'>>;
  clock?: Partial<Pick<ClockSettings, 'showDate' | 'dateStyle'>>;
  tray?: Partial<Pick<TraySettings, 'collapseArrow'>>;
  colors?: Partial<Colors>;
}

export interface Settings {
  theme: Theme;
  appearance: Appearance;
  accent: string;
  translucent: boolean;
  barHeight: number;
  labels: Labels;
  maxButtonWidth: number;
  taskbar: TaskbarSettings;
  tray: TraySettings;
  clock: ClockSettings;
  startMenu: StartMenuSettings;
  displays: DisplaySettings;
  spaces: { show: 'current' | 'all' };
  menuBarIcon: 'hidden' | 'always';
  quitApps: { on: boolean; keepRunning: string[] };
  openFoldersWith: 'finder' | 'filedrawer';
  updates: { auto: boolean };
  accessibilityAsked: boolean;
  accessibilityStamp: string;
  screenAsked: boolean;
  screenStamp: string;
  hideNoteShown: boolean;
  automationAnswer: '' | 'allowed' | 'denied';
  colors: Colors;
  themes: Partial<Record<Theme, ThemeLook>>;
}

// Any part of a value, at any depth. Lists are replaced whole.
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// A change to the settings, merged into them key by key.
export type SettingsPatch = DeepPartial<Settings>;

// MARK: windows and apps, from the window helper

export interface TaskWindow {
  id: string; // "w" and the window number
  order: number; // counts up as windows are first seen
  title: string;
  minimized: boolean;
  focused: boolean; // the app's own focused window
  onScreen: boolean;
  fullScreen: boolean;
  otherSpace: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TaskApp {
  pid: number;
  name: string;
  bundleId: string;
  path: string;
  active: boolean;
  hidden: boolean;
  windows: TaskWindow[];
}

// main/tasks.ts's list. accessibility is null until the helper reports.
export interface Tasks {
  accessibility: boolean | null;
  apps: TaskApp[];
}

// What the bars draw from: the list, the windows pulled out of their
// groups, how many of those are remembered, and the order buttons were
// dragged into.
export interface TaskState extends Tasks {
  ungrouped: string[];
  remembered: number;
  order: string[];
}

// The window commands a page can send through tasks:command. Main adds its
// own, see HelperCommand in main/tasks.ts.
export type WindowCommand = { cmd: 'activate' | 'minimize' | 'unminimize' | 'close' | 'peek'; id: string };
export type AppCommand = { cmd: 'activateApp' | 'quitApp' | 'newWindow' | 'newWindowItem'; pid: number };
export type TaskCommand = WindowCommand | AppCommand | { cmd: 'showDesktop' };

// The window helper's answer to a command. The extras come with the
// commands that ask for them: windows with hasWindows, title with
// newWindowItem, peeked with peek, image with thumb.
export interface HelperReply {
  ok: boolean;
  error?: string;
  seq?: number;
  cmd?: string;
  windows?: boolean;
  title?: string;
  peeked?: boolean;
  image?: string;
}

// MARK: the tray, from the status helper

export type PermissionState = 'allowed' | 'notAsked' | 'denied' | 'off' | 'unknown';

export interface Volume {
  level: number;
  muted: boolean;
  settable: boolean;
}

export interface Wifi {
  on: boolean;
  connected: boolean;
  bars: number;
  name?: string;
}

export interface Battery {
  percent: number;
  charging: boolean;
  plugged: boolean;
  minutes: number;
}

export interface BluetoothDevice {
  address: string;
  name: string;
  connected: boolean;
  kind: 'computer' | 'phone' | 'audio' | 'keyboard' | 'mouse' | 'other';
  battery?: number;
}

export interface Bluetooth {
  on: boolean;
  devices: BluetoothDevice[];
}

// null means the Mac has no such thing, or it isn't allowed yet.
export interface Status {
  volume: Volume | null;
  wifi: Wifi | null;
  battery: Battery | null;
  bluetooth: Bluetooth | null;
  access: Partial<Record<'location' | 'bluetooth' | 'automation', PermissionState>>;
}

export type TrayCommand =
  | { cmd: 'setVolume'; level: number }
  | { cmd: 'setMuted'; muted: boolean }
  | { cmd: 'setWifi'; on: boolean }
  | { cmd: 'setBluetooth'; on: boolean }
  | { cmd: 'setConnected'; address: string; on: boolean };

// MARK: the state the pages draw from

export interface DockStatus {
  autohide: boolean;
  position: string; // bottom, left or right, as `defaults` gives it
}

export type ScreenAccess = 'allowed' | 'notAsked' | 'denied';

export interface Permissions {
  automation: PermissionState;
  location: PermissionState | null;
  bluetooth: PermissionState | null;
  screen: ScreenAccess | null;
}

export type PermissionName = 'accessibility' | 'automation' | 'location' | 'bluetooth' | 'screen';

export interface LoginItem {
  on: boolean;
  needsApproval: boolean;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'failed';
  latest?: string;
}

export interface SystemLook {
  appearance: 'light' | 'dark';
  accent: string;
}

export type SiblingKey = 'filedrawer' | 'shotdrawer';

// A row in the About page's Also from Prather Bytecraft group.
export interface Sibling {
  key: SiblingKey;
  name: string;
  desc: string;
  installed: boolean;
  line: string;
}

export interface State {
  settings: Settings;
  pins: string[];
  dock: DockStatus | null;
  permissions: Permissions;
  loginItem: LoginItem;
  update: UpdateStatus;
  shortcutError: 'taken' | 'invalid' | null;
  system: SystemLook;
  user: string;
  version: string;
  home: string;
  filedrawer: boolean;
  shotdrawer: boolean;
  siblings: Sibling[];
  updateCommand: string;
  swiftQuit: boolean;
  alwaysRunning: string[];
}

// MARK: what the pages send

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

// An app in the Start menu. icon is a data URL, '' when there's none.
export interface AppEntry {
  name: string;
  path: string;
  icon: string;
}

// A file found by the Start menu's search. where is its folder, as ~/...
export interface FileHit {
  path: string;
  name: string;
  where: string;
  icon: string;
}

export type MenuTarget = 'applications' | 'documents' | 'downloads' | 'home' | 'systemSettings' | 'settings' | 'update' | 'about';
export type PowerAction = 'sleep' | 'logout' | 'shutdown';
export type LinkKey = 'website' | 'github' | 'community' | 'kofi' | 'issues';
export type SettingsPage = 'appearance' | 'taskbar' | 'startmenu' | 'clock' | 'displays' | 'general' | 'permissions' | 'about';
export type PopoverKind = 'volume' | 'wifi' | 'battery' | 'bluetooth';
export type TrayKind = PopoverKind | 'shotdrawer';

// A right click on a window, group or app button.
export interface TaskMenuTarget {
  kind: 'window' | 'group' | 'app';
  pid: number;
  id?: string; // a window
  ids?: string[]; // a group's windows
  inGroup?: boolean; // a row of the group list or a preview picture
}

// A window in the group list or the previews.
export interface ListedWindow {
  id: string;
  title: string;
  minimized: boolean;
  active: boolean;
}

// The group list over a group button.
export interface GroupPayload {
  pid: number;
  rect: Rect;
  icon: string;
  windows: ListedWindow[];
}

// The pictures over a window or group button.
export interface PreviewPayload extends GroupPayload {
  group: boolean;
}

export interface PreviewImage {
  id: string;
  image: string;
  minimized?: boolean;
}

// A window dragged out of the group list or the previews, see
// renderer/shared/dragout.ts. Points are on the screen.
export type DragOut =
  | { phase: 'start'; x: number; y: number; id: string; pid: number; title: string; icon: string }
  | { phase: 'move' | 'drop' | 'cancel'; x: number; y: number };

// The tooltip's text, or the ghost of a dragged window.
export interface Ghost {
  text: string;
  icon: string;
}

// Where a bar is: its display, whether that's the main one, and every display.
export interface BarPlace {
  id: number;
  main: boolean;
  bars: number;
  displays: { id: number; main: boolean; bounds: Rect }[];
}

// MARK: the messages

// Pages to main, answered: the arguments and the answer.
export interface Invokes {
  state: { args: []; result: State };
  'menu:apps': { args: []; result: AppEntry[] };
  'menu:placeIcons': { args: []; result: Record<string, string> };
  'menu:userPicture': { args: []; result: string };
  'menu:recent': { args: []; result: AppEntry[] };
  'menu:files': { args: [q: string]; result: FileHit[] };
  'settings:update': { args: [patch: SettingsPatch]; result: Settings };
  'tasks:get': { args: []; result: TaskState };
  'tasks:command': { args: [command: TaskCommand]; result: HelperReply };
  'tasks:icons': { args: [paths: string[]]; result: Record<string, string> };
  'status:get': { args: []; result: Status };
  // Whether this Mac's drags on drag areas are done by the app (see src/main/windowdrag.ts).
  'window:codeDrag': { args: []; result: boolean };
}

// Pages to main, one way: the arguments.
export interface Sends {
  'bar:start': [];
  'bar:menu': [];
  'menu:hide': [];
  'menu:launch': [appPath: string];
  'menu:appMenu': [appPath: string, fromRecent?: boolean];
  'menu:openFile': [file: string];
  'menu:openFolder': [folder: string];
  'menu:open': [target: MenuTarget];
  'menu:power': [action: PowerAction];
  'settings:reset': [];
  'settings:resetTheme': [];
  'settings:link': [name: LinkKey];
  'sibling:open': [key: SiblingKey];
  'access:ask': [name: PermissionName];
  'pins:launch': [appPath: string];
  'pins:menu': [appPath: string];
  'pins:set': [list: string[]];
  'pins:remove': [appPath: string];
  'pins:add': [];
  'dock:hidden': [hide: boolean];
  'dock:bottom': [];
  'folders:add': [];
  'folders:set': [list: string[]];
  'keepRunning:add': [];
  'keepRunning:set': [list: string[]];
  'login:set': [on: boolean];
  'updates:check': [];
  'clipboard:text': [text: string];
  'settings:export': [];
  'settings:import': [];
  'shortcut:pause': [];
  'shortcut:resume': [];
  'tasks:menu': [target: TaskMenuTarget];
  'tasks:ungroup': [id: string];
  'tasks:regroup': [id: string];
  'tasks:order': [keys: string[]];
  'tasks:putAllBack': [];
  'tasks:dragOut': [d: DragOut];
  'tip:show': [tip: { text: string; rect: Rect }];
  'tip:hide': [];
  'tip:size': [size: Size];
  'preview:show': [payload: PreviewPayload];
  'preview:pin': [payload: PreviewPayload];
  'preview:leave': [];
  'preview:warm': [id: string];
  'preview:hide': [];
  'preview:hover': [on: boolean];
  'preview:peek': [id: string | null];
  'preview:size': [size: Size];
  'group:show': [group: GroupPayload];
  'group:hide': [];
  'group:size': [size: { height: number }];
  'clock:click': [rect: Rect];
  'calendar:size': [size: { height: number }];
  'calendar:hide': [];
  'tray:click': [click: { kind: TrayKind; rect: Rect }];
  'tray:command': [command: TrayCommand];
  'tray:settings': [name: PopoverKind];
  'popover:size': [size: { height: number }];
  'popover:hide': [];
  // A press on a drag area: where in the window it was, in points.
  'window:dragStart': [x: number, y: number];
  'window:dragEnd': [];
  // A double click on a drag area, which does what the Mac's Desktop and Dock setting says.
  'window:titleDouble': [];
}

// Main to pages: the payload.
export interface Events {
  state: State;
  'menu:state': boolean;
  'bar:place': BarPlace;
  'menu:shown': void;
  'menu:recentChanged': void;
  'settings:page': SettingsPage;
  tasks: TaskState;
  'tasks:dragOver': { pid: number } | null;
  'tip:text': string | Ghost;
  'preview:show': PreviewPayload;
  'preview:image': PreviewImage;
  'group:show': GroupPayload;
  'calendar:show': void;
  status: Status;
  'popover:show': PopoverKind;
}

type Listen<T> = (fn: (payload: T) => void) => () => void;

// window.startbar, given to the pages by the preload.
export interface StartbarApi {
  getState(): Promise<State>;
  onState: Listen<State>;
  onMenuState: Listen<boolean>;
  onBarPlace: Listen<BarPlace>;
  onMenuShown: Listen<void>;
  clickStart(): void;
  barMenu(): void;
  hideMenu(): void;
  apps(): Promise<AppEntry[]>;
  placeIcons(): Promise<Record<string, string>>;
  userPicture(): Promise<string>;
  recent(): Promise<AppEntry[]>;
  launch(appPath: string): void;
  appMenu(appPath: string, fromRecent?: boolean): void;
  onRecentChanged: Listen<void>;
  searchFiles(q: string): Promise<FileHit[]>;
  openFile(file: string): void;
  openFolder(folder: string): void;
  open(target: MenuTarget): void;
  power(action: PowerAction): void;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  resetSettings(): void;
  resetThemeSettings(): void;
  openLink(name: LinkKey): void;
  openSibling(key: SiblingKey): void;
  askPermission(name: PermissionName): void;
  launchPin(appPath: string): void;
  pinMenu(appPath: string): void;
  setPins(list: string[]): void;
  unpin(appPath: string): void;
  addPins(): void;
  setDockHidden(hide: boolean): void;
  moveDockToBottom(): void;
  addFolders(): void;
  setFolders(list: string[]): void;
  addKeepRunning(): void;
  setKeepRunning(list: string[]): void;
  setLoginItem(on: boolean): void;
  checkUpdates(): void;
  copyText(text: string): void;
  exportSettings(): void;
  importSettings(): void;
  onSettingsPage: Listen<SettingsPage>;
  pauseShortcut(): void;
  resumeShortcut(): void;
  getTasks(): Promise<TaskState>;
  onTasks: Listen<TaskState>;
  taskCommand(command: TaskCommand): Promise<HelperReply>;
  taskIcons(paths: string[]): Promise<Record<string, string>>;
  taskMenu(target: TaskMenuTarget): void;
  ungroup(id: string): void;
  regroup(id: string): void;
  setOrder(keys: string[]): void;
  putAllBack(): void;
  dragOut(d: DragOut): void;
  onDragOver: Listen<{ pid: number } | null>;
  showTip(tip: { text: string; rect: Rect }): void;
  hideTip(): void;
  onTipText: Listen<string | Ghost>;
  tipSize(size: Size): void;
  showPreview(payload: PreviewPayload): void;
  pinPreview(payload: PreviewPayload): void;
  leavePreview(): void;
  warmPicture(id: string): void;
  hidePreview(): void;
  previewHover(on: boolean): void;
  previewPeek(id: string | null): void;
  previewSize(size: Size): void;
  onPreviewShow: Listen<PreviewPayload>;
  onPreviewImage: Listen<PreviewImage>;
  showGroup(group: GroupPayload): void;
  hideGroup(): void;
  onGroupShow: Listen<GroupPayload>;
  groupSize(size: { height: number }): void;
  clockClick(rect: Rect): void;
  onCalendarShow: Listen<void>;
  calendarSize(size: { height: number }): void;
  hideCalendar(): void;
  getStatus(): Promise<Status>;
  onStatus: Listen<Status>;
  trayClick(kind: TrayKind, rect: Rect): void;
  trayCommand(command: TrayCommand): void;
  traySettings(name: PopoverKind): void;
  onPopoverShow: Listen<PopoverKind>;
  popoverSize(size: { height: number }): void;
  hidePopover(): void;
}
