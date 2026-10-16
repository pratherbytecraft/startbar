const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('startbar', {
  getState: () => ipcRenderer.invoke('state'),
  onState: on('state'),
  onMenuState: on('menu:state'),
  onMenuShown: on('menu:shown'),
  clickStart: () => ipcRenderer.send('bar:start'),
  barMenu: () => ipcRenderer.send('bar:menu'),
  hideMenu: () => ipcRenderer.send('menu:hide'),
  apps: () => ipcRenderer.invoke('menu:apps'),
  recent: () => ipcRenderer.invoke('menu:recent'),
  launch: (appPath) => ipcRenderer.send('menu:launch', appPath),
  open: (target) => ipcRenderer.send('menu:open', target),
  power: (action) => ipcRenderer.send('menu:power', action),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.send('settings:reset'),
  openLink: (name) => ipcRenderer.send('settings:link', name),
  openAccessibility: () => ipcRenderer.send('access:open'),
  pauseShortcut: () => ipcRenderer.send('shortcut:pause'),
  resumeShortcut: () => ipcRenderer.send('shortcut:resume'),
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  onTasks: on('tasks'),
  taskCommand: (command) => ipcRenderer.invoke('tasks:command', command),
  taskIcons: (paths) => ipcRenderer.invoke('tasks:icons', paths),
  taskMenu: (target) => ipcRenderer.send('tasks:menu', target),
  showTip: (tip) => ipcRenderer.send('tip:show', tip),
  hideTip: () => ipcRenderer.send('tip:hide'),
  onTipText: on('tip:text'),
  tipSize: (size) => ipcRenderer.send('tip:size', size),
  showGroup: (group) => ipcRenderer.send('group:show', group),
  hideGroup: () => ipcRenderer.send('group:hide'),
  onGroupShow: on('group:show'),
  groupSize: (size) => ipcRenderer.send('group:size', size)
});
