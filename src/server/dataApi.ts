/**
 * server/dataApi.js — 数据查询域（v1.3 复杂度拆分自 http.js）
 * banks/modules/plan/search/method/methods 五个只读查询端点。
 */
import { join } from 'node:path'
import { REPOS, XINGCE_MODULES, METHOD_MAP, exists, safeReadDir, safeReadFile, searchKnowledge, getMethodRef, parsePlanStructure } from '../adapters/repoData.js'

/** 学习计划（结构化 + 单日聚焦），graph 域亦复用 */
export function makeStudyPlan(planFile) {
  return function studyPlan(day) {
    const content = safeReadFile(planFile, 100000)
    if (!content) return { plan: '学习计划文件未找到', raw: '', phases: [], days: [] }
    const structured = parsePlanStructure(content)
    if (!day || day === 'all') return { ...structured, raw: content }
    const dayObj = structured.days.find(d => d.day === +day) || null
    return { ...structured, current: dayObj, raw: dayObj ? (content.match(new RegExp(`### 第${day}天[\\s\\S]*?(?=\\n### |\\n## |$)`)) || [''])[0] : `未找到第 ${day} 天的计划` }
  }
}

export function makeDataApi({ repoRoot, planFile }) {
  const studyPlan = makeStudyPlan(planFile)

  return function handleDataApi(path, params, post, method) {
    if (path === '/api/banks') {
      const banks: any = {}
      for (const [key, desc] of Object.entries(REPOS as Record<string, string>)) banks[key] = { desc, exists: exists(join(repoRoot, key)) }
      const ready = (Object.values(banks) as any[]).filter((b: any) => b.exists).length
      return { banks, total: Object.keys(REPOS).length, ready }
    }
    if (path === '/api/modules') {
      const modules: any = {}
      for (const [name, dir] of Object.entries(XINGCE_MODULES)) {
        const mp = join(repoRoot, 'xingcezhenti', dir)
        modules[name] = { dir, fileCount: exists(mp) ? safeReadDir(mp).filter(f => f.endsWith('.md')).length : 0 }
      }
      return { modules }
    }
    if (path === '/api/plan') return studyPlan(params.get('day') || 'all')
    if (path === '/api/search') return { results: searchKnowledge(repoRoot, params.get('q') || '', params.get('repo') || '') }
    if (path === '/api/method') return getMethodRef(repoRoot, params.get('topic') || post.topic || '')
    if (path === '/api/methods') {
      return { topics: Object.keys(METHOD_MAP).map(t => ({ id: t, label: t, file: METHOD_MAP[t], exists: exists(join(repoRoot, 'kaogong-skill', 'skills', 'kaogong', 'references', METHOD_MAP[t])) })) }
    }
    return undefined
  }
}
