/**
 * vitest 配置（cycle-47 测试分域重构）
 *
 * include：tests/**（分域冒烟 + 未来 unit/）——exclude：tests/e2e/（loader.test
 * 为 node 直跑形态，无 test suite 结构，vitest 聚合会报「No test suite found」；
 * 其独立性由 npm run test:loader 专项承担——DSH 测试策略：e2e 车道分离于单元车道）。
 *
 * 环境隔离：不 mock fetch（冒烟走真实 server 127.0.0.1:8495+）；单线程
 * （fileParallelism: false——分域文件共享用户数据根与端口段，串行消除写竞态，
 * 实测并发下 HIST 域 progress 覆盖假红）。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    fileParallelism: false,   // 分域文件共享用户数据根 + 8495 端口段 → 串行（竞态防线）
    testTimeout: 120_000,     // 池自检重建（小样本）可达 60s+，放宽到 120s
    hookTimeout: 120_000,
    reporters: ['default'],
  },
})
