const { contextBridge, ipcRenderer } = require('electron');

const validChannels = [
  'menu-import', 'menu-new-folder', 'menu-play-pause', 'menu-prev', 'menu-next',
  'menu-stop', 'menu-volume-up', 'menu-volume-down', 'menu-export', 'menu-import-backup',
  'menu-view-grid', 'menu-view-list', 'menu-tts', 'menu-help', 'menu-check-update', 'menu-about',
  'window-shown', 'window-restored', 'theme-updated'
];

const invokeChannels = [
  'select-files', 'save-file', 'open-file', 'read-file', 'write-file',
  'window-minimize', 'window-maximize', 'window-close', 'ensure-visible', 'get-app-info'
];

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  ensureVisible: () => ipcRenderer.invoke('ensure-visible'),
  
  // 文件操作
  selectFiles: () => ipcRenderer.invoke('select-files'),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  openFile: () => ipcRenderer.invoke('open-file'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  
  // 应用信息
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // 事件监听
  on: (channel, callback) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  
  removeAllListeners: (channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  
  // 平台信息
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isAppleSilicon: process.arch === 'arm64'
});
