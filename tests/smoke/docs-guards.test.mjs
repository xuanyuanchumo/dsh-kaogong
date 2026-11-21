/**
 * tests/smoke/docs-guards.test.mjs — 文档/工具输出/白盒静态守卫域（cycle-47 阶段 10 迁移）
 *
 * 从 smoke.test.mjs §12-14 尾段迁移（L2232-2310）：
 *   · RDOC-01（研究文档 23 篇 + 索引存在）/ RDOC-01b（研究 11-15 落地闭环 ≥8/9）
 *   · RDOC-02（文档引用代码符号抽验 ≥5/6——R14 事实基座）
 *   · R-OUT-01..03（六工具标记行 + 三要素 + 写死数字不复活）
 *   · R-OBS-01..03（生命周期量化 cumMs/bootMs/obsCumMs + 对账消费集排除壳路径）
 *   · R-GRAPH-01（搜索回车循环定位）
 *
 * 纯静态段（零 server）。判定逐字等价。
 * 运行：npx vitest run tests/smoke/docs-guards.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

test('RDOC-01 研究文档 23 篇 + 索引全部存在（声明→实体零断链）', () => {
  const rd = path.join(REPO, 'docs', 'research')
  const rdocExpected = ['README.md', '01-PageRank幂迭代与知识点优先级.md', '02-BM25与中文双粒度检索.md', '03-五箱SRS与遗忘曲线.md', '04-力导向布局与知识地图.md', '05-LRU环形缓冲与代际令牌.md', '06-中介中心性与社区发现.md', '07-内容寻址与原子写与Merkle.md', '08-遥测分位数与控制带.md', '09-参考插件技巧实证清单.md', '10-流动语义与桑基思维.md', '11-统一存储与模型自选架构.md', '12-统一题目池与多源抽题.md', '13-kaogong-db统一知识库.md', '14-内核边界契约.md', '15-全局整合分析.md', '16-题库覆盖审计.md', '17-性能研究白盒面板.md', '18-研究迭代闭环T032T033.md', '19-阶段2取题层升级.md', '20-端到端打通与主题适配.md', '21-跨源去重治理.md', '22-IMG04间歇假红根治.md', '23-GitHub开放issue分析与分支治理.md']
  const missing = rdocExpected.filter(f => !fs.existsSync(path.join(rd, f)))
  expect(missing, '缺失研究文档').toEqual([])
})

test('RDOC-01b 研究 11-15 落地闭环：关键断言在已实现代码中可查（≥8/9）', () => {
  const poolDbSrc = readSrc('src/adapters/poolDb.ts')
  const httpSrc34 = readSrc('src/server/http.ts')
  const manifestSrc34 = readSrc('src/shared/manifest.ts')
  const poolRegSrc = readSrc('src/adapters/poolSources.ts')
  const poolObsSrc = readSrc('src/server/poolObservability.ts')
  // R14 六不变量守卫的判据源：旧 smoke.test.mjs 已退役（cycle-47），六不变量守卫
  // 已迁移为 tests/smoke/kgdb.test.mjs + kernel.test.mjs 域文件——判据源同步更新
  const kgdbGuard = fs.readFileSync(path.join(REPO, 'tests', 'smoke', 'kgdb.test.mjs'), 'utf-8')
  const kernelGuard = fs.readFileSync(path.join(REPO, 'tests', 'smoke', 'kernel.test.mjs'), 'utf-8')
  const landing = [
    ['R13 canonical_id qid 优先', poolDbSrc.includes("'q:'") && poolDbSrc.includes("'fp:'") && poolDbSrc.includes("'h:'")],
    ['R13 十表 schema', poolDbSrc.includes('CREATE TABLE IF NOT EXISTS question') &&
      poolDbSrc.includes('CREATE TABLE IF NOT EXISTS relation') &&
      poolDbSrc.includes('CREATE TABLE IF NOT EXISTS question_source') &&
      poolDbSrc.includes('CREATE VIRTUAL TABLE IF NOT EXISTS question_fts')],
    ['R13 FTS5 trigram', poolDbSrc.includes("tokenize='trigram'")],
    ['R13 统一边表 + rel_type', poolDbSrc.includes('REL_TYPES') && poolDbSrc.includes('SAME_AS') && poolDbSrc.includes('BELONGS_TO')],
    ['R14 六不变量守卫', kgdbGuard.includes('SMOKE-KGDB-06c') && kernelGuard.includes('SMOKE-KERNEL-01')],
    ['R15 poolApi 域链位置', httpSrc34.includes('domains.historyApi.handle') &&
      httpSrc34.indexOf('domains.poolApi.handle') > httpSrc34.indexOf('domains.historyApi.handle') &&
      httpSrc34.indexOf('domains.poolApi.handle') < httpSrc34.indexOf('domains.tuxingApi.handle')],
    ['R15 端点已登记 manifest', manifestSrc34.includes("path: '/api/pool/status'") && manifestSrc34.includes("path: '/api/pool/questions'")],
    ['R15 源注册表可扩展', poolRegSrc.includes('SOURCE_REGISTRY') && !/=== 'naoku'/.test(readSrc('src/adapters/poolIngest.ts'))],
    ['R15 白盒健康快照', poolObsSrc.includes('REL_TYPE_META') && poolObsSrc.includes('source:') && poolObsSrc.includes('quality')],
  ]
  const landingHit = landing.filter(x => x[1]).length
  expect(landingHit, `命中 ${landingHit}/9: ` + landing.filter(x => !x[1]).map(x => x[0]).join(',')).toBeGreaterThanOrEqual(8)
})

test('RDOC-02 文档引用代码符号抽验 ≥5/6 真实存在（R14 事实基座）', () => {
  const graphAnalytics = readSrc('src/client/graph/graph-analytics.ts')
  const huasheng13 = readSrc('src/adapters/huasheng13.ts')
  const srsSrc = readSrc('src/server/srs.ts')
  const physicsSrc = readSrc('src/client/graph/graph-physics.ts')
  const httpSrc19 = readSrc('src/server/http.ts')
  const factChecks = [
    ['graphLocalPageRank', graphAnalytics.includes('export function graphLocalPageRank')],
    ['BM25_K1=1.2', huasheng13.includes('BM25_K1 = 1.2')],
    ['五箱 SRS mastered', srsSrc.includes('mastered')],
    ['KG_FLOW_RELS', physicsSrc.includes('KG_FLOW_RELS')],
    ['UNMATCHED_BUCKET', httpSrc19.includes('UNMATCHED_BUCKET')],
    ['五停渐变 GRAPH_SEQ_STOPS', graphAnalytics.includes('GRAPH_SEQ_STOPS')],
  ]
  const factHit = factChecks.filter(x => x[1]).length
  expect(factHit, '命中 ' + factHit + '/6: ' + factChecks.filter(x => !x[1]).map(x => x[0]).join(',')).toBeGreaterThanOrEqual(5)
})

test('R-OUT-01..03 六工具标记行接线 + 三要素 + 写死数字不复活', () => {
  const hostSrc = readSrc('src/host/index.ts')
  const toolCount = (hostSrc.match(/ctx\.tools\.register\(/g) || []).length
  const tailCount = (hostSrc.match(/kgMarkTail\(/g) || []).length
  expect(toolCount, '工具注册数').toBeGreaterThanOrEqual(6)
  expect(tailCount, '标记行调用数').toBeGreaterThanOrEqual(toolCount)
  expect(/`\[kaogong v\$\{.*version.*\} · 服务:\$\{.*up.*\} · ws:\$\{.*\}\]`/.test(hostSrc.replace(/\n/g, '')) ||
    (hostSrc.includes('服务:') && hostSrc.includes('ws:'))).toBe(true)
  expect(hostSrc.includes('363MB'), '体积类写死数字复活').toBe(false)
})

test('R-OBS-01..03 生命周期量化 + 对账消费集排除壳路径', () => {
  const httpSrc19 = readSrc('src/server/http.ts')
  const physicsSrc = readSrc('src/client/graph/graph-physics.ts')
  const obsView = readSrc('src/client/views/obs-view.tsx')
  const clientSrc = readSrc('src/client/client.tsx')
  expect(httpSrc19.includes('cumMs') && httpSrc19.includes('bootMs')).toBe(true)
  expect(physicsSrc.includes('KG_FLOW_RELS') && obsView.includes('obsCumMs')).toBe(true)
  // ㊞（cycle-19）：对账消费集排除 UI 壳（/ 与 /index.html）与 __unmatched__ 聚合桶
  expect(httpSrc19.includes("'/'") || httpSrc19.includes('index.html')).toBe(true)
  expect(clientSrc.includes('__unmatched__') || httpSrc19.includes('__unmatched__')).toBe(true)
})

test('R-GRAPH-01 搜索回车循环定位（keepQuery + 循环提示）', () => {
  const gv = readSrc('src/client/views/graph-view.tsx')
  expect(gv.includes('keepQuery') || /循环|已到末尾|回到第一个/.test(gv)).toBe(true)
})
