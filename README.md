# huolibo.github.io

huolibo 的个人知识库 —— 笔记、有趣的链接与收藏。使用 [VitePress](https://vitepress.dev/) 构建，托管在 GitHub Pages。

线上地址：<https://huolibo.github.io>

## 本地开发

```bash
pnpm install
pnpm build:games # 首次/修改棋室代码后生成静态游戏
pnpm dev        # http://localhost:5173
pnpm build      # 构建到 .vitepress/dist
pnpm preview    # 预览构建结果
```

## 目录结构

```
.
├── .vitepress/
│   ├── config.ts          # 站点配置（导航、侧边栏、搜索…）
│   └── theme/             # 主题微调（品牌色、首页渐变）
├── index.md               # 首页
├── notes/                 # 笔记
│   ├── tech/              #   技术
│   └── reading/           #   阅读 / 摘录
├── links/                 # 有趣的链接
├── about.md               # 关于
└── .github/workflows/     # GitHub Actions 自动部署
```

## 发布

推送到 `main` 分支后，GitHub Actions 自动构建并发布。

首次启用：仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 新增内容

- **加一篇笔记**：在 `notes/<分类>/` 下新建 `.md`，并在 `.vitepress/config.ts` 的 `sidebar` 里加链接。
- **加一条链接**：直接在 `links/index.md` 对应分类下加 Markdown 列表项。

## 临席棋室

- `/games`：棋室入口；`/xiangqi/`：中国象棋；`/gomoku/`：五子棋。
- 游戏源码在 `board-games/`。`shared/` 复用界面、WebRTC/二维码和离线缓存逻辑；各游戏独立维护规则、状态与 AI 搜索。
- `pnpm build` 先生成 `public/xiangqi/` 与 `public/gomoku/`，再构建完整 VitePress 站点。生成目录不提交到 Git。
- `pnpm test` 运行两款游戏的规则、重放、悔棋和 AI 测试。
- `pnpm exec playwright install chromium` 后，`pnpm build && pnpm test:browser` 验证浏览器流程。
- 参考调研见 [board-games/RESEARCH.md](board-games/RESEARCH.md)，真机边界见 [board-games/VERIFICATION.md](board-games/VERIFICATION.md)。
- 两端需打开同一种游戏、同一版本。象棋原有 v1/v2 棋谱仍可导入；五子棋棋谱不可导入象棋，反之亦然。

更新时关闭该游戏全部页面后再打开，让已下载的新版本接管；不会在棋局中途强制更新。浏览器存储若被清理，需联网重新下载资源，重要棋谱请及时导出。

## 一次扫码与再来一局（2026-10-17）

快捷联机：双方联网并连接同一 Wi-Fi / 热点，先手“创建快捷邀请”，后手用系统相机或游戏扫码一次（也可打开邀请链接），自动配对且不生成回应码。配对使用固定的免费 PeerServer Cloud；连接成功即断开服务，棋步不经过服务。公网配对服务的可达性不作保证，失败时可切换离线互扫。没有互联网的场景继续使用原双向交换二维码方式。

结束界面提供“再来一局”。联机邀请最多等待 30 秒，对方同意后沿用现有 DataChannel，沿用规则与执棋方、重新计算 AI 配额；拒绝、撤销、超时或断线保留原局。旧局面不会被未确认的新局覆盖。同机一键重开。

本次联机版本升级，双方都需关闭全部游戏页面后重新打开以更新；旧版已保存棋谱继续可读。

浏览器测试中的配对服务位于 `127.0.0.1:4174`，由 Playwright 自动管理，使用官方 PeerServer 作为测试依赖。生产网页不包含服务器；只在点击快捷联机或打开邀请链接时连接公共服务。PeerJS 与运行时传递依赖的许可随静态构建发布。


## Safari 快捷配对兼容与诊断（2026-10-18）

- 联机版本 `2026-10-18.1`：处理同一标签页的邀请 fragment 变化；Safari 复用已有页面时也会自动读取新邀请，配对进行中收到的邀请会等待当前读取结束。
- 快捷联机新增 Cloudflare 免费公共 STUN `stun.cloudflare.com:3478`，帮助发现可用连接地址；仍没有 TURN 中继，不承诺任意网络均能连接。离线互扫继续使用空 ICE servers，不访问公共配对或地址探测服务。
- 分别提示服务连接、交换连接参数、直连阶段；区别服务不可达、邀请失效、没有候选地址和直连失败。诊断提供版本、配对服务状态、ICE 状态和候选数量，可一键复制；不包含 SDP、IP 地址或邀请凭据。
- 自动化新增已有标签页接收邀请和零候选地址故障回归：Chromium 共 25 项、WebKit 快捷联机相关 9 项。CI 在 Linux 运行 Chromium、macOS 运行 WebKit，两组均通过后才发布；本地测试显式禁用公共 STUN，避免依赖外网。
- 两台实体 iPhone 的 Safari 仍需按实际系统版本、路由器/热点和网络权限验收；桌面 WebKit 不是 iPhone 真机测试。
