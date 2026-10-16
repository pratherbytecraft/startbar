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
  hideMenu: () => ipcRenderer.send('menu:hide'),
  apps: () => ipcRenderer.invoke('menu:apps'),
  recent: () => ipcRenderer.invoke('menu:recent'),
  launch: (appPath) => ipcRenderer.send('menu:launch', appPath),
  open: (target) => ipcRenderer.send('menu:open', target),
  power: (action) => ipcRenderer.send('menu:power', action),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  onTasks: on('tasks'),
  taskCommand: (command) => ipcRenderer.invoke('tasks:command', command)
});
