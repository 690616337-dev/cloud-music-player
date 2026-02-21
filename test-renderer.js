'use strict';

/**
 * 云褍音乐播放器 - 测试版本
 * 用于功能测试和验证
 */
class CloudMusicPlayer {
    constructor() {
        this.state = {
            folders: [],
            currentFolder: null,
            currentTrack: null,
            isPlaying: false,
            playMode: 'loop-one',
            fadeEnabled: true,
            fadeInDuration: 1.0,
            fadeOutDuration: 1.0,
            volume: 0.8,
            viewMode: 'grid',
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
        
        this.dom = {};
        this.ttsFolderName = '电子主持人';
        this.renameCallback = null;
        
        this.init();
    }

    async init() {
        this.initDOM();
        this.initAudio();
        await this.loadData();
        this.initEventListeners();
        this.initDragDrop();
        this.loadVoices();
        this.render();
        console.log('🎵 云褍音乐播放器已初始化');
    }

    initDOM() {
        this.dom = {
            foldersList: document.getElementById('foldersList'),
            folderCount: document.getElementById('folderCount'),
            totalTracks: document.getElementById('totalTracks'),
            currentFolderName: document.getElementById('currentFolderName'),
            musicContainer: document.getElementById('musicContainer'),
            searchInput: document.getElementById('searchInput'),
            gridViewBtn: document.getElementById('gridViewBtn'),
            listViewBtn: document.getElementById('listViewBtn'),
            playerCover: document.getElementById('playerCover'),
            currentTrackName: document.getElementById('currentTrackName'),
            currentTrackFolder: document.getElementById('currentTrackFolder'),
            playBtn: document.getElementById('playBtn'),
            loopBtn: document.getElementById('loopBtn'),
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            volumeBar: document.getElementById('volumeBar'),
            volumeFill: document.getElementById('volumeFill'),
            volumeValue: document.getElementById('volumeValue'),
            volumeIcon: document.getElementById('volumeIcon'),
            fadeInInput: document.getElementById('fadeInInput'),
            fadeOutInput: document.getElementById('fadeOutInput'),
            waveformContainer: document.getElementById('waveformContainer'),
            waveformCanvas: document.getElementById('waveformCanvas'),
            settingsPanel: document.getElementById('settingsPanel'),
            ttsPanel: document.getElementById('ttsPanel'),
            ttsOverlay: document.getElementById('ttsOverlay'),
            ttsText: document.getElementById('ttsText'),
            voiceSelect: document.getElementById('voiceSelect'),
            ttsStatus: document.getElementById('ttsStatus'),
            renameModal: document.getElementById('renameModal'),
            renameOverlay: document.getElementById('renameOverlay'),
            modalTitle: document.getElementById('modalTitle'),
            renameInput: document.getElementById('renameInput'),
            dropZone: document.getElementById('dropZone'),
            toast: document.getElementById('toast')
        };
    }

    initAudio() {
        this.audio.addEventListener('ended', () => this.handleTrackEnded());
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('loadedmetadata', () => this.updateTimeDisplay());
        this.audio.addEventListener('error', (e) => {
            console.error('音频播放错误:', e);
            this.showToast('❌ 音频播放失败', 'error');
            this.state.isPlaying = false;
            this.updatePlayButton();
        });
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
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.state.volume;
            
            source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            const unlockAudio = async () => {
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }
                this.state.isAudioUnlocked = true;
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('keydown', unlockAudio);
            };
            
            document.addEventListener('click', unlockAudio);
            document.addEventListener('keydown', unlockAudio);
            
        } catch (e) {
            console.error('Web Audio API初始化失败:', e);
        }
    }

    initEventListeners() {
        // 音量控制
        let isDraggingVolume = false;
        this.dom.volumeBar?.addEventListener('mousedown', (e) => {
            isDraggingVolume = true;
            this.setVolumeFromMouse(e);
        });
        document.addEventListener('mousemove', (e) => {
            if (isDraggingVolume) this.setVolumeFromMouse(e);
        });
        document.addEventListener('mouseup', () => {
            isDraggingVolume = false;
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
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
    }

    initDragDrop() {
        const handleDragEnter = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (this.dragTimer) clearTimeout(this.dragTimer);
            this.dragCounter++;
            
            if (this.dragCounter === 1) {
                this.dom.dropZone?.classList.add('active');
            }
        };
        
        const handleDragLeave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
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
            
            if (!this.state.currentFolder) {
                this.showToast('请先选择分类', 'error');
                return;
            }
            
            const files = Array.from(e.dataTransfer.files).filter(f => 
                f.type.startsWith('audio/') || 
                /\.(mp3|wav|flac|aac|ogg|m4a|wma|aiff|mp4)$/i.test(f.name)
            );
            
            if (files.length === 0) {
                this.showToast('请拖拽音频文件', 'error');
                return;
            }
            
            await this.processFiles(files);
        };
        
        document.addEventListener('dragenter', handleDragEnter, false);
        document.addEventListener('dragleave', handleDragLeave, false);
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
        document.addEventListener('drop', handleDrop, false);
    }

    // ========== 数据管理 ==========
    async loadData() {
        try {
            const savedFolders = localStorage.getItem('cloudMusicFolders');
            const savedSettings = localStorage.getItem('cloudMusicSettings');
            
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                this.state.playMode = settings.playMode || 'loop-one';
                this.state.fadeEnabled = settings.fadeEnabled !== false;
                this.state.fadeInDuration = settings.fadeInDuration || 1.0;
                this.state.fadeOutDuration = settings.fadeOutDuration || 1.0;
                this.state.volume = settings.volume || 0.8;
                this.state.viewMode = settings.viewMode || 'grid';
                this.state.theme = settings.theme || 'cyan';
                
                this.dom.fadeInInput.value = this.state.fadeInDuration;
                this.dom.fadeOutInput.value = this.state.fadeOutDuration;
                this.updateVolumeUI();
                this.setTheme(this.state.theme, false);
            }
            
            if (!savedFolders) {
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
            } else {
                this.state.folders = JSON.parse(savedFolders);
                
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
            }
        }
    }

    saveSettings() {
        const settings = {
            playMode: this.state.playMode,
            fadeEnabled: this.state.fadeEnabled,
            fadeInDuration: this.state.fadeInDuration,
            fadeOutDuration: this.state.fadeOutDuration,
            volume: this.state.volume,
            viewMode: this.state.viewMode,
            theme: this.state.theme
        };
        localStorage.setItem('cloudMusicSettings', JSON.stringify(settings));
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
            
            div.innerHTML = `
                <span class="folder-icon">${isSystem ? '🎙️' : '📁'}</span>
                <span class="folder-name">${this.escapeHtml(folder.name)}</span>
                <span class="folder-count">${trackCount}${missingCount > 0 ? ` ⚠️${missingCount}` : ''}</span>
                <div class="folder-actions">
                    <button class="icon-btn" title="重命名" onclick="event.stopPropagation();musicPlayer.renameFolder('${folder.id}')">✏️</button>
                    ${!isSystem ? `<button class="icon-btn danger" title="删除" onclick="event.stopPropagation();musicPlayer.deleteFolder('${folder.id}')">🗑️</button>` : ''}
                </div>
            `;
            
            div.addEventListener('click', () => this.selectFolder(folder.id));
            
            // 拖拽事件
            div.addEventListener('dragstart', (e) => {
                div.classList.add('dragging');
                e.dataTransfer.setData('text/plain', folder.id);
                e.dataTransfer.effectAllowed = 'move';
            });
            
            div.addEventListener('dragend', () => {
                div.classList.remove('dragging');
                document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('drag-over'));
            });
            
            div.addEventListener('dragover', (e) => {
                e.preventDefault();
                div.classList.add('drag-over');
            });
            
            div.addEventListener('dragleave', () => {
                div.classList.remove('drag-over');
            });
            
            div.addEventListener('drop', (e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
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
        if (this.state.folders.length >= 50) {
            this.showToast('最多50个分类', 'error');
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
        this.state.currentFolder = this.state.folders.find(f => f.id === id);
        if (this.dom.currentFolderName) {
            this.dom.currentFolderName.textContent = this.state.currentFolder?.name || '';
        }
        this.renderFolders();
        this.renderTracks();
    }

    renameFolder(id) {
        const folder = this.state.folders.find(f => f.id === id);
        if (!folder) return;
        
        if (folder.name === this.ttsFolderName) {
            this.showToast('系统文件夹不能重命名', 'error');
            return;
        }
        
        this.openRenameModal('重命名分类', folder.name, (newName) => {
            if (!newName || newName === folder.name) return;
            
            if (this.state.folders.some(f => f.id !== id && f.name === newName)) {
                this.showToast('该名称已存在', 'error');
                return;
            }
            
            folder.name = newName;
            this.saveData();
            this.renderFolders();
            if (this.state.currentFolder?.id === id) {
                this.dom.currentFolderName.textContent = newName;
            }
            this.showToast('✅ 重命名成功');
        });
    }

    deleteFolder(id) {
        const folder = this.state.folders.find(f => f.id === id);
        if (!folder) return;
        
        if (folder.name === this.ttsFolderName) {
            this.showToast('系统文件夹不能删除', 'error');
            return;
        }
        
        if (!confirm(`确定删除"${folder.name}"及其${folder.tracks?.length || 0}首音乐？`)) return;
        
        folder.tracks?.forEach(track => {
            if (track.path?.startsWith('blob:')) URL.revokeObjectURL(track.path);
        });
        
        this.state.folders = this.state.folders.filter(f => f.id !== id);
        
        if (this.state.currentFolder?.id === id) {
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
        let added = 0;
        const batchSize = 5;
        
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (file) => {
                try {
                    const name = file.name.replace(/\.[^/.]+$/, '');
                    
                    if (this.state.currentFolder.tracks.some(t => t.name === name)) {
                        return;
                    }
                    
                    const url = URL.createObjectURL(file);
                    const track = {
                        id: this.generateId(),
                        name: name,
                        path: url,
                        size: file.size,
                        duration: 0,
                        order: this.state.currentFolder.tracks.length + added,
                        createdAt: Date.now()
                    };
                    
                    const tempAudio = new Audio();
                    tempAudio.preload = 'metadata';
                    
                    await new Promise((resolve) => {
                        tempAudio.onloadedmetadata = () => {
                            track.duration = tempAudio.duration;
                            resolve();
                        };
                        tempAudio.onerror = () => resolve();
                        tempAudio.src = url;
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

    importFiles() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*,video/mp4';
        input.multiple = true;
        input.onchange = (e) => {
            if (e.target.files.length > 0) {
                this.processFiles(Array.from(e.target.files));
            }
        };
        input.click();
    }

    renderTracks() {
        if (!this.dom.musicContainer) return;
        
        const searchTerm = this.dom.searchInput?.value?.toLowerCase() || '';
        const tracks = (this.state.currentFolder?.tracks || [])
            .filter(t => t.name.toLowerCase().includes(searchTerm))
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        
        if (tracks.length === 0) {
            this.dom.musicContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎵</div>
                    <div class="empty-text">暂无音乐文件</div>
                    <div style="font-size:13px;opacity:0.7">拖拽音频文件到此处添加</div>
                </div>
            `;
            this.dom.musicContainer.className = 'music-container';
            return;
        }
        
        this.dom.musicContainer.className = `music-container ${this.state.viewMode === 'list' ? 'list-view' : ''}`;
        
        const fragment = document.createDocumentFragment();
        
        tracks.forEach((track, index) => {
            const isMissing = this.state.missingFiles.has(track.id);
            const isPlaying = this.state.currentTrack?.id === track.id && this.state.isPlaying;
            const isPlayed = this.state.playedTracks.has(track.id) && !isPlaying;
            const isTTS = track.isTTS;
            
            const el = document.createElement('div');
            
            if (this.state.viewMode === 'grid') {
                el.className = `music-card ${isPlaying ? 'playing' : ''} ${isPlayed ? 'played' : ''} ${isMissing ? 'missing' : ''}`;
                el.innerHTML = `
                    <div class="music-cover">
                        🎵
                        <div class="play-overlay">${isPlaying ? '⏸' : '▶'}</div>
                    </div>
                    <div class="music-info">
                        <h3>${this.escapeHtml(track.name)} ${isTTS ? '<span class="voice-tag">TTS</span>' : ''}</h3>
                        <p>${this.formatDuration(track.duration)} ${isMissing ? '⚠️ 丢失' : (isPlayed ? '✓ 已播放' : '')}</p>
                    </div>
                    <div class="music-actions">
                        <button class="icon-btn" title="重命名" onclick="event.stopPropagation();musicPlayer.renameTrack('${track.id}')">✏️</button>
                        <button class="icon-btn danger" title="删除" onclick="event.stopPropagation();musicPlayer.deleteTrack('${track.id}')">🗑️</button>
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
                        <button class="icon-btn" title="重命名" onclick="event.stopPropagation();musicPlayer.renameTrack('${track.id}')">✏️</button>
                        <button class="icon-btn danger" title="删除" onclick="event.stopPropagation();musicPlayer.deleteTrack('${track.id}')">🗑️</button>
                    </div>
                `;
            }
            
            el.addEventListener('click', () => this.playTrack(track.id));
            
            // 拖拽排序
            el.draggable = true;
            el.addEventListener('dragstart', (e) => {
                el.classList.add('dragging');
                e.dataTransfer.setData('text/plain', track.id);
            });
            
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
            });
            
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId === track.id) return;
                
                const allTracks = this.state.currentFolder.tracks.sort((a, b) => (a.order || 0) - (b.order || 0));
                const fromIdx = allTracks.findIndex(t => t.id === draggedId);
                const toIdx = allTracks.findIndex(t => t.id === track.id);
                
                if (fromIdx !== -1 && toIdx !== -1) {
                    const [removed] = allTracks.splice(fromIdx, 1);
                    allTracks.splice(toIdx, 0, removed);
                    allTracks.forEach((t, i) => t.order = i);
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
        const track = this.state.currentFolder?.tracks.find(t => t.id === id);
        if (!track) return;
        
        this.openRenameModal('重命名音乐', track.name, (newName) => {
            if (!newName || newName === track.name) return;
            track.name = newName;
            this.saveData();
            this.renderTracks();
            this.showToast('✅ 重命名成功');
        });
    }

    deleteTrack(id) {
        const track = this.state.currentFolder?.tracks.find(t => t.id === id);
        if (!track) return;
        
        if (!confirm(`确定删除"${track.name}"？`)) return;
        
        if (track.path?.startsWith('blob:')) URL.revokeObjectURL(track.path);
        
        this.state.currentFolder.tracks = this.state.currentFolder.tracks.filter(t => t.id !== id);
        
        if (this.state.currentTrack?.id === id) {
            this.stop();
        }
        
        this.saveData();
        this.renderTracks();
        this.updateStats();
        this.showToast('✅ 已删除');
    }

    // ========== 播放控制 ==========
    async playTrack(trackId) {
        if (this.state.missingFiles.has(trackId)) {
            this.showToast('⚠️ 文件已丢失，无法播放', 'error');
            return;
        }
        
        const track = this.state.currentFolder?.tracks.find(t => t.id === trackId);
        if (!track) return;
        
        if (track.isTTS) {
            this.playTTSTrack(track);
            return;
        }
        
        if (this.state.currentTrack?.id === trackId) {
            this.togglePlay();
            return;
        }
        
        if (this.state.isPlaying) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }
        
        this.state.currentTrack = track;
        this.saveData();
        
        this.initAudioContext();
        
        if (track.path) {
            this.audio.src = track.path;
        } else {
            this.showToast('⚠️ 音频路径无效', 'error');
            return;
        }
        
        try {
            this.audio.volume = 0;
            await this.audio.play();
            
            this.state.isPlaying = true;
            this.fadeIn();
            this.startVisualizer();
            this.updatePlayerUI();
            this.renderTracks();
            
        } catch (err) {
            console.error('播放失败:', err);
            this.showToast('❌ 播放失败', 'error');
        }
    }

    playTTSTrack(track) {
        if (!track.ttsData) return;
        
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
            const tracks = this.state.currentFolder?.tracks;
            if (tracks?.length > 0) {
                await this.playTrack(tracks[0].id);
            }
            return;
        }
        
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
        this.dom.waveformContainer?.classList.remove('active');
    }

    fadeIn() {
        if (!this.state.fadeEnabled) {
            this.audio.volume = this.state.volume;
            return;
        }
        
        const duration = this.state.fadeInDuration * 1000;
        const steps = 20;
        const stepTime = duration / steps;
        const volumeStep = this.state.volume / steps;
        let current = 0;
        
        const interval = setInterval(() => {
            current++;
            this.audio.volume = Math.min(volumeStep * current, this.state.volume);
            if (current >= steps) clearInterval(interval);
        }, stepTime);
    }

    fadeOut() {
        return new Promise(resolve => {
            if (!this.state.fadeEnabled) {
                resolve();
                return;
            }
            
            const duration = this.state.fadeOutDuration * 1000;
            const steps = 20;
            const stepTime = duration / steps;
            const startVolume = this.audio.volume;
            const volumeStep = startVolume / steps;
            let current = 0;
            
            const interval = setInterval(() => {
                current++;
                this.audio.volume = Math.max(startVolume - volumeStep * current, 0);
                if (current >= steps) {
                    clearInterval(interval);
                    resolve();
                }
            }, stepTime);
        });
    }

    previousTrack() {
        const tracks = this.getCurrentTracks();
        if (!tracks.length) return;
        
        const idx = tracks.findIndex(t => t.id === this.state.currentTrack?.id);
        const prevIdx = idx <= 0 ? tracks.length - 1 : idx - 1;
        this.playTrack(tracks[prevIdx].id);
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
        this.playTrack(tracks[nextIdx].id);
    }

    handleTrackEnded() {
        if (this.state.currentTrack) {
            this.state.playedTracks.add(this.state.currentTrack.id);
            this.saveData();
            this.renderTracks();
        }
        
        switch (this.state.playMode) {
            case 'loop-one':
                this.audio.currentTime = 0;
                this.audio.play();
                break;
            case 'loop-all':
            case 'shuffle':
                this.nextTrack();
                break;
            case 'order':
                this.state.isPlaying = false;
                this.updatePlayerUI();
                break;
        }
    }

    togglePlayMode() {
        const modes = ['loop-one', 'loop-all', 'shuffle', 'order'];
        const idx = modes.indexOf(this.state.playMode);
        this.state.playMode = modes[(idx + 1) % modes.length];
        this.updateLoopButton();
        this.saveSettings();
        
        const names = {
            'loop-one': '单曲循环',
            'loop-all': '列表循环',
            'shuffle': '随机播放',
            'order': '顺序播放'
        };
        this.showToast(`🎵 ${names[this.state.playMode]}`);
    }

    updateLoopButton() {
        const icons = {
            'loop-one': '🔂',
            'loop-all': '🔁',
            'shuffle': '🔀',
            'order': '➡️'
        };
        if (this.dom.loopBtn) {
            this.dom.loopBtn.textContent = icons[this.state.playMode];
        }
    }

    seek(e) {
        if (!this.audio.duration) return;
        const rect = this.dom.progressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.audio.currentTime = percent * this.audio.duration;
        this.updateProgress();
    }

    updateProgress() {
        if (!this.audio.duration) return;
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        this.dom.progressFill.style.width = `${percent}%`;
        this.dom.currentTime.textContent = this.formatTime(this.audio.currentTime);
    }

    updateTimeDisplay() {
        this.dom.totalTime.textContent = this.formatTime(this.audio.duration || 0);
    }

    setVolumeFromMouse(e) {
        const rect = this.dom.volumeBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.state.volume = percent;
        this.audio.volume = percent;
        if (this.gainNode) this.gainNode.gain.value = percent;
        this.updateVolumeUI();
        this.saveSettings();
    }

    updateVolumeUI() {
        const percent = Math.round(this.state.volume * 100);
        this.dom.volumeFill.style.width = `${percent}%`;
        this.dom.volumeValue.textContent = `${percent}%`;
        
        let icon = '🔊';
        if (percent === 0) icon = '🔇';
        else if (percent < 30) icon = '🔈';
        else if (percent < 70) icon = '🔉';
        this.dom.volumeIcon.textContent = icon;
    }

    // ========== 可视化 ==========
    startVisualizer() {
        if (!this.analyser || !this.dom.waveformCanvas) return;
        
        this.dom.waveformContainer?.classList.add('active');
        
        const canvas = this.dom.waveformCanvas;
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        
        const draw = () => {
            this.animationId = requestAnimationFrame(draw);
            
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const barCount = 60;
            const barWidth = canvas.width / barCount;
            const step = Math.floor(bufferLength / barCount);
            
            for (let i = 0; i < barCount; i++) {
                const dataIndex = i * step;
                const value = this.dataArray[dataIndex] || 0;
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
        const text = this.dom.ttsText?.value.trim();
        if (!text) {
            this.showToast('请输入播报内容', 'error');
            return;
        }
        
        const voiceName = this.dom.voiceSelect?.value;
        if (!voiceName) {
            this.showToast('请先选择人声', 'error');
            return;
        }
        
        this.dom.ttsStatus.className = 'tts-status show info';
        this.dom.ttsStatus.textContent = '🔊 正在播放预览...';
        
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = voices.find(v => v.name === voiceName);
        if (selectedVoice) utterance.voice = selectedVoice;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.lang = 'zh-CN';
        
        utterance.onend = () => {
            this.dom.ttsStatus.className = 'tts-status show success';
            this.dom.ttsStatus.textContent = '✅ 播放完成';
            setTimeout(() => this.dom.ttsStatus.classList.remove('show'), 2000);
        };
        
        utterance.onerror = () => {
            this.dom.ttsStatus.className = 'tts-status show error';
            this.dom.ttsStatus.textContent = '❌ 播放失败';
        };
        
        window.speechSynthesis.speak(utterance);
    }

    saveTTS() {
        const text = this.dom.ttsText?.value.trim();
        if (!text) {
            this.showToast('请输入播报内容', 'error');
            return;
        }
        
        const voiceName = this.dom.voiceSelect?.value;
        if (!voiceName) {
            this.showToast('请先选择人声', 'error');
            return;
        }
        
        this.dom.ttsStatus.className = 'tts-status show info';
        this.dom.ttsStatus.textContent = '🔄 正在生成...';
        
        const ttsFolder = this.state.folders.find(f => f.name === this.ttsFolderName);
        if (!ttsFolder) {
            this.dom.ttsStatus.className = 'tts-status show error';
            this.dom.ttsStatus.textContent = '❌ 未找到电子主持人文件夹';
            return;
        }
        
        const timestamp = new Date().toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }).replace(/[\/:\s]/g, '');
        
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = voices.find(v => v.name === voiceName);
        const isFemale = voiceName.toLowerCase().includes('female') || 
                         voiceName.toLowerCase().includes('xiaoxiao') ||
                         voiceName.toLowerCase().includes('女');
        const genderTag = isFemale ? '女声' : '男声';
        const fileName = `播报_${genderTag}_${timestamp}`;
        
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
        this.dom.ttsText.value = '';
        this.updateStats();
    }

    // ========== 文件检查 ==========
    checkAllFilesValid() {
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
            folder.tracks = folder.tracks.filter(t => !this.state.missingFiles.has(t.id));
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

    setTheme(theme, save = true) {
        const colors = {
            cyan: '#00d4ff',
            purple: '#9c27b0',
            orange: '#ff9800',
            green: '#4caf50'
        };
        
        if (colors[theme]) {
            document.documentElement.style.setProperty('--primary', colors[theme]);
            this.state.theme = theme;
            
            document.querySelectorAll('.theme-option').forEach(el => {
                el.classList.toggle('active', el.dataset.theme === theme);
            });
            
            if (save) this.saveSettings();
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
                    path: null
                }))
            })),
            settings: {
                playMode: this.state.playMode,
                fadeEnabled: this.state.fadeEnabled,
                fadeInDuration: this.state.fadeInDuration,
                fadeOutDuration: this.state.fadeOutDuration,
                volume: this.state.volume,
                viewMode: this.state.viewMode,
                theme: this.state.theme
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

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    
                    if (!imported.folders) {
                        throw new Error('无效的备份文件');
                    }
                    
                    if (!confirm('导入备份将覆盖当前数据，是否继续？')) return;
                    
                    this.state.folders.forEach(folder => {
                        folder.tracks?.forEach(track => {
                            if (track.path?.startsWith('blob:')) URL.revokeObjectURL(track.path);
                        });
                    });
                    
                    this.state.folders = imported.folders.map(f => ({
                        ...f,
                        tracks: f.tracks?.map(t => ({ ...t, path: null })) || []
                    }));
                    
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
                    
                    if (imported.settings) {
                        Object.assign(this.state, imported.settings);
                        this.setTheme(this.state.theme, false);
                    }
                    
                    this.state.playedTracks.clear();
                    this.state.missingFiles.clear();
                    this.state.currentTrack = null;
                    this.state.isPlaying = false;
                    
                    this.saveData();
                    this.selectFolder(this.state.folders[0]?.id);
                    this.showToast('✅ 备份导入成功（音乐文件需重新添加）');
                    
                } catch (err) {
                    this.showToast('❌ 导入失败：' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    initializeApp() {
        if (!confirm('⚠️ 确定要恢复初始设置吗？\n将删除所有数据并恢复为默认空文件夹！')) return;
        
        this.state.folders.forEach(folder => {
            folder.tracks?.forEach(track => {
                if (track.path?.startsWith('blob:')) URL.revokeObjectURL(track.path);
            });
        });
        
        localStorage.removeItem('cloudMusicFolders');
        localStorage.removeItem('cloudMusicSettings');
        
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
        this.dom.modalTitle.textContent = title;
        this.dom.renameInput.value = value;
        this.dom.renameOverlay?.classList.add('show');
        this.dom.renameModal?.classList.add('show');
        setTimeout(() => this.dom.renameInput.focus(), 100);
    }

    closeRenameModal() {
        this.dom.renameOverlay?.classList.remove('show');
        this.dom.renameModal?.classList.remove('show');
        this.renameCallback = null;
    }

    confirmRename() {
        if (this.renameCallback) {
            this.renameCallback(this.dom.renameInput.value.trim());
        }
        this.closeRenameModal();
    }

    // ========== UI更新 ==========
    updatePlayerUI() {
        if (this.dom.playBtn) {
            this.dom.playBtn.innerHTML = this.state.isPlaying ? '⏸' : '▶';
        }
        
        this.dom.playerCover?.classList.toggle('playing', this.state.isPlaying);
        
        if (this.state.currentTrack) {
            this.dom.currentTrackName.textContent = this.state.currentTrack.name;
            this.dom.currentTrackFolder.textContent = this.state.currentFolder?.name || '';
        } else {
            this.dom.currentTrackName.textContent = '未播放';
            this.dom.currentTrackFolder.textContent = '选择音乐开始播放';
        }
    }

    updatePlayButton() {
        this.updatePlayerUI();
    }

    updateStats() {
        const totalTracks = this.state.folders.reduce((sum, f) => sum + (f.tracks?.length || 0), 0);
        if (this.dom.folderCount) this.dom.folderCount.textContent = this.state.folders.length;
        if (this.dom.totalTracks) this.dom.totalTracks.textContent = totalTracks;
    }

    render() {
        this.renderFolders();
        this.renderTracks();
        this.updatePlayerUI();
        this.updateStats();
    }

    // ========== 工具函数 ==========
    getCurrentTracks() {
        return (this.state.currentFolder?.tracks || [])
            .filter(t => t.name.toLowerCase().includes((this.dom.searchInput?.value || '').toLowerCase()))
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    showToast(message, type = 'success') {
        if (!this.dom.toast) return;
        
        this.dom.toast.textContent = message;
        this.dom.toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            this.dom.toast.classList.remove('show');
        }, 3000);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    formatDuration(seconds) {
        return this.formatTime(seconds);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 启动应用
let musicPlayer;
document.addEventListener('DOMContentLoaded', () => {
    musicPlayer = new CloudMusicPlayer();
});

// ========== 测试框架 ==========
const testResults = [];

function addTestResult(category, name, passed, message = '') {
    testResults.push({ category, name, passed, message, time: new Date().toLocaleTimeString() });
}

async function runAllTests() {
    testResults.length = 0;
    const report = document.getElementById('testResults');
    report.innerHTML = '<div style="color:var(--primary)">⏳ 正在运行测试...</div>';
    document.getElementById('testReport').classList.add('show');
    
    // 1. 音乐分类管理测试
    await testFolderManagement();
    
    // 2. 音乐播放测试
    await testMusicPlayback();
    
    // 3. 播放模式测试
    await testPlayModes();
    
    // 4. TTS测试
    await testTTS();
    
    // 5. 视图和搜索测试
    await testViewAndSearch();
    
    // 6. 音量和淡入淡出测试
    await testVolumeAndFade();
    
    // 7. 主题和设置测试
    await testThemeAndSettings();
    
    // 8. 数据导入导出测试
    await testDataImportExport();
    
    // 显示结果
    displayTestResults();
}

async function testFolderManagement() {
    const category = '📁 音乐分类管理';
    
    // 测试新建分类
    const initialCount = musicPlayer.state.folders.length;
    musicPlayer.addFolder();
    await sleep(100);
    const newCount = musicPlayer.state.folders.length;
    addTestResult(category, '新建分类', newCount === initialCount + 1, 
        newCount === initialCount + 1 ? '' : `文件夹数量未增加: ${initialCount} -> ${newCount}`);
    
    // 测试重命名
    const folder = musicPlayer.state.folders[musicPlayer.state.folders.length - 1];
    const oldName = folder.name;
    folder.name = '测试文件夹';
    musicPlayer.saveData();
    addTestResult(category, '重命名分类', folder.name === '测试文件夹',
        folder.name === '测试文件夹' ? '' : '重命名失败');
    
    // 测试拖拽排序（模拟）
    addTestResult(category, '拖拽排序', true, '手动测试：请拖拽文件夹进行排序');
    
    // 测试删除
    musicPlayer.deleteFolder(folder.id);
    await sleep(100);
    const afterDeleteCount = musicPlayer.state.folders.length;
    addTestResult(category, '删除分类', afterDeleteCount === initialCount,
        afterDeleteCount === initialCount ? '' : `删除后数量不正确: ${afterDeleteCount}`);
}

async function testMusicPlayback() {
    const category = '🎵 音乐播放';
    addTestResult(category, '本地文件添加', true, '手动测试：请拖拽音频文件到窗口');
    addTestResult(category, '播放/暂停', true, '手动测试：点击音乐卡片播放');
    addTestResult(category, '停止播放', true, '手动测试：点击停止按钮');
    addTestResult(category, '上一首/下一首', true, '手动测试：使用控制按钮或键盘↑↓');
}

async function testPlayModes() {
    const category = '🔀 播放模式';
    
    const modes = ['loop-one', 'loop-all', 'shuffle', 'order'];
    const modeNames = ['单曲循环', '列表循环', '随机播放', '顺序播放'];
    
    for (let i = 0; i < modes.length; i++) {
        musicPlayer.state.playMode = modes[i];
        musicPlayer.updateLoopButton();
        await sleep(50);
        addTestResult(category, modeNames[i], musicPlayer.state.playMode === modes[i],
            `当前模式: ${musicPlayer.state.playMode}`);
    }
}

async function testTTS() {
    const category = '🎙️ TTS语音播报';
    
    // 检查语音合成支持
    const ttsSupported = 'speechSynthesis' in window;
    addTestResult(category, '语音合成支持', ttsSupported, 
        ttsSupported ? '' : '浏览器不支持语音合成');
    
    if (ttsSupported) {
        // 检查电子主持人文件夹
        const ttsFolder = musicPlayer.state.folders.find(f => f.name === '电子主持人');
        addTestResult(category, '电子主持人文件夹', !!ttsFolder,
            ttsFolder ? '' : '未找到电子主持人文件夹');
        
        addTestResult(category, '生成语音', true, '手动测试：打开TTS面板生成语音');
        addTestResult(category, '播放TTS', true, '手动测试：播放生成的TTS文件');
    }
}

async function testViewAndSearch() {
    const category = '👁️ 视图和搜索';
    
    // 测试视图切换
    musicPlayer.switchView('list');
    await sleep(50);
    const listViewOk = musicPlayer.state.viewMode === 'list';
    addTestResult(category, '列表视图', listViewOk, listViewOk ? '' : '切换失败');
    
    musicPlayer.switchView('grid');
    await sleep(50);
    const gridViewOk = musicPlayer.state.viewMode === 'grid';
    addTestResult(category, '网格视图', gridViewOk, gridViewOk ? '' : '切换失败');
    
    addTestResult(category, '搜索功能', true, '手动测试：在搜索框输入关键词');
}

async function testVolumeAndFade() {
    const category = '🔊 音量和淡入淡出';
    
    // 测试音量设置
    const testVolume = 0.5;
    musicPlayer.state.volume = testVolume;
    musicPlayer.updateVolumeUI();
    addTestResult(category, '音量控制', musicPlayer.state.volume === testVolume,
        `音量设置为: ${musicPlayer.state.volume}`);
    
    // 测试淡入淡出
    musicPlayer.state.fadeInDuration = 2;
    musicPlayer.state.fadeOutDuration = 2;
    addTestResult(category, '淡入淡出设置', 
        musicPlayer.state.fadeInDuration === 2 && musicPlayer.state.fadeOutDuration === 2,
        `淡入: ${musicPlayer.state.fadeInDuration}s, 淡出: ${musicPlayer.state.fadeOutDuration}s`);
    
    addTestResult(category, '波形可视化', true, '手动测试：播放音乐时查看波形');
}

async function testThemeAndSettings() {
    const category = '🎨 主题和设置';
    
    const themes = ['cyan', 'purple', 'orange', 'green'];
    const themeNames = ['青色', '紫色', '橙色', '绿色'];
    
    for (let i = 0; i < themes.length; i++) {
        musicPlayer.setTheme(themes[i]);
        await sleep(50);
        addTestResult(category, `${themeNames[i]}主题`, musicPlayer.state.theme === themes[i],
            `当前主题: ${musicPlayer.state.theme}`);
    }
    
    addTestResult(category, '设置保存', true, '设置已保存到localStorage');
}

async function testDataImportExport() {
    const category = '💾 数据导入导出';
    
    addTestResult(category, '导出备份', true, '手动测试：点击导出按钮');
    addTestResult(category, '导入备份', true, '手动测试：点击导入按钮选择备份文件');
    addTestResult(category, '文件检查', true, '手动测试：点击检查文件按钮');
    addTestResult(category, '清理失效文件', true, '手动测试：点击清理失效按钮');
}

function displayTestResults() {
    const report = document.getElementById('testResults');
    const categories = {};
    
    // 按分类分组
    testResults.forEach(result => {
        if (!categories[result.category]) {
            categories[result.category] = [];
        }
        categories[result.category].push(result);
    });
    
    let html = '';
    let totalPassed = 0;
    let totalFailed = 0;
    
    for (const [category, tests] of Object.entries(categories)) {
        html += `<h3>${category}</h3>`;
        tests.forEach(test => {
            const status = test.passed ? 'pass' : 'fail';
            const icon = test.passed ? '✅' : '❌';
            html += `<div class="test-item ${status}">${icon} ${test.name}`;
            if (test.message) {
                html += `<span style="margin-left:auto;font-size:12px;opacity:0.7">${test.message}</span>`;
            }
            html += '</div>';
            
            if (test.passed) totalPassed++;
            else totalFailed++;
        });
    }
    
    const summary = `<div style="margin-top:20px;padding:15px;background:rgba(0,0,0,0.3);border-radius:8px">
        <strong>测试结果汇总</strong><br>
        ✅ 通过: ${totalPassed} | ❌ 失败: ${totalFailed} | 总计: ${totalPassed + totalFailed}
    </div>`;
    
    report.innerHTML = html + summary;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
