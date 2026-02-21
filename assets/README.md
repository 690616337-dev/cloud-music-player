# Assets

此目录用于存放应用资源文件：

## 需要的图标文件

- `icon.ico` - Windows 图标 (256x256 或更大)
- `icon.icns` - macOS 图标 (1024x1024)  
- `icon.png` - Linux 图标 (512x512)

## 可选文件

- `installer.nsh` - Windows NSIS 安装程序自定义脚本
- `entitlements.mac.plist` - macOS 权限配置文件

## 生成图标

可以使用在线工具或以下命令生成各平台图标：

```bash
# 安装图标生成工具
npm install -g electron-icon-builder

# 生成图标 (需要准备一张 1024x1024 的源图)
electron-icon-builder --input=./source-icon.png --output=./
```
