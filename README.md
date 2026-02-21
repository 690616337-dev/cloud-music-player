# 云褍音乐播放器 - 打包说明文档

## 项目概述

云褍音乐播放器是一款基于 Electron 开发的本地音乐管理应用，支持 Windows、macOS 和 Linux 平台。

## 功能特性

- 🎵 **音乐分类管理**：支持创建多个文件夹分类管理音乐
- 🎙️ **语音播报（TTS）**：使用系统语音合成生成播报音频
- 🎨 **多种主题**：支持青色、紫色、橙色、绿色四种主题
- 📊 **音频可视化**：实时波形显示
- 🔀 **播放模式**：单曲循环、列表循环、随机播放、顺序播放
- ⏯️ **淡入淡出**：支持播放淡入淡出效果
- 📁 **数据导入导出**：支持备份和恢复音乐库
- ⌨️ **快捷键支持**：完整的键盘快捷键操作

## 项目结构

```
cloud-music-player/
├── .github/
│   └── workflows/
│       └── build.yml          # GitHub Actions 自动打包配置
├── assets/                     # 资源文件（图标等）
├── main.js                     # Electron 主进程
├── preload.js                  # 预加载脚本
├── renderer.js                 # 渲染进程（应用逻辑）
├── index.html                  # 主页面
├── styles.css                  # 样式文件
├── package.json                # 项目配置
└── README.md                   # 说明文档
```

## 开发环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发模式

```bash
npm run dev
# 或
npm start
```

### 3. 本地打包测试

```bash
# 打包所有平台
npm run dist

# 仅打包 Windows
npm run dist:win

# 仅打包 macOS
npm run dist:mac

# 仅打包目录（不生成安装包）
npm run pack
```

## 自动打包（GitHub Actions）

项目已配置 GitHub Actions 工作流，支持自动打包和发布。

### 触发条件

1. **推送标签**：推送 `v*` 格式的标签时自动触发打包并创建 Release
2. **手动触发**：在 Actions 页面手动触发工作流
3. **PR 合并**：合并到 main/master 分支时触发测试打包

### 使用步骤

#### 方式一：通过标签发布

```bash
# 1. 提交代码
git add .
git commit -m "版本更新说明"

# 2. 创建标签（遵循语义化版本）
git tag -a v1.0.0 -m "版本 1.0.0"

# 3. 推送标签到 GitHub
git push origin v1.0.0
```

推送标签后，GitHub Actions 会自动：
- 在 Windows 环境下构建 `.exe` 和 `.zip` 文件
- 在 macOS 环境下构建 `.dmg` 和 `.zip` 文件（支持 Intel 和 Apple Silicon）
- 在 Linux 环境下构建 `.AppImage` 和 `.deb` 文件
- 自动创建 Release 并上传所有构建产物

#### 方式二：手动触发

1. 打开 GitHub 仓库页面
2. 点击 "Actions" 标签
3. 选择 "Build and Release" 工作流
4. 点击 "Run workflow" 按钮

### 下载构建产物

打包完成后，可以在以下位置下载：

1. **Release 页面**：推送标签后自动创建的 Release 中
2. **Actions 页面**：每次工作流运行后的 Artifacts 中

## 打包输出文件

### Windows
- `云褍音乐播放器 Setup x.x.x.exe` - NSIS 安装程序
- `云褍音乐播放器 x.x.x.exe` - 便携版
- `云褍音乐播放器-x.x.x-win.zip` - 压缩包

### macOS
- `云褍音乐播放器-x.x.x.dmg` - DMG 安装镜像
- `云褍音乐播放器-x.x.x-mac.zip` - 压缩包

### Linux
- `云褍音乐播放器-x.x.x.AppImage` - AppImage 格式
- `云褍音乐播放器_x.x.x_amd64.deb` - Debian 包

## 注意事项

### macOS 打包

1. **代码签名**：如需分发到 Mac App Store 或避免 Gatekeeper 警告，需要 Apple Developer 账号进行代码签名
2. **公证**：macOS 10.15+ 需要对应用进行公证，配置 `hardenedRuntime` 和 `entitlements`

### Windows 打包

1. **代码签名**：建议购买代码签名证书，避免 SmartScreen 警告
2. **杀毒软件误报**：Electron 应用可能被某些杀毒软件误报，可提交到杀毒软件厂商进行白名单申请

### 图标配置

在 `assets/` 目录下放置以下图标文件：
- `icon.ico` - Windows 图标（256x256 或更大）
- `icon.icns` - macOS 图标（1024x1024）
- `icon.png` - Linux 图标（512x512）

可以使用以下命令生成各平台图标：

```bash
# 使用 electron-icon-builder
npx electron-icon-builder --input=./assets/icon.png --output=./assets
```

## 常见问题

### 1. 打包失败：缺少依赖

```bash
# macOS 需要安装 Xcode 命令行工具
xcode-select --install

# Linux 需要安装额外依赖
sudo apt-get install -y icnsutils graphicsmagick
```

### 2. 应用体积过大

Electron 应用默认包含 Chromium 和 Node.js，体积较大是正常现象。可以通过以下方式优化：
- 使用 `asar` 压缩
- 排除不必要的文件（在 `package.json` 的 `build.files` 中配置）

### 3. 自动更新

如需添加自动更新功能，可以集成 `electron-updater`：

```bash
npm install electron-updater
```

然后在主进程中配置更新逻辑。

## 技术支持

如有问题，请提交 Issue 或联系开发团队。

## 许可证

MIT License
