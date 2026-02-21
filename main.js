const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const isDev = process.argv.includes('--dev');

class CloudMusicPlayer {
  constructor() {
    this.mainWindow = null;
    this.quitting = false;
    this.init();
  }

  init() {
    this.setupAppEvents();
    this.setupIPC();
  }

  createWindow() {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      backgroundColor: '#0f0c29',
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        scrollBounce: true,
        preload: path.join(__dirname, 'preload.js'),
        allowRunningInsecureContent: false,
        webSecurity: true
      },
      vibrancy: 'under-window',
      transparent: false,
      paintWhenInitiallyHidden: true
    });

    win.loadFile('index.html');
    
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
      
      if (isDev) {
        win.webContents.openDevTools();
      }
    });

    win.on('show', () => {
      win.webContents.send('window-shown');
    });

    win.on('restore', () => {
      win.webContents.send('window-restored');
    });

    win.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow = win;
    this.setupMenu();
  }

  setupMenu() {
    const template = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { label: `关于 ${app.name}`, role: 'about' },
          { type: 'separator' },
          { label: '隐藏', role: 'hide' },
          { label: '隐藏其他', role: 'hideothers' },
          { label: '显示全部', role: 'unhide' },
          { type: 'separator' },
          { label: '退出', role: 'quit' }
        ]
      }] : []),
      {
        label: '文件',
        submenu: [
          {
            label: '导入音乐...',
            accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
            click: () => this.mainWindow?.webContents.send('menu-import')
          },
          {
            label: '新建分类',
            accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
            click: () => this.mainWindow?.webContents.send('menu-new-folder')
          },
          { type: 'separator' },
          {
            label: '导出备份',
            click: () => this.mainWindow?.webContents.send('menu-export')
          },
          {
            label: '导入备份',
            click: () => this.mainWindow?.webContents.send('menu-import-backup')
          }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          ...(isMac ? [
            { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
            { label: '删除', role: 'delete' },
            { label: '全选', role: 'selectAll' },
            { type: 'separator' },
            {
              label: '语音播报',
              accelerator: 'Cmd+T',
              click: () => this.mainWindow?.webContents.send('menu-tts')
            }
          ] : [
            { label: '删除', role: 'delete' },
            { type: 'separator' },
            { label: '全选', role: 'selectAll' }
          ])
        ]
      },
      {
        label: '播放控制',
        submenu: [
          {
            label: '播放/暂停',
            accelerator: 'Space',
            click: () => this.mainWindow?.webContents.send('menu-play-pause')
          },
          {
            label: '上一首',
            accelerator: isMac ? 'Cmd+Left' : 'Ctrl+Left',
            click: () => this.mainWindow?.webContents.send('menu-prev')
          },
          {
            label: '下一首',
            accelerator: isMac ? 'Cmd+Right' : 'Ctrl+Right',
            click: () => this.mainWindow?.webContents.send('menu-next')
          },
          { type: 'separator' },
          {
            label: '增大音量',
            accelerator: isMac ? 'Cmd+Up' : 'Ctrl+Up',
            click: () => this.mainWindow?.webContents.send('menu-volume-up')
          },
          {
            label: '减小音量',
            accelerator: isMac ? 'Cmd+Down' : 'Ctrl+Down',
            click: () => this.mainWindow?.webContents.send('menu-volume-down')
          },
          { type: 'separator' },
          {
            label: '停止播放',
            accelerator: 'Cmd+.',
            click: () => this.mainWindow?.webContents.send('menu-stop')
          }
        ]
      },
      {
        label: '视图',
        submenu: [
          {
            label: '网格视图',
            accelerator: 'Cmd+1',
            click: () => this.mainWindow?.webContents.send('menu-view-grid')
          },
          {
            label: '列表视图',
            accelerator: 'Cmd+2',
            click: () => this.mainWindow?.webContents.send('menu-view-list')
          },
          { type: 'separator' },
          { label: '重新加载', role: 'reload' },
          { label: '强制重新加载', role: 'forceReload' },
          { label: '切换开发者工具', role: 'toggleDevTools' },
          { type: 'separator' },
          { label: '实际大小', role: 'actualSize' },
          { label: '放大', role: 'zoomIn' },
          { label: '缩小', role: 'zoomOut' },
          { type: 'separator' },
          { label: '切换全屏', role: 'togglefullscreen' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { label: '最小化', role: 'minimize' },
          { label: '关闭', role: 'close' },
          ...(isMac ? [
            { type: 'separator' },
            { label: '前置全部窗口', role: 'front' },
            { type: 'separator' },
            { label: '窗口', role: 'window' }
          ] : [])
        ]
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '使用帮助',
            click: () => this.mainWindow?.webContents.send('menu-help')
          },
          {
            label: '检查更新',
            click: () => this.mainWindow?.webContents.send('menu-check-update')
          },
          { type: 'separator' },
          {
            label: '关于',
            click: () => this.mainWindow?.webContents.send('menu-about')
          }
        ]
      }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  setupIPC() {
    // 文件选择
    ipcMain.handle('select-files', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff', 'mp4'] }
        ]
      });
      
      return {
        filePaths: result.filePaths || [],
        canceled: result.canceled
      };
    });

    // 保存文件对话框
    ipcMain.handle('save-file', async (event, options) => {
      const result = await dialog.showSaveDialog(this.mainWindow, {
        defaultPath: options.defaultPath || '备份.json',
        filters: [
          { name: 'JSON文件', extensions: ['json'] }
        ]
      });
      return result;
    });

    // 打开文件对话框
    ipcMain.handle('open-file', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'JSON文件', extensions: ['json'] }
        ]
      });
      return result;
    });

    // 读取文件
    ipcMain.handle('read-file', async (event, filePath) => {
      try {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 写入文件
    ipcMain.handle('write-file', async (event, filePath, data) => {
      try {
        await fs.promises.writeFile(filePath, data, 'utf-8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 窗口控制
    ipcMain.handle('window-minimize', () => this.mainWindow?.minimize());
    ipcMain.handle('window-maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow.unmaximize();
        return false;
      } else {
        this.mainWindow?.maximize();
        return true;
      }
    });
    ipcMain.handle('window-close', () => this.mainWindow?.close());
    
    ipcMain.handle('ensure-visible', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        if (!this.mainWindow.isVisible()) this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    // 获取应用信息
    ipcMain.handle('get-app-info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    }));
  }

  setupAppEvents() {
    app.whenReady().then(() => {
      this.createWindow();
    });
    
    app.on('window-all-closed', () => {
      if (!isMac) app.quit();
    });
    
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      } else {
        this.mainWindow?.show();
      }
    });

    // macOS: 防止关闭窗口时退出应用
    app.on('before-quit', () => {
      this.quitting = true;
    });

    if (isMac) {
      app.on('will-quit', () => {
        // 清理工作
      });
    }
    
    nativeTheme.on('updated', () => {
      this.mainWindow?.webContents.send('theme-updated', nativeTheme.shouldUseDarkColors);
    });
  }
}

new CloudMusicPlayer();
