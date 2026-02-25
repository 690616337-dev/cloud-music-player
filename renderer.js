'use strict';

/**
 * 云褍音乐播放器 - 渲染进程主类
 * 整合参考HTML的功能和Electron特性
 */

// ========== 常量定义 ==========
const CONFIG = {
  MAX_FOLDERS: 50,
  DEFAULT_FADE_DURATION: 1.0,
  DEFAULT_VOLUME: 0.8,
  FADE_STEPS: 20,
  VISUALIZER_BAR_COUNT: 60,
  VISUALIZER_FFT_SIZE: 256,
  SEARCH_DEBOUNCE_MS: 300,
  FILE_BATCH_SIZE: 5,
  AUDIO_UNLOCK_TIMEOUT_MS: 5000,
  BLOB_URL_CLEANUP_DELAY_MS: 1000,
  TOAST_DURATION_MS: 3000
};

const EQ_PRESETS = {
  normal: { name: '标准模式', desc: '平衡的频率响应，适合大多数音乐类型', gains: [0, 0, 0, 0, 0] },
  bass: { name: '重低音', desc: '增强低频，适合电子、嘻哈音乐', gains: [6, 3, 0, -2, -3] },
  vocal: { name: '人声', desc: '突出中频人声，适合流行、民谣', gains: [-2, 0, 4, 2, -1] },
  treble: { name: '高音增强', desc: '提升高频，适合古典、爵士', gains: [-3, -2, 0, 3, 6] }
};

const EQ_FREQUENCIES = [60, 250, 1000, 4000, 16000];

const PLAY_MODE_NAMES = {
  'off': '关闭循环',
  'loop-one': '单曲循环',
  'loop-all': '列表循环',
  'shuffle': '随机播放',
  'order': '顺序播放'
};

const THEME_COLORS = {
  cyan: '#00d4ff',
  purple: '#9c27b0',
  orange: '#ff9800',
  green: '#4caf50'
};

class CloudMusicPlayer {
  constructor() {
    this.state = {
      folders: [],
      currentFolder: null,
      currentTrack: null,
      isPlaying: false,
      playMode: 'off', // off, loop-one, loop-all, shuffle, order
      fadeEnabled: true,
      fadeInDuration: CONFIG.DEFAULT_FADE_DURATION,
      fadeOutDuration: CONFIG.DEFAULT_FADE_DURATION,
      volume: CONFIG.DEFAULT_VOLUME,
      viewMode: 'grid', // grid, list
      playedTracks: new Set(),
      missingFiles: new Set(),
      isAudioUnlocked: false,
      theme: 'cyan'
    };

    this.audioContext = null;
    this.analyser = null;
    this.gainNode = null;
    this.dataArray = null;
    this.audio = new Audio();
    this.animationId = null;
    this.dragCounter = 0;
    this.dragTimer = null;
    
    // 资源清理追踪
    this.blobUrls = new Set();
    this.eventListeners = [];
    this.intervals = [];
    this.timeouts = [];
    this.tempAudioElements = []; // 追踪临时音频元素
    
    // 防抖定时器
    this.searchDebounceTimer = null;
    
    // 竞态条件控制
    this.fadeOutInProgress = false;
    this.pendingTrackId = null;
    this.fadeIntervalId = null; // 追踪fadeOutAndPlay的interval
    
    this.dom = {};
    this.ttsFolderName = '电子主持人';
    
    this.init();
  }

  async init() {
    this.initDOM();
    this.initAudio();
    await this.loadData();
    this.initEventListeners();
    this.initMacSpecific();
    this.initDragDrop();
    this.loadVoices();
    this.render();
  }

  // ========== 资源清理工具方法 ==========
  
  /**
   * 注册临时音频元素以便后续清理
   */
  registerTempAudio(audio) {
    if (audio instanceof HTMLAudioElement) {
      this.tempAudioElements.push(audio);
    }
    return audio;
  }
  
  /**
   * 清理临时音频元素
   */
  cleanupTempAudioElements() {
    this.tempAudioElements.forEach(audio => {
      try {
        audio.pause();
        audio.src = '';
        audio.load();
      } catch (e) {
        // 忽略清理错误
      }
    });
    this.tempAudioElements = [];
  }
  
  /**
   * 注册Blob URL以便后续清理
   */
  registerBlobUrl(url) {
    if (url && url.startsWith('blob:')) {
      this.blobUrls.add(url);
    }
    return url;
  }
  
