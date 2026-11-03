# 性能基线（E5 工件通道）
采样环境: 127.0.0.1 宿主进程内 (pid 见 runtime.json) · 2026-11-02 · 每端点 5 次取最差值(ms)

| 端点 | 基线最差值 | 阈值(×3, 封顶400) |
|------|-----------|-------------------|
| /api/status | 50 | 150 |
| /api/banks | 4 | 12 |
| /api/modules | 6 | 18 |
| /api/plan | 2 | 6 |
| /api/graph | 12 | 36 |
| /api/telemetry | 1 | 3 |
| /api/capabilities | 1 | 3 |
| /api/workspaces | 2 | 6 |
| /api/methods | 2 | 6 |
| /api/search | 112 | 336 |

全局断言：任意端点遥测 p95 < 400ms（config.performance_baselines 脚本自证）。
冷启动约束：startServer 全区间探测+绑定 < 3s。
内存约束：遥测环形(100×端点数) + requests 滑窗(1000) + lifecycle(300行)，稳态 < 10MB。
