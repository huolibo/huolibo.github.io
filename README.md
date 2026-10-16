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
