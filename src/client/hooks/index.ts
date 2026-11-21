/**
 * client/hooks/index.ts — 自定义 hooks barrel 出口（cycle-48 阶段 2）
 *
 * 一 hook 一文件（useApiData.ts / useApiMany.ts）+ barrel 统一出口——视图只
 * import { useXxx } from '../hooks/index.js'。React 经 ui-kit 导入链获取
 * （C24-06 单 require 纪律）；hooks/ 属 client/ 基建层。
 *
 * ⚠️ bundler 形态纪律（C29 教训复现）：**禁用 `export { x } from '...'`（export-from
 * 带源形态）**——bundler 的 collectExports 只认 `function|class|const|let|var` 声明，
 * export-from 被剥成孤立 `from '...';` 残行且重导出的函数体不进依赖图（本轮实测
 * render 旅程全 skipped 的根因）。正解 = import + 独立 export（ui-kit `export { React }`
 * 同款已验证形态）。
 */
import { useApiData } from './useApiData.js'
import { useApiMany } from './useApiMany.js'
export { useApiData, useApiMany }
