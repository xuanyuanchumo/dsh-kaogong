/**
 * scripts/clean-dist.mjs — 构建前清空 dist（cycle-68）
 *
 * 为什么需要：`tsc` **只覆盖同名产物，不删除源已移除的旧文件**。
 * 删掉 `src/server/topicTree.ts` 后，`dist/server/topicTree.js` 仍留着，
 * 并随 npm 包一起发出（实测 v1.34.4 的 tarball 里就带着这个孤儿文件）。
 * 孤儿产物会让「包里有个不存在的模块」这种问题长期潜伏。
 *
 * 只清 dist（产物目录），绝不碰 src / data / docs。
 */
import { rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(repoRoot, '..', 'dist')
const expectDir = resolve(repoRoot, '..', 'dist')

// 安全闸：目标必须严格等于 <仓库根>/dist，防止路径计算错误删到别的目录
if (distDir !== expectDir) {
  console.error('[clean-dist] 拒绝执行：目标不是仓库根的 dist →', distDir)
  process.exit(1)
}
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true })
  console.log('[clean-dist] 已清空 dist →', distDir)
} else {
  console.log('[clean-dist] dist 不存在，跳过')
}
