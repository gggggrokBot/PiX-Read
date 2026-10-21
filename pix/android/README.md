# PiX-Read Android

基于 Capacitor 的安卓壳：复用现有 Vue 3 + Vuetify 渲染层，通过 WebView 运行。

## 当前能力与缺口（请先读）

### 已具备

- 导入 PDF 到虚拟资料库（IndexedDB），内嵌 pdf.js 连续阅读
- 笔记、阅读现场、会话列表的本地持久化（localStorage / IndexedDB）
- 轻量对话运行时：在 WebView 内直连 OpenAI 兼容 / Anthropic / Google 等 HTTP API
- 阅读工具 `pdf_read_pages` / `pdf_outline` 的浏览器实现（pdf.js 文本层）
- 手机底栏导航（资料库 / 阅读 / 对话 / 笔记）与窄屏浮层

### 明确未移植（不要当成完整 Electron）

- **没有** Electron 主进程 / `SessionBridge` / `pi-coding-agent` 完整内核
- **没有** MCP、编码工具、takeHerEyes 视觉预处理、系统目录资料库
- OAuth 登录不可用，请在设置里填 API Key
- 自动更新走应用商店 / 自行安装 APK，设置页的检查更新会提示不可用

## 环境要求

- Node.js 20+（仓库声明 22.19+ 更佳）
- Android Studio Ladybug+ 或等价 cmdline-tools
- JDK 21（与 Capacitor 7 / AGP 匹配）
- Android SDK 35+

## 构建步骤

在仓库根目录安装依赖后，进入 `pix/`：

```bash
# 1) 安装（根目录 workspaces + pix 本地依赖）
cd /path/to/PiX-Read
npm install --ignore-scripts
cd pix
npm install --ignore-scripts

# 2) 构建 Web 资源并同步到 android/
npm run android:sync

# 3a) Android Studio
npm run android:open
# 然后 Run → app

# 3b) 命令行 Debug APK
cd android
./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

仅预览前端（浏览器，无原生插件）：

```bash
cd pix
npm run dev:web
```

## 开发同步

改完 Vue/TS 后重新执行：

```bash
npm run android:sync
```

`webDir` 指向 `dist/renderer`。不要手改 `android/app/src/main/assets/public/`，它会被 sync 覆盖。

## 架构说明

| 层 | 路径 | 说明 |
| --- | --- | --- |
| 平台契约 | `src/shared/pix-api.ts` | `PixApi` 接口，Electron / Web 共用 |
| Electron 实现 | `src/main/preload.ts` | IPC → 主进程 |
| Web/Android 实现 | `src/renderer/platform/web/*` | 虚拟资料库 + LiteSession |
| 安装入口 | `src/renderer/platform/install.ts` | 无 `window.pixApi` 时注入 Web 适配器 |
| 原生壳 | `android/` | Capacitor 生成，勿当业务源码大改 |

## 故障排查

- **白屏**：先 `npm run build:renderer`，确认 `dist/renderer/index.html` 存在，再 `npx cap sync android`
- **CJK 乱码**：确认 `public/pdfjs/cmaps` 已由 `npm run sync:pdfjs` 生成并打进包
- **LLM 请求失败**：多为 CORS 或 Key 无效；真机 WebView 直连公网 API 一般比桌面浏览器宽松，但仍取决于厂商网络策略
