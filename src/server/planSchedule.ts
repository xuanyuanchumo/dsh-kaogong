/**
 * server/planSchedule.ts — 学习计划智能排程域（cycle-30 T-027 清偿，从 ROADMAP 待办）
 *
 * 目标（T-027）：按「剩余天数 + 各模块正确率 + 错题积压」自动排程——
 * 30 天四阶段静态日历的任务侧重按学习者画像加权重排，弱点加权复用 SRS 的 1/(rate+0.15) 模型。
 *
 * 数学模型（确定性纯函数，无随机、无时钟依赖——同输入两次输出深相等）：
 *   弱度 w(m) = 1/(rate(m)+0.15)          —— SRS 同源权重（越弱越密；rate ∈ [0,1]）
 *   错题积压 b(m) = 未掌握错题数 / 全部未掌握  —— 错题占比归一
 *   综合权重 W(m) = w(m) × (1 + b(m))      —— 弱度 × 积压放大（错题多的弱模块最优先）
 *   日配额 focus(m|d) = W(m) / ΣW          —— 按天 softmax 分配训练侧重
 * 排程语义：不改日历结构（阶段/天数是模板事实），只重排每日任务的「模块侧重标注 +
 * 建议题量分配」——静态计划与动态画像解耦，原计划文本不动（可解释、可回退）。
 *
 * 崩溃安全：输入形状不符一律返回 { error }（HTTP 200），绝不向路由层冒泡。
 */

const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** 模块弱度：1/(rate+0.15)（SRS 同源；无数据模块给最高弱度 1/0.15≈6.67——新模块优先接触） */
function weaknessOf(rate: any): number {
  const r = (typeof rate === 'number' && isFinite(rate)) ? Math.max(0, Math.min(1, rate)) : 0
  return 1 / (r + 0.15)
}

/**
 * 智能排程：输入 plan 结构（parsePlanStructure 输出：phases/days）+ 画像
 * （byModule: {模块: {answered, correct}}）+ wrongBook 未掌握集 → 每日侧重标注 + 题量分配。
 * @returns {schedule: [{day, title, phase, tasks, focus: [{module, weight, suggested}]}], profile}
 */
export function schedulePlan(plan: any, byModule: any, wrongBook: any[]): any {
  try {
    const days: any[] = (plan && Array.isArray(plan.days)) ? plan.days : []
    if (!days.length) return { error: '计划为空（study-plan.md 未就绪）' }

    // ── 模块画像与综合权重 ──
    const mods = entries(byModule || {}).map(([m, v]: any) => {
      const answered = v.answered || 0
      const rate = answered ? (v.correct || 0) / answered : null   // null=无数据（新模块）
      return { module: m, answered, rate, weakness: weaknessOf(rate) }
    })
    // 错题积压：未掌握错题按模块计数（错题本条目形如 {module, mastered}）
    const openWrong: any = {}
    let openTotal = 0
    for (const w of (Array.isArray(wrongBook) ? wrongBook : [])) {
      if (!w || w.mastered) continue
      const m = String(w.module || '未知')
      openWrong[m] = (openWrong[m] || 0) + 1
      openTotal++
    }
    // 综合权重 W = weakness × (1 + backlogShare)；无画像时（全新用户）六模块均匀
    const hasProfile = mods.some(m => m.answered > 0)
    const allModules = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断', '政治理论']
    const basis: any[] = hasProfile
      ? mods.map(m => ({ module: m.module, W: m.weakness * (1 + (openTotal ? (openWrong[m.module] || 0) / openTotal : 0)), rate: m.rate, backlog: openWrong[m.module] || 0 }))
      : allModules.map(m => ({ module: m, W: 1, rate: null, backlog: openWrong[m] || 0 }))
    const sumW = basis.reduce((s, x) => s + x.W, 0) || 1
    // 排序：W 降序（最弱+积压最多在前）
    basis.sort((a, b) => b.W - a.W || String(a.module).localeCompare(String(b.module)))

    // ── 每日侧重：按天轮转 basis（确定性；第 d 天主攻 basis[d % basis.length]），
    //    建议题量按 softmax 比例分配到当天 30 题默认预算（可被用户日任务覆盖）。
    const schedule = days.map((d, i) => {
      const primary = basis[i % basis.length]
      const focus = basis.map(x => ({
        module: x.module,
        weight: +(x.W / sumW).toFixed(4),
        suggested: Math.max(0, Math.round(30 * x.W / sumW)),
        primary: x.module === primary.module,
      })).filter(x => x.suggested > 0)
      return {
        day: d.day, title: d.title, phase: d.phase, tasks: d.tasks || [],
        focus,
        primary: primary.module,
        primaryRate: typeof primary.rate === 'number' ? Math.round(primary.rate * 100) + '%' : '新模块',
        backlog: primary.backlog,
      }
    })

    return {
      schedule,
      profile: {
        hasProfile,
        modules: basis.map(x => ({ module: x.module, rate: typeof x.rate === 'number' ? Math.round(x.rate * 100) + '%' : null, backlog: x.backlog, W: +x.W.toFixed(3) })),
        openWrong: openTotal,
        strategy: hasProfile ? '弱点×积压加权（SRS 同源 1/(rate+0.15)，错题占比放大）' : '均匀轮转（无作答画像，先广度后深度）',
      },
    }
  } catch (e: any) {
    return { error: `排程失败: ${e && e.message ? e.message : String(e)}` }
  }
}
