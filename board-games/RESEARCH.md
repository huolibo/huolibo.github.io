# 五子棋参考调研

调研日期：2026-10-16。先查阅公开仓库，再实现本仓库代码。

| 项目 | 查阅内容与启发 | 本项目的选择 |
| --- | --- | --- |
| [lihongxun945/gobang](https://github.com/lihongxun945/gobang) | README 说明纯前端本地搜索、极小化极大搜索、Alpha-Beta、迭代加深与限时测试。 | 使用 JavaScript 限时搜索；采用启发式候选，不宣称最优或专业棋力。 |
| [doodlewind/gomoku](https://github.com/doodlewind/gomoku) | README 说明 minimax、Alpha-Beta 与 Web Worker。 | 复用临席象棋已有 Worker 和主线程兜底机制。 |
| [SCOOP007/gomoku-ai](https://github.com/SCOOP007/gomoku-ai) | README 与 `src/engine/ai.ts` 展示棋盘/规则/搜索分离、立即取胜与堵对方下一手获胜的优先级。 | 独立实现五格窗口评估、迭代加深搜索，增加四方向、跨边界、断四、限时回退与输入不变测试。 |

以上仅作功能与算法思路参考；未复制这些仓库的实现、图片或样式，也未将其引擎作为依赖。通用搜索算法不是本项目独创。运行时第三方依赖仍只有 `qrcode-generator` 与 `jsQR`，许可在每款游戏的 `THIRD_PARTY_NOTICES.txt` 中。

## 实现边界

- 15×15，无禁手自由五子棋：黑先，五子及以上连线胜，满盘无胜者和。
- 双人同机、WebRTC 附近直连；限次 AI 建议而非自动人机对战。
- 复用象棋的配对、二维码、存档、30 秒悔棋同意与断线恢复界面；棋盘、规则和搜索模块独立。
- AI 默认未配置。启用本地引擎后在 Worker 搜索，主线程始终保留合法候选；不是云端大模型。
- PWA 与本机存档按游戏隔离，连接码包含游戏类型，禁止跨游戏配对。
- 静态构建并入现有 VitePress / GitHub Pages 流程，无需新增后端服务。
