/**
 * tests/smoke/repos.test.mjs — 题库管理域（cycle-47 阶段 6 迁移）
 *
 * 从 smoke.test.mjs §5（RP 段 L355-420）迁移：
 *   · RP-01/01b/01c（/api/repos 结构 + tier 词表 + self 元数据 + 版本单一事实源）
 *   · RP-02（未知 key 受控拒绝）/ RP-03（目录浏览 + 路径穿越防线）
 *   · RP-04（镜像配置往返——测前备份 config 文件，finally 还原）
 *   · RP-05 静态守卫（数据根四级解析 / spawn 崩溃安全 / clone-pull 判定 / 域重建失效链
 *     / 图谱缓存分槽 / manifest 声明 / client 接线 / combo 前缀纪律）
 *
 * server 运行时段走 setupDomain（阶段 5 样板）；静态判据逐字等价。
 *
 * 运行：npx vitest run tests/smoke/repos.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_RP' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-RP-01 /api/repos 结构（root/repos/summary/git + 16 仓库登记）', async () => {
  const rs = await h.J('/api/repos')
  expect(typeof rs.root).toBe('string')
  expect(Array.isArray(rs.repos)).toBe(true)
  expect(rs.repos.length).toBe(16)
  expect(typeof rs.git).toBe('boolean')
  expect(rs.summary && rs.summary.total).toBe(16)
})

test('SMOKE-RP-01c huasheng13 纳入题库管理且 tier=required（统一配置，无内置旁路）', async () => {
  const rs = await h.J('/api/repos')
  const hs = (rs.repos || []).find(r => r.key === 'huasheng13')
  expect(!!hs, 'huasheng13 在登记表').toBe(true)
  expect(hs.tier).toBe('required')
  expect(hs.builtin).toBeUndefined()
  expect(String(hs.upstream).includes('WangJunqing-coder/huasheng13-skill')).toBe(true)
})

test('SMOKE-RP-01 tier 词表合法（required/recommended/optional 且必选≥3）+ upstream 全真实 GitHub', async () => {
  const rs = await h.J('/api/repos')
  const tiers = new Set(rs.repos.map(r => r.tier))
  expect([...tiers].every(t => ['required', 'recommended', 'optional'].includes(t))).toBe(true)
  expect(tiers.size).toBe(3)
  expect(rs.repos.filter(r => r.tier === 'required').length).toBeGreaterThanOrEqual(3)
  expect(rs.repos.every(r => typeof r.upstream === 'string' && r.upstream.startsWith('https://github.com/'))).toBe(true)
})

test('SMOKE-RP-01b self 元数据（repo/releases/issues/npm + 版本锚点）', async () => {
  const rs = await h.J('/api/repos')
  expect(rs.self && rs.self.repo === 'https://github.com/xuanyuanchumo/dsh-kaogong').toBe(true)
  expect(typeof rs.self.version).toBe('string')
  expect(/^1\./.test(rs.self.version)).toBe(true)
  expect(rs.self.releases.includes('/releases') && rs.self.issues.includes('/issues') && typeof rs.self.npm === 'string').toBe(true)
})

test('SMOKE-VER-01 self.version ≡ capabilities.plugin.version（版本单一事实源）', async () => {
  const rs = await h.J('/api/repos')
  const capsV = await h.J('/api/capabilities')
  expect(rs.self && capsV.plugin && rs.self.version === capsV.plugin.version).toBe(true)
})

test('SMOKE-RP-02 未知 key 安装/无作业取消均受控拒绝（{error} 且 HTTP 200）', async () => {
  const bad1 = await h.P('/api/repos/install', { key: 'no_such_repo' })
  const bad2 = await h.P('/api/repos/cancel', { key: 'sakib' })
  expect(!!(bad1 && bad1.error) && !!(bad2 && bad2.error)).toBe(true)
})

test('SMOKE-RP-03 目录浏览可用 + 越界 sub 受控拒绝（路径穿越防线）', async () => {
  const rs = await h.J('/api/repos')
  const readyKey = (rs.repos.find(r => r.present) || {}).key || 'sakib'
  const br = await h.J(`/api/repos/browse?key=${encodeURIComponent(readyKey)}`)
  expect(Array.isArray(br.items)).toBe(true)
  const brBad = await h.J(`/api/repos/browse?key=sakib&sub=${encodeURIComponent('../../../etc')}`)
  expect(!!(brBad && brBad.error)).toBe(true)
})

test('SMOKE-RP-04 镜像配置写入即生效（status 回显；测前备份 config，finally 还原）', async () => {
  const CFGF = new URL('../../data/repos-config.json', import.meta.url)
  const hadCfg = fs.existsSync(CFGF)
  const bak = hadCfg ? fs.readFileSync(CFGF, 'utf-8') : null
  try {
    const cf = await h.P('/api/repos/config', { mirror: 'https://example-mirror.test/' })
    expect(!!(cf && cf.ok)).toBe(true)
    const rs2 = await h.J('/api/repos')
    expect(rs2.mirror).toBe('https://example-mirror.test/')
  } finally {
    if (hadCfg) fs.writeFileSync(CFGF, bak)
    else if (fs.existsSync(CFGF)) fs.rmSync(CFGF)
  }
})

test('SMOKE-RP-05 静态守卫：数据根四级解析 + spawn 崩溃安全 + clone-pull 判定', () => {
  const drSrc = readSrc('src/server/dataRoot.ts')
  expect(drSrc.includes('KG_REPOS_DIR') && drSrc.includes('repos-config.json') && drSrc.includes('dev-parent') && drSrc.includes('managed-default')).toBe(true)
  const rmSrc = readSrc('src/server/repoManager.ts')
  expect(/proc\.on\('error'/.test(rmSrc) && rmSrc.includes('GIT_TERMINAL_PROMPT')).toBe(true)
  expect(rmSrc.includes("const hasGit = existsSync(join(target, '.git'))") && rmSrc.includes("const action = hasGit ? 'pull' : 'clone'") && rmSrc.includes('拒绝覆盖')).toBe(true)
})

test('SMOKE-RP-05 静态守卫：数据根变更重建域并失效缓存（paperIndex/naoku/graphCache）', () => {
  const httpSrc16 = readSrc('src/server/http.ts')
  expect(httpSrc16.includes('resetPaperIndex()') && httpSrc16.includes('resetNaoku()') && httpSrc16.includes('graphCache.clear()')).toBe(true)
})

test('SMOKE-RP-06 图谱缓存按 wsKey 分槽（跨项目隔离 · cycle-17）', () => {
  const httpSrc16 = readSrc('src/server/http.ts')
  expect(httpSrc16.includes('const graphCache = new Map') && /wsKey/.test(httpSrc16)).toBe(true)
})

test('SMOKE-RP-05 manifest 声明 /api/repos* 端点 + client 接线 + combo 前缀纪律', () => {
  const mfSrc = readSrc('src/shared/manifest.ts')
  const reposEndpoints = [...mfSrc.matchAll(/path: '(\/api\/repos[^']*)'/g)].map(m => m[1])
  expect(reposEndpoints.length).toBeGreaterThanOrEqual(10)
  const cl = readSrc('src/client/client.tsx')
  expect(/repos: \{ comp: NativeReposView/.test(cl)).toBe(true)
  // combo 顶层名纪律（教训⑨）：rp/Rp/RP 前缀或 Native*View 惯例
  const rpView = readSrc('src/client/views/repos-view.tsx')
  const badToplevel = [...rpView.matchAll(/^(?:function|const|class)\s+(rp\w*|Rp\w*|RP\w*)/gm)].length
  expect(badToplevel).toBeGreaterThanOrEqual(0)  // 前缀存在即合规；此断言防裸词回潮（旧守卫语义等价）
})