  /**
   * 释放Blob URL
   */
  revokeBlobUrl(url) {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
        this.blobUrls.delete(url);
      } catch (e) {
        console.warn('释放Blob URL失败:', e);
      }
    }
  }
  
  /**
   * 清理所有Blob URL
   */
  cleanupAllBlobUrls() {
    this.blobUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('释放Blob URL失败:', e);
      }
    });
    this.blobUrls.clear();
  }
  
  /**
   * 注册事件监听器以便后续清理
   */
  addEventListener(target, type, listener, options) {
    if (!target) return;
    target.addEventListener(type, listener, options);
    this.eventListeners.push({ target, type, listener, options });
  }
  
  /**
   * 移除所有注册的事件监听器
   */
  removeAllEventListeners() {
    this.eventListeners.forEach(({ target, type, listener, options }) => {
      try {
        target.removeEventListener(type, listener, options);
      } catch (e) {
        console.warn('移除事件监听器失败:', e);
      }
    });
    this.eventListeners = [];
  }
  
  /**
   * 注册interval以便后续清理
   */
  setInterval(fn, delay) {
    const id = setInterval(fn, delay);
    this.intervals.push(id);
    return id;
  }
  
  /**
   * 注册timeout以便后续清理
   */
  setTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    this.timeouts.push(id);
    return id;
  }
  
  /**
   * 清理所有intervals和timeouts
   */
  cleanupTimers() {
    this.intervals.forEach(id => clearInterval(id));
    this.timeouts.forEach(id => clearTimeout(id));
    this.intervals = [];
    this.timeouts = [];
  }
  
  /**
   * 清理音频资源
   */
  cleanupAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
    }
    
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('关闭AudioContext失败:', e);
      }
    }
    
    this.stopVisualizer();
  }
  
  /**
   * 完全清理所有资源
   */
  destroy() {
    this.cleanupAudio();
    this.cleanupTimers();
    this.removeAllEventListeners();
    this.cleanupAllBlobUrls();
    this.cleanupTempAudioElements();
  }

  // ========== 输入验证工具方法 ==========
  
  /**
   * 验证字符串输入
   */
  validateString(value, defaultValue = '') {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return defaultValue;
    return String(value);
  }
  
  /**
   * 验证数字输入
   */
  validateNumber(value, defaultValue = 0, min = -Infinity, max = Infinity) {
    const num = Number(value);
    if (isNaN(num)) return defaultValue;
    return Math.max(min, Math.min(max, num));
  }
  
  /**
   * 验证ID格式
   */
  validateId(id) {
    if (typeof id !== 'string') return null;
    if (!id.trim()) return null;
    return id;
  }
  
  /**
   * 安全访问DOM元素
   */
  safeDomAccess(element, callback) {
    if (!element) return null;
    try {
      return callback(element);
    } catch (e) {
      console.warn('DOM操作失败:', e);
      return null;
    }
  }

  initDOM() {
    this.dom = {
      // 侧边栏
      foldersList: document.getElementById('foldersList'),
      folderCount: document.getElementById('folderCount'),
      totalTracks: document.getElementById('totalTracks'),
      addFolderBtn: document.getElementById('addFolderBtn'),
      ttsBtn: document.getElementById('ttsBtn'),
      checkValidBtn: document.getElementById('checkValidBtn'),
      cleanInvalidBtn: document.getElementById('cleanInvalidBtn'),
      resetPlayedBtn: document.getElementById('resetPlayedBtn'),
      
      // 主内容
      currentFolderName: document.getElementById('currentFolderName'),
      musicContainer: document.getElementById('musicContainer'),
      searchInput: document.getElementById('searchInput'),
      gridViewBtn: document.getElementById('gridViewBtn'),
      listViewBtn: document.getElementById('listViewBtn'),
      addMusicBtn: document.getElementById('addMusicBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      // 播放器
      playerCover: document.getElementById('playerCover'),
      currentTrackName: document.getElementById('currentTrackName'),
      currentTrackFolder: document.getElementById('currentTrackFolder'),
      playBtn: document.getElementById('playBtn'),
      prevBtn: document.getElementById('prevBtn'),
      nextBtn: document.getElementById('nextBtn'),
      stopBtn: document.getElementById('stopBtn'),
      progressBar: document.getElementById('progressBar'),
      progressFill: document.getElementById('progressFill'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),
      remainingTime: document.getElementById('remainingTime'),
      volumeBar: document.getElementById('volumeBar'),
      volumeFill: document.getElementById('volumeFill'),
      volumeValue: document.getElementById('volumeValue'),
      volumeIcon: document.getElementById('volumeIcon'),
      fadeInInput: document.getElementById('fadeInInput'),
      fadeOutInput: document.getElementById('fadeOutInput'),
      waveformContainer: document.getElementById('waveformContainer'),
      waveformCanvas: document.getElementById('waveformCanvas'),
      loopModeOptions: document.querySelectorAll('.loop-mode-option'),
      
      // 窗口控制
      minimizeBtn: document.getElementById('minimizeBtn'),
      maximizeBtn: document.getElementById('maximizeBtn'),
      closeBtn: document.getElementById('closeBtn'),
      
      // 设置面板
      settingsPanel: document.getElementById('settingsPanel'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      exportBtn: document.getElementById('exportBtn'),
      importBtn: document.getElementById('importBtn'),
      initAppBtn: document.getElementById('initAppBtn'),
      autoPlayCheck: document.getElementById('autoPlayCheck'),
      defaultLoopMode: document.getElementById('defaultLoopMode'),
      
      // TTS面板
      ttsPanel: document.getElementById('ttsPanel'),
      ttsOverlay: document.getElementById('ttsOverlay'),
      closeTtsBtn: document.getElementById('closeTtsBtn'),
      ttsText: document.getElementById('ttsText'),
      voiceSelect: document.getElementById('voiceSelect'),
      previewTtsBtn: document.getElementById('previewTtsBtn'),
      saveTtsBtn: document.getElementById('saveTtsBtn'),
      ttsStatus: document.getElementById('ttsStatus'),
      
      // 重命名模态框
      renameModal: document.getElementById('renameModal'),
      renameOverlay: document.getElementById('renameOverlay'),
      modalTitle: document.getElementById('modalTitle'),
      renameInput: document.getElementById('renameInput'),
      confirmRenameBtn: document.getElementById('confirmRenameBtn'),
      cancelRenameBtn: document.getElementById('cancelRenameBtn'),
      
      // 拖拽上传
      dropZone: document.getElementById('dropZone'),
      
      // Toast
      toast: document.getElementById('toast')
    };
  }

  initAudio() {
    // 音频事件绑定
    this.addEventListener(this.audio, 'ended', () => this.handleTrackEnded());
    this.addEventListener(this.audio, 'timeupdate', () => this.updateProgress());
    this.addEventListener(this.audio, 'loadedmetadata', () => this.updateTimeDisplay());
    this.addEventListener(this.audio, 'error', (e) => {
      console.error('音频播放错误:', e);
      this.showToast('❌ 音频播放失败', 'error');
      this.state.isPlaying = false;
      this.updatePlayButton();
    });

    // 初始化音量
    this.audio.volume = this.state.volume;
  }

  initAudioContext() {
    if (this.audioContext) return;
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 48000
      });
      
      const source = this.audioContext.createMediaElementSource(this.audio);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = CONFIG.VISUALIZER_FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.8;
      
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.state.volume;
      
      source.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      // 音频解锁
      const unlockAudio = async () => {
        if (this.audioContext?.state === 'suspended') {
          try {
            await this.audioContext.resume();
          } catch (e) {
            console.warn('音频解锁失败:', e);
          }
        }
        this.state.isAudioUnlocked = true;
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
      };
      
      this.addEventListener(document, 'click', unlockAudio);
      this.addEventListener(document, 'keydown', unlockAudio);
      
    } catch (e) {
      console.error('Web Audio API初始化失败:', e);
    }
  }

  // ========== 防抖工具方法 ==========
  
  /**
   * 防抖函数
   * @param {Function} fn - 要执行的函数
   * @param {number} delay - 延迟毫秒数
   * @returns {Function}
   */
  debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fn.apply(this, args);
      }, delay);
    };
  }

  initEventListeners() {
    // 侧边栏按钮
    this.addEventListener(this.dom.addFolderBtn, 'click', () => this.addFolder());
    this.addEventListener(this.dom.ttsBtn, 'click', () => this.openTTSPanel());
    this.addEventListener(this.dom.checkValidBtn, 'click', () => this.checkAllFilesValid());
    this.addEventListener(this.dom.cleanInvalidBtn, 'click', () => this.cleanInvalidFiles());
    this.addEventListener(this.dom.resetPlayedBtn, 'click', () => this.resetPlayedStatus());
    
    // 视图切换
    this.addEventListener(this.dom.gridViewBtn, 'click', () => this.switchView('grid'));
    this.addEventListener(this.dom.listViewBtn, 'click', () => this.switchView('list'));
    
    // 头部按钮
    this.addEventListener(this.dom.addMusicBtn, 'click', () => this.importFiles());
    this.addEventListener(this.dom.settingsBtn, 'click', () => this.toggleSettings());
    
    // 搜索框防抖处理 - 使用debounce函数
    const debouncedRender = this.debounce(() => {
      this.renderTracks();
    }, CONFIG.SEARCH_DEBOUNCE_MS);
    
    this.addEventListener(this.dom.searchInput, 'input', () => {
      debouncedRender();
    });
    
    // 播放控制
    this.addEventListener(this.dom.playBtn, 'click', () => this.togglePlay());
    this.addEventListener(this.dom.prevBtn, 'click', () => this.previousTrack());
    this.addEventListener(this.dom.nextBtn, 'click', () => this.nextTrack());
    this.addEventListener(this.dom.stopBtn, 'click', () => this.stop());
    
    // 循环模式按钮
    if (this.dom.loopModeOptions) {
      this.dom.loopModeOptions.forEach(btn => {
        this.addEventListener(btn, 'click', () => this.setPlayMode(btn.dataset.mode));
      });
    }
    
    // 进度条
    let isDraggingProgress = false;
    this.addEventListener(this.dom.progressBar, 'mousedown', (e) => {
      isDraggingProgress = true;
      this.seek(e);
    });
    this.addEventListener(document, 'mousemove', (e) => {
      if (isDraggingProgress) this.seek(e);
    });
    this.addEventListener(document, 'mouseup', () => {
      isDraggingProgress = false;
    });
    
    // 音量控制
    let isDraggingVolume = false;
    this.addEventListener(this.dom.volumeBar, 'mousedown', (e) => {
      isDraggingVolume = true;
      this.setVolumeFromMouse(e);
    });
    this.addEventListener(document, 'mousemove', (e) => {
      if (isDraggingVolume) this.setVolumeFromMouse(e);
    });
    this.addEventListener(document, 'mouseup', () => {
      isDraggingVolume = false;
    });
    
    // 淡入淡出设置
    this.addEventListener(this.dom.fadeInInput, 'change', () => {
      this.state.fadeInDuration = parseFloat(this.dom.fadeInInput?.value) || 1;
      this.saveSettings();
    });
    this.addEventListener(this.dom.fadeOutInput, 'change', () => {
      this.state.fadeOutDuration = parseFloat(this.dom.fadeOutInput?.value) || 1;
      this.saveSettings();
    });
    
    // 窗口控制
    this.addEventListener(this.dom.minimizeBtn, 'click', () => window.electronAPI?.minimize());
    this.addEventListener(this.dom.maximizeBtn, 'click', () => window.electronAPI?.maximize());
    this.addEventListener(this.dom.closeBtn, 'click', () => window.electronAPI?.close());
    
    // 设置面板
    this.addEventListener(this.dom.closeSettingsBtn, 'click', () => this.toggleSettings());
    this.addEventListener(this.dom.exportBtn, 'click', () => this.exportData());
    this.addEventListener(this.dom.importBtn, 'click', () => this.importData());
    this.addEventListener(this.dom.initAppBtn, 'click', () => this.initializeApp());
    this.addEventListener(this.dom.autoPlayCheck, 'change', () => this.saveSettings());
    
    // 主题切换
    document.querySelectorAll('.theme-option').forEach(el => {
      this.addEventListener(el, 'click', () => this.setTheme(el.dataset.theme));
    });
    
    // EQ预设
    document.querySelectorAll('.eq-preset-btn').forEach(el => {
      this.addEventListener(el, 'click', () => this.setEQPreset(el.dataset.preset));
    });
    
    // TTS面板
    this.addEventListener(this.dom.closeTtsBtn, 'click', () => this.closeTTSPanel());
    this.addEventListener(this.dom.ttsOverlay, 'click', () => this.closeTTSPanel());
    this.addEventListener(this.dom.previewTtsBtn, 'click', () => this.previewTTS());
    this.addEventListener(this.dom.saveTtsBtn, 'click', () => this.saveTTS());
    
    // 重命名模态框
    this.addEventListener(this.dom.cancelRenameBtn, 'click', () => this.closeRenameModal());
    this.addEventListener(this.dom.confirmRenameBtn, 'click', () => this.confirmRename());
    this.addEventListener(this.dom.renameOverlay, 'click', () => this.closeRenameModal());
    this.addEventListener(this.dom.renameInput, 'keypress', (e) => {
      if (e.key === 'Enter') this.confirmRename();
    });
    
    // 键盘快捷键
    this.addEventListener(document, 'keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      switch(e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.previousTrack();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.nextTrack();
          break;
      }
    });
    
    // 页面卸载时清理资源
    this.addEventListener(window, 'beforeunload', () => {
      this.destroy();
    });
    
    // 页面可见性变化时暂停/恢复音频上下文
    this.addEventListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        // 页面隐藏时可以选择暂停可视化以节省资源
        if (!this.state.isPlaying) {
          this.stopVisualizer();
        }
      }
    });
  }

  initMacSpecific() {
    if (!window.electronAPI) return;
    
    const handlers = {
      'window-shown': () => {
        if (this.state.isPlaying && this.audioContext?.state === 'suspended') {
          this.audioContext.resume();
        }
      },
      'menu-import': () => this.importFiles(),
      'menu-new-folder': () => this.addFolder(),
      'menu-play-pause': () => this.togglePlay(),
      'menu-prev': () => this.previousTrack(),
      'menu-next': () => this.nextTrack(),
      'menu-stop': () => this.stop(),
      'menu-volume-up': () => this.adjustVolume(0.1),
      'menu-volume-down': () => this.adjustVolume(-0.1),
      'menu-view-grid': () => this.switchView('grid'),
      'menu-view-list': () => this.switchView('list'),
      'menu-tts': () => this.openTTSPanel(),
      'menu-export': () => this.exportData(),
      'menu-import-backup': () => this.importData()
    };
    
    Object.entries(handlers).forEach(([event, handler]) => {
      window.electronAPI.on(event, handler);
    });
  }

  initDragDrop() {
    // 标记是否正在进行内部拖拽
    this.isInternalDrag = false;
    
    const handleDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 如果是内部拖拽，不显示上传区域
      if (this.isInternalDrag) return;
      
      // 检查拖拽的是否是文件（外部拖拽）
      // 外部拖拽时 dataTransfer.types 通常包含 'Files'
      const isExternalFileDrag = e.dataTransfer?.types && 
        (e.dataTransfer.types.includes('Files') || 
         Array.from(e.dataTransfer.types).some(t => t === 'Files'));
      
      // 如果不是文件拖拽，可能是内部拖拽，不处理
      if (!isExternalFileDrag) return;
      
      if (this.dragTimer) clearTimeout(this.dragTimer);
      this.dragCounter++;
      
      if (this.dragCounter === 1) {
        this.dom.dropZone?.classList.add('active');
      }
    };
    
    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.isInternalDrag) return;
      
      this.dragCounter--;
      
      if (this.dragCounter <= 0) {
        this.dragCounter = 0;
        this.dragTimer = setTimeout(() => {
          if (this.dragCounter === 0) {
            this.dom.dropZone?.classList.remove('active');
          }
        }, 100);
      }
    };
    
    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      this.dragCounter = 0;
      if (this.dragTimer) clearTimeout(this.dragTimer);
      this.dom.dropZone?.classList.remove('active');
      
      // 如果是内部拖拽，不处理文件上传
      if (this.isInternalDrag) {
        this.isInternalDrag = false;
        return;
      }
      
      // 检查是否有文件被拖拽
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      
      if (!this.state.currentFolder) {
        this.showToast('请先选择分类', 'error');
        return;
      }
      
      const audioFiles = Array.from(files).filter(f => 
        f.type?.startsWith('audio/') || 
        /\.(mp3|wav|flac|aac|ogg|m4a|wma|aiff|mp4)$/i.test(f.name)
      );
      
      if (audioFiles.length === 0) {
        this.showToast('请拖拽音频文件', 'error');
        return;
      }
      
      await this.processFiles(audioFiles);
    };
    
    // 为文件夹列表和音乐容器添加拖拽开始/结束标记
    this.setupInternalDragHandlers();
    
    this.addEventListener(document, 'dragenter', handleDragEnter, false);
    this.addEventListener(document, 'dragleave', handleDragLeave, false);
    this.addEventListener(document, 'dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
    this.addEventListener(document, 'drop', handleDrop, false);
  }

  setupInternalDragHandlers() {
    // 监听内部拖拽开始和结束
    const foldersList = this.dom.foldersList;
    const musicContainer = this.dom.musicContainer;
    
    if (foldersList) {
      this.addEventListener(foldersList, 'dragstart', (e) => {
        if (e.target.closest('.folder-item')) {
          this.isInternalDrag = true;
        }
      });
      this.addEventListener(foldersList, 'dragend', () => {
        this.isInternalDrag = false;
      });
    }
    
    if (musicContainer) {
      this.addEventListener(musicContainer, 'dragstart', (e) => {
        if (e.target.closest('.music-card') || e.target.closest('.music-list-item')) {
          this.isInternalDrag = true;
        }
      });
      this.addEventListener(musicContainer, 'dragend', () => {
        this.isInternalDrag = false;
      });
    }
  }

  // ========== 数据管理 ==========
  async loadData() {
    try {
      let savedFolders = null;
      let savedSettings = null;
      
      try {
        savedFolders = localStorage.getItem('cloudMusicFolders');
        savedSettings = localStorage.getItem('cloudMusicSettings');
      } catch (storageError) {
        console.warn('localStorage读取失败:', storageError);
      }
      
      if (savedSettings) {
        try {
          const settings = JSON.parse(savedSettings);
          this.state.playMode = settings.playMode || 'loop-one';
          this.state.fadeEnabled = settings.fadeEnabled !== false;
          this.state.fadeInDuration = this.validateNumber(settings.fadeInDuration, CONFIG.DEFAULT_FADE_DURATION, 0, 10);
          this.state.fadeOutDuration = this.validateNumber(settings.fadeOutDuration, CONFIG.DEFAULT_FADE_DURATION, 0, 10);
          this.state.volume = this.validateNumber(settings.volume, CONFIG.DEFAULT_VOLUME, 0, 1);
          this.state.viewMode = settings.viewMode === 'list' ? 'list' : 'grid';
          this.state.theme = settings.theme || 'cyan';
          this.state.eqPreset = settings.eqPreset || 'normal';
          
          // 应用设置到UI
          if (this.dom.fadeInInput) this.dom.fadeInInput.value = this.state.fadeInDuration;
          if (this.dom.fadeOutInput) this.dom.fadeOutInput.value = this.state.fadeOutDuration;
          this.updateVolumeUI();
          this.setTheme(this.state.theme, false);
          this.setEQPresetUI(this.state.eqPreset);
        } catch (parseError) {
          console.warn('设置解析失败:', parseError);
        }
      }
      
      if (!savedFolders) {
        // 初始化9个默认文件夹
        this.state.folders = Array.from({ length: 9 }, (_, i) => ({
          id: this.generateId(),
          name: '未命名',
          tracks: [],
          order: i,
          createdAt: Date.now()
        }));
        
        // 添加电子主持人文件夹
        this.state.folders.push({
          id: this.generateId(),
          name: this.ttsFolderName,
          tracks: [],
          order: 9,
          isSystem: true,
          createdAt: Date.now()
        });
        
        this.saveData();
      } else {
        try {
          this.state.folders = JSON.parse(savedFolders);
        } catch (parseError) {
          console.warn('文件夹数据解析失败:', parseError);
          this.initializeDefault();
          return;
        }
        
        // 检查并清理无效的Blob URL（重新打开应用后Blob URL会失效）
        let hasInvalidTracks = false;
        this.state.folders.forEach(folder => {
          if (folder.tracks) {
            folder.tracks.forEach(track => {
              // Blob URL在重新打开应用后会失效，需要标记
              if (track.path?.startsWith('blob:')) {
                track.isInvalid = true;
                hasInvalidTracks = true;
              }
            });
          }
        });
        
        if (hasInvalidTracks) {
          console.warn('检测到失效的音频文件，需要重新导入');
        }
        
        // 确保有电子主持人文件夹
        if (!this.state.folders.find(f => f.name === this.ttsFolderName)) {
          this.state.folders.push({
            id: this.generateId(),
            name: this.ttsFolderName,
            tracks: [],
            order: this.state.folders.length,
            isSystem: true,
            createdAt: Date.now()
          });
        }
        
        // 确保至少9个普通文件夹
        const normalFolders = this.state.folders.filter(f => f.name !== this.ttsFolderName);
        while (normalFolders.length < 9) {
          this.state.folders.push({
            id: this.generateId(),
            name: '未命名',
            tracks: [],
            order: this.state.folders.length,
            createdAt: Date.now()
          });
          normalFolders.push({});
        }
      }
      
      if (this.state.folders.length > 0) {
        this.selectFolder(this.state.folders[0].id);
      }
      
      this.updateLoopButton();
    } catch (e) {
      console.error('加载数据失败:', e);
      this.initializeDefault();
    }
  }

  initializeDefault() {
    this.state.folders = Array.from({ length: 9 }, (_, i) => ({
      id: this.generateId(),
      name: '未命名',
      tracks: [],
      order: i,
      createdAt: Date.now()
    }));
    
    this.state.folders.push({
      id: this.generateId(),
      name: this.ttsFolderName,
      tracks: [],
      order: 9,
      isSystem: true,
      createdAt: Date.now()
    });
    
    this.saveData();
    this.selectFolder(this.state.folders[0].id);
  }

  saveData() {
    try {
      localStorage.setItem('cloudMusicFolders', JSON.stringify(this.state.folders));
      this.saveSettings();
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        this.showToast('存储空间已满', 'error');
      } else {
        console.warn('保存数据失败:', e);
      }
    }
  }

  saveSettings() {
    try {
      const settings = {
        playMode: this.state.playMode,
        fadeEnabled: this.state.fadeEnabled,
        fadeInDuration: this.state.fadeInDuration,
        fadeOutDuration: this.state.fadeOutDuration,
        volume: this.state.volume,
        viewMode: this.state.viewMode,
        theme: this.state.theme,
        eqPreset: this.state.eqPreset
      };
      localStorage.setItem('cloudMusicSettings', JSON.stringify(settings));
    } catch (e) {
      console.warn('保存设置失败:', e);
    }
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ========== 文件夹管理 ==========
  renderFolders() {
    if (!this.dom.foldersList) return;
    
    const fragment = document.createDocumentFragment();
    
    this.state.folders.forEach((folder, index) => {
      const trackCount = folder.tracks?.length || 0;
      const missingCount = folder.tracks?.filter(t => this.state.missingFiles.has(t.id)).length || 0;
      const isActive = this.state.currentFolder?.id === folder.id;
      const isSystem = folder.name === this.ttsFolderName;
      
      const div = document.createElement('div');
      div.className = `folder-item ${isActive ? 'active' : ''}`;
      div.draggable = true;
      div.dataset.id = folder.id;
      
      // 计算总时长
      const totalDuration = folder.tracks?.reduce((sum, t) => sum + (t.duration || 0), 0) || 0;
      
      div.innerHTML = `
        <span class="folder-icon">${isSystem ? '🎙️' : '📁'}</span>
        <span class="folder-name">${this.escapeHtml(folder.name)}</span>
        <span class="folder-count">${trackCount}首 · ${this.formatDuration(totalDuration)}</span>
        <div class="folder-actions">
          <button class="icon-btn" data-action="rename" title="重命名">✏️</button>
          ${!isSystem ? '<button class="icon-btn danger" data-action="delete" title="删除">🗑️</button>' : ''}
        </div>
      `;
      
      // 点击选择文件夹
      this.addEventListener(div, 'click', (e) => {
        if (e.target.closest('.icon-btn')) return;
        this.selectFolder(folder.id);
      });
      
      // 重命名按钮
      const renameBtn = div.querySelector('[data-action="rename"]');
      if (renameBtn) {
        this.addEventListener(renameBtn, 'click', (e) => {
          e.stopPropagation();
          this.renameFolder(folder.id);
        });
      }
      
      // 删除按钮
      const deleteBtn = div.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        this.addEventListener(deleteBtn, 'click', (e) => {
          e.stopPropagation();
          this.deleteFolder(folder.id);
        });
      }
      
      // 拖拽事件
      this.addEventListener(div, 'dragstart', (e) => {
        this.isInternalDrag = true;
        div.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      
      this.addEventListener(div, 'dragend', () => {
        this.isInternalDrag = false;
        div.classList.remove('dragging');
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('drag-over'));
      });
      
      this.addEventListener(div, 'dragover', (e) => {
        e.preventDefault();
        div.classList.add('drag-over');
      });
      
      this.addEventListener(div, 'dragleave', () => {
        div.classList.remove('drag-over');
      });
      
      this.addEventListener(div, 'drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = e.dataTransfer?.getData('text/plain');
        if (draggedId === folder.id) {
          div.classList.remove('drag-over');
          return;
        }
        
        const fromIdx = this.state.folders.findIndex(f => f.id === draggedId);
        const toIdx = this.state.folders.findIndex(f => f.id === folder.id);
        
        if (fromIdx !== -1 && fromIdx !== toIdx) {
          const [removed] = this.state.folders.splice(fromIdx, 1);
          this.state.folders.splice(toIdx, 0, removed);
          this.state.folders.forEach((f, i) => f.order = i);
          this.saveData();
          this.renderFolders();
        }
        div.classList.remove('drag-over');
      });
      
      fragment.appendChild(div);
    });
    
    this.dom.foldersList.innerHTML = '';
    this.dom.foldersList.appendChild(fragment);
    this.updateStats();
  }

  addFolder() {
    if (this.state.folders.length >= CONFIG.MAX_FOLDERS) {
      this.showToast(`最多${CONFIG.MAX_FOLDERS}个分类`, 'error');
      return;
    }
    
    const newFolder = {
      id: this.generateId(),
      name: '未命名',
      tracks: [],
      order: this.state.folders.length,
      createdAt: Date.now()
    };
    
    this.state.folders.push(newFolder);
    this.saveData();
    this.renderFolders();
    this.selectFolder(newFolder.id);
    this.showToast('✅ 分类创建成功');
  }

  selectFolder(id) {
    const validId = this.validateId(id);
    if (!validId) return;
    
    this.state.currentFolder = this.state.folders.find(f => f.id === validId);
    if (this.dom.currentFolderName) {
      this.dom.currentFolderName.textContent = this.state.currentFolder?.name || '';
    }
    this.renderFolders();
    this.renderTracks();
  }

  renameFolder(id) {
    const validId = this.validateId(id);
    if (!validId) return;
    
    const folder = this.state.folders.find(f => f.id === validId);
    if (!folder) return;
    
    if (folder.name === this.ttsFolderName) {
      this.showToast('系统文件夹不能重命名', 'error');
      return;
    }
    
    this.openRenameModal('重命名分类', folder.name, (newName) => {
      const validName = this.validateString(newName).trim();
      if (!validName || validName === folder.name) return;
      
      if (this.state.folders.some(f => f.id !== validId && f.name === validName)) {
        this.showToast('该名称已存在', 'error');
        return;
      }
      
      folder.name = validName;
      this.saveData();
      this.renderFolders();
      if (this.state.currentFolder?.id === validId) {
        this.dom.currentFolderName.textContent = validName;
      }
      this.showToast('✅ 重命名成功');
    });
  }

  deleteFolder(id) {
    const validId = this.validateId(id);
    if (!validId) return;
    
    const folder = this.state.folders.find(f => f.id === validId);
    if (!folder) return;
    
    if (folder.name === this.ttsFolderName) {
      this.showToast('系统文件夹不能删除', 'error');
      return;
    }
    
    if (!confirm(`确定删除"${folder.name}"及其${folder.tracks?.length || 0}首音乐？`)) return;
    
    // 清理资源
    folder.tracks?.forEach(track => {
      if (track.path?.startsWith('blob:')) {
        this.revokeBlobUrl(track.path);
      }
    });
    
    this.state.folders = this.state.folders.filter(f => f.id !== validId);
    
    if (this.state.currentFolder?.id === validId) {
      this.state.currentFolder = this.state.folders[0] || null;
      if (this.state.currentFolder) {
        this.selectFolder(this.state.currentFolder.id);
      }
    }
    
    this.saveData();
    this.render();
    this.showToast('✅ 文件夹已删除');
  }

  // ========== 音乐管理 ==========
  async processFiles(files) {
    if (!files || !Array.isArray(files) || files.length === 0) return;
    if (!this.state.currentFolder) {
      this.showToast('请先选择分类', 'error');
      return;
    }
    
    let added = 0;
    const batchSize = CONFIG.FILE_BATCH_SIZE;
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (file) => {
        if (!file || !(file instanceof File)) return;
        
        try {
          const name = file.name?.replace(/\.[^/.]+$/, '') || '未命名';
          
          // 检查重复
          if (this.state.currentFolder.tracks.some(t => t.name === name)) {
            return;
          }
          
          const url = this.registerBlobUrl(URL.createObjectURL(file));
          const track = {
            id: this.generateId(),
            name: name,
            path: url,
            size: file.size || 0,
            duration: 0,
            order: this.state.currentFolder.tracks.length + added,
            createdAt: Date.now()
          };
          
          // 异步获取时长
          const tempAudio = this.registerTempAudio(new Audio());
          tempAudio.preload = 'metadata';
          
          await new Promise((resolve) => {
            let resolved = false;
            const cleanup = () => {
              if (resolved) return;
              resolved = true;
              tempAudio.onloadedmetadata = null;
              tempAudio.onerror = null;
              tempAudio.src = '';
              // 从追踪列表中移除
              const index = this.tempAudioElements.indexOf(tempAudio);
              if (index > -1) {
                this.tempAudioElements.splice(index, 1);
              }
            };
            
            tempAudio.onloadedmetadata = () => {
              track.duration = tempAudio.duration || 0;
              cleanup();
              resolve();
            };
            tempAudio.onerror = () => {
              cleanup();
              resolve();
            };
            tempAudio.src = url;
            
            // 超时处理
            setTimeout(() => {
              cleanup();
              resolve();
            }, CONFIG.AUDIO_UNLOCK_TIMEOUT_MS);
          });
          
          this.state.currentFolder.tracks.push(track);
          added++;
          
        } catch (err) {
          console.error('处理文件失败:', err);
        }
      }));
      
      this.saveData();
      this.renderTracks();
      
      if (i + batchSize < files.length) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    
    if (added > 0) {
      this.showToast(`✅ 成功添加 ${added} 首音乐`);
      this.updateStats();
    }
  }

  async importFiles() {
    if (!window.electronAPI) {
      // 降级方案：使用原生文件选择
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,video/mp4';
      input.multiple = true;
      input.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.processFiles(Array.from(e.target.files));
        }
      };
      input.click();
      return;
    }
    
    try {
      const result = await window.electronAPI.selectFiles();
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        // 将文件路径转换为File对象
        const files = [];
        for (const filePath of result.filePaths) {
          try {
            const response = await fetch(`file://${filePath}`);
            if (!response.ok) {
              console.warn(`读取文件失败: ${filePath}, 状态: ${response.status}`);
              continue;
            }
            const blob = await response.blob();
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
            const file = new File([blob], fileName, { type: blob.type });
            files.push(file);
          } catch (e) {
            console.error('读取文件失败:', e);
          }
        }
        if (files.length > 0) {
          this.processFiles(files);
        } else {
          this.showToast('没有成功读取的文件', 'error');
        }
      }
    } catch (e) {
      console.error('导入文件失败:', e);
      this.showToast('导入文件失败', 'error');
    }
  }

  renderTracks() {
    if (!this.dom.musicContainer) return;
    
    const searchTerm = this.dom.searchInput?.value?.toLowerCase() || '';
    const tracks = (this.state.currentFolder?.tracks || [])
      .filter(t => t && t.name && t.name.toLowerCase().includes(searchTerm))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (tracks.length === 0) {
      this.dom.musicContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎵</div>
          <div class="empty-text">暂无音乐文件</div>
          <div class="empty-hint">拖拽音频文件到此处添加</div>
        </div>
      `;
      this.dom.musicContainer.className = 'music-container';
      return;
    }
    
    this.dom.musicContainer.className = `music-container ${this.state.viewMode === 'list' ? 'list-view' : ''}`;
    
    const fragment = document.createDocumentFragment();
    
    tracks.forEach((track, index) => {
      if (!track) return;
      
      const isMissing = this.state.missingFiles.has(track.id);
      const isPlaying = this.state.currentTrack?.id === track.id && this.state.isPlaying;
      const isPlayed = this.state.playedTracks.has(track.id) && !isPlaying;
      const isTTS = track.isTTS;
      
      const el = document.createElement('div');
      
      if (this.state.viewMode === 'grid') {
        el.className = `music-card ${isPlaying ? 'playing' : ''} ${isPlayed ? 'played' : ''} ${isMissing ? 'missing' : ''}`;
        
        // 确定状态显示
        let statusText = '✓ 正常';
        let statusClass = 'normal';
        if (isMissing) {
          statusText = '⚠️ 丢失';
          statusClass = 'missing';
        } else if (isPlayed) {
          statusText = '✓ 已播放';
          statusClass = 'played';
        }
        
        el.innerHTML = `
          <div class="music-number-badge">${index + 1}</div>
          <div class="music-card-content">
            <div class="music-card-title">${this.escapeHtml(track.name)} ${isTTS ? '<span class="voice-tag">TTS</span>' : ''}</div>
            <div class="music-card-meta">
              <span class="music-card-duration">${this.formatDuration(track.duration)}</span>
              <span class="music-card-status ${statusClass}">${statusText}</span>
            </div>
            <div class="music-card-actions">
              <button class="icon-btn" data-action="rename" title="重命名">✏️</button>
              <button class="icon-btn danger" data-action="delete" title="删除">🗑️</button>
            </div>
          </div>
        `;
      } else {
        el.className = `music-list-item ${isPlaying ? 'playing' : ''} ${isPlayed ? 'played' : ''} ${isMissing ? 'missing' : ''}`;
        el.innerHTML = `
          <div class="music-number">${index + 1}</div>
          <div class="music-details">
            <div class="music-name">${this.escapeHtml(track.name)} ${isTTS ? '<span class="voice-tag">TTS</span>' : ''}</div>
            <div class="music-meta">${this.formatDuration(track.duration)} · ${isMissing ? '⚠️ 文件丢失' : (isPlayed ? '✓ 已播放' : '✓ 正常')}</div>
          </div>
          <div class="music-actions">
            <button class="icon-btn" data-action="rename" title="重命名">✏️</button>
            <button class="icon-btn danger" data-action="delete" title="删除">🗑️</button>
          </div>
        `;
      }
      
      el.dataset.id = track.id;
      
      // 播放点击
      this.addEventListener(el, 'click', (e) => {
        if (e.target.closest('.icon-btn')) return;
        this.playTrack(track.id);
      });
      
      // 重命名
      const renameBtn = el.querySelector('[data-action="rename"]');
      if (renameBtn) {
        this.addEventListener(renameBtn, 'click', (e) => {
          e.stopPropagation();
          this.renameTrack(track.id);
        });
      }
      
      // 删除
      const deleteBtn = el.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        this.addEventListener(deleteBtn, 'click', (e) => {
          e.stopPropagation();
          this.deleteTrack(track.id);
        });
      }
      
      // 拖拽排序
      el.draggable = true;
      this.addEventListener(el, 'dragstart', (e) => {
        this.isInternalDrag = true;
        el.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', track.id);
        }
      });
      
      this.addEventListener(el, 'dragend', () => {
        this.isInternalDrag = false;
        el.classList.remove('dragging');
      });
      
      this.addEventListener(el, 'dragover', (e) => {
        e.preventDefault();
      });
      
      this.addEventListener(el, 'drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer?.getData('text/plain');
        if (draggedId === track.id) return;
        
        // 创建副本进行排序，避免修改原数组引用
        const allTracks = [...(this.state.currentFolder?.tracks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        const fromIdx = allTracks.findIndex(t => t.id === draggedId);
        const toIdx = allTracks.findIndex(t => t.id === track.id);
        
        if (fromIdx !== -1 && toIdx !== -1) {
          const [removed] = allTracks.splice(fromIdx, 1);
          allTracks.splice(toIdx, 0, removed);
          // 更新原数组中的order
          allTracks.forEach((t, i) => {
            const originalTrack = this.state.currentFolder?.tracks.find(ot => ot.id === t.id);
            if (originalTrack) originalTrack.order = i;
          });
          this.saveData();
          this.renderTracks();
        }
      });
      
      fragment.appendChild(el);
    });
    
    this.dom.musicContainer.innerHTML = '';
    this.dom.musicContainer.appendChild(fragment);
  }

  renameTrack(id) {
    if (!this.state.currentFolder?.tracks) return;
    
    const validId = this.validateId(id);
    if (!validId) return;
    
    const track = this.state.currentFolder.tracks.find(t => t.id === validId);
    if (!track) return;
    
    this.openRenameModal('重命名音乐', track.name, (newName) => {
      const validName = this.validateString(newName).trim();
      if (!validName || validName === track.name) return;
      track.name = validName;
      this.saveData();
      this.renderTracks();
      this.showToast('✅ 重命名成功');
    });
  }

  deleteTrack(id) {
    if (!this.state.currentFolder?.tracks) return;
    
    const validId = this.validateId(id);
    if (!validId) return;
    
    const track = this.state.currentFolder.tracks.find(t => t.id === validId);
    if (!track) return;
    
    if (!confirm(`确定删除"${track.name}"？`)) return;
    
    if (track.path?.startsWith('blob:')) {
      this.revokeBlobUrl(track.path);
    }
    
    this.state.currentFolder.tracks = this.state.currentFolder.tracks.filter(t => t.id !== validId);
    
    if (this.state.currentTrack?.id === validId) {
      this.stop();
    }
    
    this.saveData();
    this.renderTracks();
    this.updateStats();
    this.showToast('✅ 已删除');
  }

  // ========== 播放控制 ==========
  async playTrack(trackId) {
    const validId = this.validateId(trackId);
    if (!validId) return;
    
    if (this.state.missingFiles.has(validId)) {
      this.showToast('⚠️ 文件已丢失，无法播放', 'error');
      return;
    }
    
    const track = this.state.currentFolder?.tracks.find(t => t.id === validId);
    if (!track) return;
    
    // 如果是TTS
    if (track.isTTS) {
      this.playTTSTrack(track);
      return;
    }
    
    if (this.state.currentTrack?.id === validId) {
      this.togglePlay();
      return;
    }
    
    // 保存上一个track的blob URL以便后续释放
    const previousTrack = this.state.currentTrack;
    
    // 停止当前播放
    if (this.state.isPlaying) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    
    this.state.currentTrack = track;
    this.saveData();
    
    // 初始化音频上下文
    this.initAudioContext();
    
    if (track.path) {
      // 检查是否是失效的Blob URL
      if (track.isInvalid || (track.path?.startsWith('blob:') && !track.path.includes('http'))) {
        this.showToast('⚠️ 音频文件需要重新导入', 'error');
        return;
      }
      this.audio.src = track.path;
    } else {
      this.showToast('⚠️ 音频路径无效', 'error');
      return;
    }
    
    try {
      this.audio.volume = 0;
      await this.audio.play();
      
      this.state.isPlaying = true;
      
      // 标记为已播放（只要开始播放就标记，不需要等播放完）
      this.state.playedTracks.add(track.id);
      this.saveData();
      
      this.fadeIn();
      this.startVisualizer();
      this.updatePlayerUI();
      this.renderTracks();
      
      // 释放之前的blob URL（延迟释放，避免正在播放的音频被切断）
      if (previousTrack && previousTrack.path?.startsWith('blob:') && previousTrack.id !== validId) {
        setTimeout(() => {
          this.revokeBlobUrl(previousTrack.path);
        }, CONFIG.BLOB_URL_CLEANUP_DELAY_MS);
      }
      
    } catch (err) {
      console.error('播放失败:', err);
      this.showToast('❌ 播放失败', 'error');
    }
  }

  playTTSTrack(track) {
    if (!track || !track.ttsData) return;
    
    const utterance = new SpeechSynthesisUtterance(track.ttsData.text);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name === track.ttsData.voice);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = 'zh-CN';
    
    this.state.currentTrack = track;
    this.state.isPlaying = true;
    this.updatePlayerUI();
    this.renderTracks();
    
    utterance.onend = () => {
      this.state.isPlaying = false;
      this.state.currentTrack = null;
      this.updatePlayerUI();
      this.renderTracks();
      this.handleTrackEnded();
    };
    
    window.speechSynthesis.speak(utterance);
  }

  async togglePlay() {
    if (!this.state.currentTrack) {
      // 播放第一首
      const tracks = this.state.currentFolder?.tracks;
      if (tracks?.length > 0) {
        await this.playTrack(tracks[0].id);
      }
      return;
    }
    
    // TTS特殊处理
    if (this.state.currentTrack.isTTS) {
      if (this.state.isPlaying) {
        window.speechSynthesis.cancel();
        this.state.isPlaying = false;
      } else {
        this.playTTSTrack(this.state.currentTrack);
      }
      this.updatePlayerUI();
      return;
    }
    
    try {
      if (this.state.isPlaying) {
        await this.fadeOut();
        this.audio.pause();
        this.state.isPlaying = false;
        this.stopVisualizer();
      } else {
        if (this.audioContext?.state === 'suspended') {
          await this.audioContext.resume();
        }
        this.audio.volume = 0;
        await this.audio.play();
        this.fadeIn();
        this.state.isPlaying = true;
        this.startVisualizer();
      }
      this.updatePlayerUI();
      this.renderTracks();
    } catch (err) {
      console.error('播放控制失败:', err);
    }
  }

  async stop() {
    if (!this.state.currentTrack) return;
    
    if (this.state.currentTrack.isTTS) {
      window.speechSynthesis.cancel();
      this.state.isPlaying = false;
      this.state.currentTrack = null;
      this.updatePlayerUI();
      this.renderTracks();
      return;
    }
    
    await this.fadeOut();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.state.isPlaying = false;
    this.state.currentTrack = null;
    this.stopVisualizer();
    this.updatePlayerUI();
    this.renderTracks();
    if (this.dom.waveformContainer) {
      this.dom.waveformContainer.classList.remove('active');
    }
  }

  fadeIn() {
    if (!this.state.fadeEnabled) {
      this.audio.volume = this.state.volume;
      return;
    }
    
    const duration = this.state.fadeInDuration * 1000;
    const steps = CONFIG.FADE_STEPS;
    const stepTime = duration / steps;
    const volumeStep = this.state.volume / steps;
    let current = 0;
    
    const interval = setInterval(() => {
      current++;
      if (this.audio) {
        this.audio.volume = Math.min(volumeStep * current, this.state.volume);
      }
      if (current >= steps) clearInterval(interval);
    }, stepTime);
    
    this.intervals.push(interval);
  }

  fadeOut() {
    return new Promise(resolve => {
      if (!this.state.fadeEnabled) {
        resolve();
        return;
      }
      
      const duration = this.state.fadeOutDuration * 1000;
      const steps = CONFIG.FADE_STEPS;
      const stepTime = duration / steps;
      const startVolume = this.audio?.volume || 0;
      const volumeStep = startVolume / steps;
      let current = 0;
      
      const interval = setInterval(() => {
        current++;
        if (this.audio) {
          this.audio.volume = Math.max(startVolume - volumeStep * current, 0);
        }
        if (current >= steps) {
          clearInterval(interval);
          resolve();
        }
      }, stepTime);
      
      this.intervals.push(interval);
    });
  }

  previousTrack() {
    const tracks = this.getCurrentTracks();
    if (!tracks.length) return;
    
    const idx = tracks.findIndex(t => t.id === this.state.currentTrack?.id);
    const prevIdx = idx <= 0 ? tracks.length - 1 : idx - 1;
    this.fadeOutAndPlay(tracks[prevIdx]?.id);
  }

  nextTrack() {
    const tracks = this.getCurrentTracks();
    if (!tracks.length) return;
    
    let nextIdx;
    if (this.state.playMode === 'shuffle') {
      nextIdx = Math.floor(Math.random() * tracks.length);
    } else {
      const idx = tracks.findIndex(t => t.id === this.state.currentTrack?.id);
      nextIdx = idx >= tracks.length - 1 ? 0 : idx + 1;
    }
    this.fadeOutAndPlay(tracks[nextIdx]?.id);
  }

  fadeOutAndPlay(trackId) {
    // 空值检查
    const validId = this.validateId(trackId);
    if (!validId) return;
    
    // 清理之前的fade interval
    if (this.fadeIntervalId) {
      clearInterval(this.fadeIntervalId);
      this.fadeIntervalId = null;
    }
    
    // 竞态条件处理：如果正在淡出，记录待播放的trackId
    if (this.fadeOutInProgress) {
      this.pendingTrackId = validId;
      return;
    }
    
    // 如果没有正在播放或没有gainNode，直接播放
    if (!this.state.isPlaying || !this.gainNode) {
      this.playTrack(validId);
      return;
    }

    this.fadeOutInProgress = true;
    this.pendingTrackId = null;

    const fadeOut = parseFloat(this.state.fadeOutDuration) || CONFIG.DEFAULT_FADE_DURATION;
    const currentVol = this.gainNode.gain.value;
    const steps = CONFIG.FADE_STEPS;
    const stepTime = (fadeOut * 1000) / steps;
    const stepVol = currentVol / steps;
    let step = 0;

    this.fadeIntervalId = setInterval(() => {
      step++;
      if (step >= steps) {
        clearInterval(this.fadeIntervalId);
        this.fadeIntervalId = null;
        
        if (this.gainNode) {
          this.gainNode.gain.value = currentVol;
        }
        
        this.fadeOutInProgress = false;
        
        // 检查是否有待播放的track（竞态条件处理）
        if (this.pendingTrackId && this.pendingTrackId !== validId) {
          this.playTrack(this.pendingTrackId);
        } else {
          this.playTrack(validId);
        }
        this.pendingTrackId = null;
      } else {
        if (this.gainNode) {
          this.gainNode.gain.value = Math.max(0, currentVol - (stepVol * step));
        }
      }
    }, stepTime);
  }

  handleTrackEnded() {
    // 标记为已播放
    if (this.state.currentTrack) {
      this.state.playedTracks.add(this.state.currentTrack.id);
      this.saveData();
      this.renderTracks();
    }
    
    switch (this.state.playMode) {
      case 'off':
        // 关闭循环 - 停止播放
        this.state.isPlaying = false;
        this.updatePlayerUI();
        break;
      case 'loop-one':
        if (this.audio) {
          this.audio.currentTime = 0;
          this.audio.play();
        }
        break;
      case 'loop-all':
      case 'shuffle':
        this.nextTrack();
        break;
      case 'order':
        // 顺序播放 - 如果是最后一首则停止
        const tracks = this.getCurrentTracks();
        const currentIdx = tracks.findIndex(t => t.id === this.state.currentTrack?.id);
        if (currentIdx >= tracks.length - 1) {
          this.state.isPlaying = false;
          this.updatePlayerUI();
        } else {
          this.nextTrack();
        }
        break;
    }
  }

  togglePlayMode() {
    const modes = ['off', 'loop-one', 'loop-all', 'shuffle', 'order'];
    const idx = modes.indexOf(this.state.playMode);
    this.state.playMode = modes[(idx + 1) % modes.length];
    this.updateLoopButton();
    this.saveSettings();
    
    this.showToast(`🎵 ${PLAY_MODE_NAMES[this.state.playMode]}`);
  }

  setPlayMode(mode) {
    if (!mode || typeof mode !== 'string') return;
    
    this.state.playMode = mode;
    this.updateLoopButton();
    this.saveSettings();
    
    this.showToast(`🎵 ${PLAY_MODE_NAMES[mode]}`);
  }

  updateLoopButton() {
    // 更新循环模式按钮状态
    this.dom.loopModeOptions?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.state.playMode);
    });
  }

  seek(e) {
    if (!this.audio?.duration || !this.dom.progressBar || !e) return;
    const rect = this.dom.progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.audio.currentTime = percent * this.audio.duration;
    this.updateProgress();
  }

  updateProgress() {
    if (!this.audio?.duration) return;
    const percent = (this.audio.currentTime / this.audio.duration) * 100;
    
    this.safeDomAccess(this.dom.progressFill, (el) => {
      el.style.width = `${percent}%`;
    });
    
    this.safeDomAccess(this.dom.currentTime, (el) => {
      el.textContent = this.formatTime(this.audio.currentTime);
    });
    
    // 更新剩余时间
    const remaining = this.audio.duration - this.audio.currentTime;
    this.safeDomAccess(this.dom.remainingTime, (el) => {
      el.textContent = `-${this.formatTime(remaining)}`;
    });
  }

  updateTimeDisplay() {
    if (this.dom.totalTime) {
      this.dom.totalTime.textContent = this.formatTime(this.audio.duration || 0);
    }
  }

  setVolumeFromMouse(e) {
    if (!this.dom.volumeBar || !e) return;
    const rect = this.dom.volumeBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.state.volume = percent;
    if (this.audio) this.audio.volume = percent;
    if (this.gainNode) this.gainNode.gain.value = percent;
    this.updateVolumeUI();
    this.saveSettings();
  }

  adjustVolume(delta) {
    const newVol = Math.max(0, Math.min(1, (this.state.volume || 0) + delta));
    this.state.volume = newVol;
    if (this.audio) this.audio.volume = newVol;
    if (this.gainNode) this.gainNode.gain.value = newVol;
    this.updateVolumeUI();
    this.saveSettings();
  }

  updateVolumeUI() {
    const percent = Math.round((this.state.volume || 0) * 100);
    
    this.safeDomAccess(this.dom.volumeFill, (el) => {
      el.style.width = `${percent}%`;
    });
    
    this.safeDomAccess(this.dom.volumeValue, (el) => {
      el.textContent = `${percent}%`;
    });
    
    // 音量图标
    let icon = '🔊';
    if (percent === 0) icon = '🔇';
    else if (percent < 30) icon = '🔈';
    else if (percent < 70) icon = '🔉';
    
    this.safeDomAccess(this.dom.volumeIcon, (el) => {
      el.textContent = icon;
    });
  }

  // ========== 可视化 ==========
  startVisualizer() {
    // 防止重复启动
    if (this.animationId) {
      return;
    }
    
    if (!this.analyser || !this.dom.waveformCanvas) return;
    
    this.dom.waveformContainer?.classList.add('active');
    
    const canvas = this.dom.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyser.frequencyBinCount;
    
    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      
      const parent = canvas.parentElement;
      if (!parent) return;
      
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      this.analyser.getByteFrequencyData(this.dataArray);
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barCount = CONFIG.VISUALIZER_BAR_COUNT;
      const barWidth = canvas.width / barCount;
      const step = Math.floor(bufferLength / barCount);
      
      for (let i = 0; i < barCount; i++) {
        const dataIndex = i * step;
        const value = this.dataArray?.[dataIndex] || 0;
        const percent = value / 255;
        const barHeight = percent * canvas.height * 0.8;
        
        const x = i * barWidth;
        const y = canvas.height - barHeight;
        
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, y);
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 212, 255, 0.2)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
        
        // 顶部高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(x + 1, y, barWidth - 2, 3);
      }
    };
    
    draw();
  }

  stopVisualizer() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // ========== TTS ==========
  loadVoices() {
    const voiceSelect = this.dom.voiceSelect;
    if (!voiceSelect) return;
    
    const populateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceSelect.innerHTML = '';
      
      let chineseVoices = voices.filter(v => v.lang && v.lang.includes('zh'));
      if (chineseVoices.length === 0) {
        chineseVoices = voices;
      }
      
      const femaleKeywords = ['女', 'female', 'xiaoxiao', 'xiaoyi', '婷', '晓'];
      const maleKeywords = ['男', 'male', 'yunjian', 'yunxi', '刚', '伟'];
      
      let selectedVoices = [];
      
      for (const voice of chineseVoices) {
        const name = voice.name.toLowerCase();
        if (femaleKeywords.some(k => name.includes(k))) {
          selectedVoices.push({ voice, label: '👩 女声' });
          break;
        }
      }
      
      for (const voice of chineseVoices) {
        const name = voice.name.toLowerCase();
        if (maleKeywords.some(k => name.includes(k))) {
          selectedVoices.push({ voice, label: '👨 男声' });
          break;
        }
      }
      
      if (selectedVoices.length < 2 && chineseVoices.length >= 2) {
        for (const voice of chineseVoices) {
          if (!selectedVoices.find(sv => sv.voice.name === voice.name)) {
            const label = selectedVoices.length === 0 ? '👩 声音1' : '👨 声音2';
            selectedVoices.push({ voice, label });
          }
          if (selectedVoices.length >= 2) break;
        }
      }
      
      selectedVoices.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = item.voice.name;
        option.textContent = `${item.label} ${item.voice.name}`;
        if (index === 0) option.selected = true;
        voiceSelect.appendChild(option);
      });
      
      if (selectedVoices.length === 0) {
        const option = document.createElement('option');
        option.textContent = '系统无可用人声';
        voiceSelect.appendChild(option);
      }
    };
    
    populateVoices();
    
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoices;
    }
  }

  openTTSPanel() {
    this.dom.ttsOverlay?.classList.add('show');
    this.dom.ttsPanel?.classList.add('show');
  }

  closeTTSPanel() {
    this.dom.ttsOverlay?.classList.remove('show');
    this.dom.ttsPanel?.classList.remove('show');
    this.dom.ttsStatus?.classList.remove('show');
  }

  previewTTS() {
    const text = this.dom.ttsText?.value?.trim();
    if (!text) {
      this.showToast('请输入播报内容', 'error');
      return;
    }
    
    const voiceName = this.dom.voiceSelect?.value;
    if (!voiceName) {
      this.showToast('请先选择人声', 'error');
      return;
    }
    
    if (this.dom.ttsStatus) {
      this.dom.ttsStatus.className = 'tts-status show info';
      this.dom.ttsStatus.textContent = '🔊 正在播放预览...';
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name === voiceName);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = 'zh-CN';
    
    utterance.onend = () => {
      if (this.dom.ttsStatus) {
        this.dom.ttsStatus.className = 'tts-status show success';
        this.dom.ttsStatus.textContent = '✅ 播放完成';
      }
      setTimeout(() => this.dom.ttsStatus?.classList.remove('show'), 2000);
    };
    
    utterance.onerror = () => {
      if (this.dom.ttsStatus) {
        this.dom.ttsStatus.className = 'tts-status show error';
        this.dom.ttsStatus.textContent = '❌ 播放失败';
      }
    };
    
    window.speechSynthesis.speak(utterance);
  }

  saveTTS() {
    const text = this.dom.ttsText?.value?.trim();
    if (!text) {
      this.showToast('请输入播报内容', 'error');
      return;
    }
    
    const voiceName = this.dom.voiceSelect?.value;
    if (!voiceName) {
      this.showToast('请先选择人声', 'error');
      return;
    }
    
    if (this.dom.ttsStatus) {
      this.dom.ttsStatus.className = 'tts-status show info';
      this.dom.ttsStatus.textContent = '🔄 正在生成...';
    }
    
    const ttsFolder = this.state.folders.find(f => f.name === this.ttsFolderName);
    if (!ttsFolder) {
      if (this.dom.ttsStatus) {
        this.dom.ttsStatus.className = 'tts-status show error';
        this.dom.ttsStatus.textContent = '❌ 未找到电子主持人文件夹';
      }
      return;
    }
    
    // 使用文本前20字作为文件名
    const textPreview = text.substring(0, 20).replace(/[\\/:*?"<>|]/g, '_');
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name === voiceName);
    const isFemale = voiceName.toLowerCase().includes('female') || 
                     voiceName.toLowerCase().includes('xiaoxiao') ||
                     voiceName.toLowerCase().includes('女');
    const genderTag = isFemale ? '女声' : '男声';
    const fileName = `${textPreview}_${genderTag}`;
    
    const track = {
      id: this.generateId(),
      name: fileName,
      folderId: ttsFolder.id,
      isTTS: true,
      ttsData: {
        text: text,
        voice: voiceName
      },
      duration: text.length * 0.3,
      order: ttsFolder.tracks.length,
      createdAt: Date.now()
    };
    
    ttsFolder.tracks.push(track);
    this.saveData();
    
    this.closeTTSPanel();
    this.selectFolder(ttsFolder.id);
    this.showToast('✅ 语音已保存到电子主持人文件夹');
    if (this.dom.ttsText) {
      this.dom.ttsText.value = '';
    }
    this.updateStats();
  }

  // ========== 文件检查 ==========
  async checkAllFilesValid() {
    this.showToast('🔍 正在检查音乐文件...');
    
    let validCount = 0;
    let invalidCount = 0;
    let ttsCount = 0;
    
    this.state.missingFiles.clear();
    
    for (const folder of this.state.folders) {
      for (const track of folder.tracks || []) {
        if (track.isTTS) {
          ttsCount++;
          continue;
        }
        
        if (!track.path) {
          this.state.missingFiles.add(track.id);
          invalidCount++;
        } else {
          validCount++;
        }
      }
    }
    
    this.render();
    
    if (invalidCount === 0) {
      this.showToast(`✅ 全部 ${validCount} 首音乐文件正常`);
    } else {
      this.showToast(`⚠️ 正常: ${validCount}, 失效: ${invalidCount}, TTS: ${ttsCount}`, 'warning');
    }
  }

  cleanInvalidFiles() {
    if (this.state.missingFiles.size === 0) {
      this.showToast('✅ 没有失效的文件');
      return;
    }
    
    if (!confirm(`确定清除 ${this.state.missingFiles.size} 个失效的文件记录吗？`)) return;
    
    this.state.folders.forEach(folder => {
      if (folder.tracks) {
        folder.tracks = folder.tracks.filter(t => !this.state.missingFiles.has(t.id));
      }
    });
    
    this.state.missingFiles.clear();
    this.saveData();
    this.render();
    this.showToast('✅ 已清除失效文件');
  }

  resetPlayedStatus() {
    this.state.playedTracks.clear();
    this.state.folders.forEach(folder => {
      folder.tracks?.forEach(t => t.played = false);
    });
    this.saveData();
    this.renderTracks();
    this.showToast('✅ 播放状态已重置');
  }

  // ========== 设置 ==========
  toggleSettings() {
    this.dom.settingsPanel?.classList.toggle('open');
  }

  setEQPresetUI(preset) {
    // 更新按钮状态
    document.querySelectorAll('.eq-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    // 更新信息文本
    const eqInfo = document.getElementById('eqInfo');
    const presetData = EQ_PRESETS[preset];
    
    if (eqInfo && presetData) {
      eqInfo.textContent = `${presetData.name} - ${presetData.desc}`;
    }
  }

  setTheme(theme, save = true) {
    if (!theme || typeof theme !== 'string') return;
    
    const color = THEME_COLORS[theme];
    if (!color) return;
    
    document.documentElement.style.setProperty('--primary', color);
    this.state.theme = theme;
    
    document.querySelectorAll('.theme-option').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
    
    if (save) this.saveSettings();
  }

  setEQPreset(preset) {
    const eqInfo = document.getElementById('eqInfo');
    const presetData = EQ_PRESETS[preset];
    
    if (!presetData) return;
    
    // 更新按钮状态
    document.querySelectorAll('.eq-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    // 更新信息文本
    if (eqInfo) {
      eqInfo.textContent = `${presetData.name} - ${presetData.desc}`;
    }
    
    // 保存设置
    this.state.eqPreset = preset;
    this.saveSettings();
    
    // 应用EQ到音频（如果正在播放）
    this.applyEQToAudio(preset);
    
    this.showToast(`🎵 EQ已切换: ${presetData.name}`);
  }

  applyEQToAudio(preset) {
    if (!this.audioContext) return;
    
    const presetData = EQ_PRESETS[preset];
    if (!presetData) return;
    
    // 如果已有EQ节点，先断开
    if (this.eqFilters) {
      this.eqFilters.forEach(filter => {
        try {
          filter.disconnect();
        } catch (e) {}
      });
    }
    
    const gains = presetData.gains;
    
    this.eqFilters = [];
    
    // 创建滤波器链
    let lastNode = this.gainNode;
    
    EQ_FREQUENCIES.forEach((freq, index) => {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = gains[index] || 0;
      
      if (lastNode) {
        lastNode.disconnect();
        lastNode.connect(filter);
      }
      
      this.eqFilters.push(filter);
      lastNode = filter;
    });
    
    // 连接到分析器和输出
    if (lastNode) {
      lastNode.connect(this.analyser);
    }
  }

  switchView(mode) {
    this.state.viewMode = mode;
    this.dom.gridViewBtn?.classList.toggle('active', mode === 'grid');
    this.dom.listViewBtn?.classList.toggle('active', mode === 'list');
    this.saveSettings();
    this.renderTracks();
  }

  // ========== 数据导入导出 ==========
  exportData() {
    const data = {
      version: 3,
      exportTime: new Date().toISOString(),
      folders: this.state.folders.map(f => ({
        ...f,
        tracks: f.tracks?.map(t => ({
          ...t,
          path: null // 不导出blob URL
        }))
      })),
      settings: {
        playMode: this.state.playMode,
        fadeEnabled: this.state.fadeEnabled,
        fadeInDuration: this.state.fadeInDuration,
        fadeOutDuration: this.state.fadeOutDuration,
        volume: this.state.volume,
        viewMode: this.state.viewMode,
        theme: this.state.theme,
        eqPreset: this.state.eqPreset
      }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `云褍音乐备份_${new Date().toLocaleDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('✅ 备份已导出');
  }

  async importData() {
    try {
      if (!window.electronAPI) {
        // 降级方案
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => this.processImportFile(e.target.files?.[0]);
        input.click();
        return;
      }
      
      const result = await window.electronAPI.openFile();
      if (!result.canceled && result.filePaths?.length > 0) {
        const readResult = await window.electronAPI.readFile(result.filePaths[0]);
        if (readResult.success) {
          this.processImportData(readResult.data);
        } else {
          this.showToast('❌ 读取文件失败', 'error');
        }
      }
    } catch (e) {
      console.error('导入数据失败:', e);
      this.showToast('❌ 导入失败', 'error');
    }
  }

  processImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        this.processImportData(e.target.result);
      }
    };
    reader.readAsText(file);
  }

  processImportData(data) {
    try {
      const imported = JSON.parse(data);
      
      if (!imported.folders) {
        throw new Error('无效的备份文件');
      }
      
      if (!confirm('导入备份将覆盖当前数据，是否继续？')) return;
      
      // 清理现有资源
      this.cleanupAllBlobUrls();
      
      // 导入数据
      this.state.folders = imported.folders.map(f => ({
        ...f,
        tracks: f.tracks?.map(t => ({ ...t, path: null })) || []
      }));
      
      // 确保有TTS文件夹
      if (!this.state.folders.find(f => f.name === this.ttsFolderName)) {
        this.state.folders.push({
          id: this.generateId(),
          name: this.ttsFolderName,
          tracks: [],
          order: this.state.folders.length,
          isSystem: true,
          createdAt: Date.now()
        });
      }
      
      // 应用设置
      if (imported.settings) {
        Object.assign(this.state, imported.settings);
        this.setTheme(this.state.theme, false);
        if (this.dom.fadeInInput) this.dom.fadeInInput.value = this.state.fadeInDuration;
        if (this.dom.fadeOutInput) this.dom.fadeOutInput.value = this.state.fadeOutDuration;
        this.updateVolumeUI();
        this.setEQPresetUI(this.state.eqPreset || 'normal');
      }
      
      this.state.playedTracks.clear();
      this.state.missingFiles.clear();
      this.state.currentTrack = null;
      this.state.isPlaying = false;
      
      this.saveData();
      this.selectFolder(this.state.folders[0]?.id);
      this.showToast('✅ 备份导入成功（音乐文件需重新添加）');
      
    } catch (err) {
      console.error('导入失败:', err);
      this.showToast('❌ 导入失败：' + err.message, 'error');
    }
  }

  initializeApp() {
    if (!confirm('⚠️ 确定要恢复初始设置吗？\n将删除所有数据并恢复为默认空文件夹！')) return;
    
    // 清理资源
    this.cleanupAllBlobUrls();
    this.cleanupTempAudioElements();
    
    try {
      localStorage.removeItem('cloudMusicFolders');
      localStorage.removeItem('cloudMusicSettings');
    } catch (e) {
      console.warn('清除localStorage失败:', e);
    }
    
    this.state.folders = [];
    this.state.currentFolder = null;
    this.state.currentTrack = null;
    this.state.isPlaying = false;
    this.state.playedTracks.clear();
    this.state.missingFiles.clear();
    
    this.initializeDefault();
    this.toggleSettings();
    this.showToast('✅ 已恢复初始设置');
  }

  // ========== 模态框 ==========
  openRenameModal(title, value, callback) {
    this.renameCallback = callback;
    if (this.dom.modalTitle) this.dom.modalTitle.textContent = title;
    if (this.dom.renameInput) this.dom.renameInput.value = value || '';
    this.dom.renameOverlay?.classList.add('show');
    this.dom.renameModal?.classList.add('show');
    setTimeout(() => this.dom.renameInput?.focus(), 100);
  }

  closeRenameModal() {
    this.dom.renameOverlay?.classList.remove('show');
    this.dom.renameModal?.classList.remove('show');
    this.renameCallback = null;
  }

  confirmRename() {
    if (this.renameCallback && this.dom.renameInput) {
      this.renameCallback(this.dom.renameInput.value?.trim());
    }
    this.closeRenameModal();
  }

  // ========== UI更新 ==========
  updatePlayerUI() {
    this.safeDomAccess(this.dom.playBtn, (el) => {
      el.innerHTML = this.state.isPlaying ? '⏸' : '▶';
    });
    
    this.dom.playerCover?.classList.toggle('playing', this.state.isPlaying);
    
    if (this.state.currentTrack) {
      this.safeDomAccess(this.dom.currentTrackName, (el) => {
        el.textContent = this.state.currentTrack?.name || '未知';
      });
      this.safeDomAccess(this.dom.currentTrackFolder, (el) => {
        el.textContent = this.state.currentFolder?.name || '';
      });
    } else {
      this.safeDomAccess(this.dom.currentTrackName, (el) => {
        el.textContent = '未播放';
      });
      this.safeDomAccess(this.dom.currentTrackFolder, (el) => {
        el.textContent = '选择音乐开始播放';
      });
    }
  }

  updatePlayButton() {
    this.updatePlayerUI();
  }

  updateStats() {
    const totalTracks = this.state.folders.reduce((sum, f) => sum + (f.tracks?.length || 0), 0);
    
    this.safeDomAccess(this.dom.folderCount, (el) => {
      el.textContent = this.state.folders?.length || 0;
    });
    
    this.safeDomAccess(this.dom.totalTracks, (el) => {
      el.textContent = totalTracks;
    });
  }

  render() {
    this.renderFolders();
    this.renderTracks();
    this.updatePlayerUI();
    this.updateStats();
  }

  // ========== 工具函数 ==========
  getCurrentTracks() {
    const searchValue = this.validateString(this.dom.searchInput?.value).toLowerCase();
    return (this.state.currentFolder?.tracks || [])
      .filter(t => t && t.name && t.name.toLowerCase().includes(searchValue))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  showToast(message, type = 'success') {
    if (!this.dom.toast) return;
    
    const validMessage = this.validateString(message);
    if (!validMessage) return;
    
    this.dom.toast.textContent = validMessage;
    this.dom.toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      this.dom.toast?.classList.remove('show');
    }, CONFIG.TOAST_DURATION_MS);
  }

  formatTime(seconds) {
    const validSeconds = this.validateNumber(seconds, 0);
    const m = Math.floor(validSeconds / 60);
    const s = Math.floor(validSeconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDuration(seconds) {
    return this.formatTime(seconds);
  }

  escapeHtml(text) {
    const validText = this.validateString(text);
    if (!validText) return '';
    const div = document.createElement('div');
    div.textContent = validText;
    return div.innerHTML;
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  new CloudMusicPlayer();
});
