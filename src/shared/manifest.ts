/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/**
 * manifest.js — 能力注册清单（单一事实源）+ 图算法
 *
 * 白盒透明化核心：声明插件全部能力的「注册 → 生产 → 消费」映射，
 * server / host 工具 / client 视图三方共用，供 /api/capabilities 与
 * /api/graph 输出连通性分析（孤儿检测、PageRank 中心性、健康度评分）。
 *
 * 数据结构与算法：
 *  - 有向图 G=(V,E)，边类型 contains/produces/consumes/registers
 *  - PageRank 幂迭代 (d=0.85, iter=40, ε=1e-6)：节点重要性
 *  - 图密度 ρ = |E| / (|V|·(|V|-1))：连通紧密度
 *  - 连通分量（弱连通, Union-Find）：孤岛检测
 *  - 健康度 H = Σ wᵢ·mᵢ（加权几何平均→算术平均，可解释）
 */

// ── 能力清单（与 index.js / client.js / ui 实际注册保持同步）──
export const CAPABILITIES = {
  plugin: { id: 'kaogong', name: 'dsh-kaogong', version: '1.27.0', mode: 'offline-first' },

  // 宿主 UI 双入口（client 半注册；图谱与可观测面板消费此声明）
  entries: [
    { id: 'panel', kind: 'left-immersive', slots: ['sidebar.panellist', 'main'], desc: '左栏图标 + 中央全屏原生面板（同源路由渲染）' },
    { id: 'tab', kind: 'right-docked', slots: ['sidebar.right.pane.tab', 'guide'], desc: '右侧边栏标签并排原生面板' },
  ],

  // 传输通道（v1.4：宿主同源为主，独立端口为兜底）
  channels: [
    { id: 'same-origin', via: 'ctx.webServer', mount: '/kaogong', desc: '宿主 GUI 同源路由（零 CORS、无端口依赖）', preferred: true },
    { id: 'standalone', via: 'node:http', mount: '127.0.0.1:8400-8404', desc: '独立回环端口（Electron/降级/测试兜底）', preferred: false },
  ],

  // 生命周期阶段（host 插件从加载到卸载的状态流）
  lifecycle: [
    { stage: 'load', desc: '模块导入' },
    { stage: 'apply', desc: 'apply(ctx) 执行' },
    { stage: 'server-start', desc: 'HTTP 服务绑定/端口发现' },
    { stage: 'tools-register', desc: '6 个 AI 工具注册' },
    { stage: 'runtime-publish', desc: 'runtime.json 信标写入' },
    { stage: 'serve', desc: '稳态服务' },
    { stage: 'cleanup', desc: 'effect 卸载关闭服务' },
  ],

  // 服务端点（生产者）
  endpoints: [
    { path: '/api/status', label: '信标·状态', consumers: ['ui:header', 'client:discovery', 'tool:kaogong_launch', 'tool:kaogong_ai_*'] },
    { path: '/api/banks', label: '题库清单', consumers: ['ui:dashboard'] },
    { path: '/api/modules', label: '模块索引', consumers: ['ui:practice'] },
    { path: '/api/questions', label: '抽题(含SRS)', consumers: ['ui:practice', 'ui:wrongbook'] },
    { path: '/api/check', label: '判分+错题收集', consumers: ['ui:practice', 'ui:wrongbook'] },
    { path: '/api/wrong', label: '错题清单', consumers: ['ui:wrongbook'] },
    { path: '/api/wrong/remove', label: '错题移除', consumers: ['ui:wrongbook'] },
    { path: '/api/stats', label: '学习统计', consumers: ['ui:dashboard', 'ui:wrongbook'] },
    // cycle-13 省份维度：/api/papers 新增 province 查询参数（省考卷=省级目录名、国考卷=「全国」）；
    // 响应透出 provinces facet（[{name,total,minYear,maxYear,subjects}]，码点升序）——端点路径不变，避免口径漂移
    { path: '/api/papers', label: '真题卷列表', consumers: ['ui:papers'] },
    { path: '/api/paper', label: '单卷详情(材料+题+答案)', consumers: ['ui:papers', 'ui:essay'] },
    { path: '/api/topics', label: '专题聚合', consumers: ['ui:topics'] },
    { path: '/api/essay/list', label: '申论题目聚合', consumers: ['ui:essay'] },
    { path: '/api/essay/grade', label: '申论离线评分', consumers: ['ui:essay', 'tool:kaogong_ai_shenlun'] },
    { path: '/api/essay/history', label: '申论历史', consumers: ['ui:essay', 'ui:dashboard'] },
    { path: '/api/essay/article', label: '大作文分档评估', consumers: ['ui:essay'] },
    { path: '/api/paper-img', label: '题目配图服务', consumers: ['ui:papers', 'ui:practice', 'ui:deepbank'] },
    // cycle-22：kg-img 占位配图服务补登记（cycle-21 起服务端已实现、RichText 已消费，但漏声明 → 能力对账假漂移）
    { path: '/api/kg-img', label: '题库占位配图服务(kgimg://)', consumers: ['ui:practice', 'ui:deepbank', 'ui:topics'] },
    { path: '/api/paper/exam/start', label: '整卷模考开始', consumers: ['ui:exam'] },
    { path: '/api/paper/exam/submit', label: '整卷模考交卷', consumers: ['ui:exam'] },
    { path: '/api/paper/exam/history', label: '模考历史', consumers: ['ui:exam', 'ui:dashboard'] },
    { path: '/api/naoku/status', label: '深度题库状态', consumers: ['ui:deepbank'] },
    { path: '/api/naoku/questions', label: '深度标注抽题', consumers: ['ui:deepbank', 'ui:topics'] },
    { path: '/api/naoku/kadian', label: '知识点检索', consumers: ['ui:deepbank'] },
    { path: '/api/naoku/practice', label: '按知识点刷题', consumers: ['ui:deepbank'] },
    { path: '/api/naoku-img', label: '深度题库配图服务', consumers: ['ui:deepbank', 'ui:practice'] },
    { path: '/api/naoku/papers', label: '考点→试卷反查', consumers: ['ui:papers', 'ui:topics'] },
    { path: '/api/naoku/categories', label: '考点清单', consumers: ['ui:papers', 'ui:deepbank'] },
    // cycle-21 数据外置白盒端点（issue #2）：用户数据根位置 / 迁移状态 / 包内残留透出
    { path: '/api/data-location', label: '数据位置白盒', consumers: ['ui:repos', 'ui:observability'] },
    { path: '/api/tuxing/cats', label: '图形推理规律分类', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing/list', label: '图形推理抽题', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing/q', label: '图形推理单题详情', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing-img', label: '图形推理配图', consumers: ['ui:tuxing'] },
    { path: '/api/plan', label: '学习计划', consumers: ['ui:plan'] },
    { path: '/api/search', label: '知识检索', consumers: ['ui:search', 'tool:kaogong_ai_tutor'] },
    // cycle-13：专题枢纽方法论分区消费（ui:topics）——声明口径与实际消费方一致
    { path: '/api/method', label: '方法论', consumers: ['ui:method', 'ui:topics', 'tool:kaogong_ai_tutor', 'tool:kaogong_ai_shenlun'] },
    { path: '/api/methods', label: '方法论目录', consumers: ['ui:method', 'ui:topics'] },
    { path: '/api/progress', label: '进度', consumers: ['ui:dashboard', 'ui:plan', 'tool:kaogong_ai_plan'] },
    // cycle-15 专项刷题记忆：按工作区命名空间隔离的「上次练到 xx 的 xx 题」；
    // 消费方=三个专项视图（刷题/图形推理/深度题库），进入视图时读、翻题时写
    { path: '/api/memory', label: '专项刷题记忆', consumers: ['ui:practice', 'ui:tuxing', 'ui:deepbank'] },
    // cycle-16 题库管理：原始仓库一键安装/更新/删除/浏览/自定义数据根/镜像代理
    { path: '/api/repos', label: '题库状态总览', consumers: ['ui:repos'] },
    { path: '/api/repos/install', label: '题库安装/更新', consumers: ['ui:repos'] },
    { path: '/api/repos/job', label: '题库作业查询', consumers: ['ui:repos'] },
    { path: '/api/repos/cancel', label: '题库作业取消', consumers: ['ui:repos'] },
    { path: '/api/repos/remove', label: '题库删除', consumers: ['ui:repos'] },
    { path: '/api/repos/browse', label: '题库目录浏览', consumers: ['ui:repos'] },
    { path: '/api/repos/config', label: '数据根与镜像配置', consumers: ['ui:repos'] },
    // cycle-20 题库管理流程优化：批量安装/批次进度/作业归档（声明→生产→消费闭环）
    { path: '/api/repos/install-batch', label: '必选仓库一键批量安装', consumers: ['ui:repos'] },
    { path: '/api/repos/batch', label: '批量安装批次进度', consumers: ['ui:repos'] },
    { path: '/api/repos/jobs', label: '题库作业历史', consumers: ['ui:repos', 'ui:obs'] },
    // ── cycle-18 花生十三体系方法论适配库 ──
    // 语料与其它题库同等对待：**不随包分发**，由「📦 题库管理」统一下载到数据根
    // （数据根/huasheng13，20 references + 5 examples ≈ 336KB，上游 huasheng13-skill）。
    // 未安装时这组端点必须返回 degraded=true + 明确引导，绝不崩、也绝不假装有内容。
    { path: '/api/huasheng13/catalog', label: '方法论目录树', consumers: ['ui:huasheng13', 'ui:topics', 'tool:kaogong_ai_tutor'] },
    { path: '/api/huasheng13/doc', label: '单篇方法论全文', consumers: ['ui:huasheng13', 'tool:kaogong_ai_tutor', 'tool:kaogong_ai_shenlun'] },
    { path: '/api/huasheng13/search', label: '方法论全文检索(BM25)', consumers: ['ui:huasheng13', 'ui:search', 'tool:kaogong_ai_tutor'] },
    { path: '/api/huasheng13/coverage', label: '六模块×体系覆盖矩阵', consumers: ['ui:huasheng13', 'ui:observability'] },
    { path: '/api/huasheng13/practice', label: '方法论配套练习抽取', consumers: ['ui:huasheng13'] },
    { path: '/api/huasheng13/trace', label: '方法论消费链路追踪', consumers: ['ui:huasheng13', 'ui:observability'] },
    // cycle-21 纸质练习历史补录（issue #3 第一阶段）：搜索现有题库 / 补录历史对错 / 批次撤销
    { path: '/api/history/search', label: '题干关键词搜索(补录候选)', consumers: ['ui:deepbank'] },
    { path: '/api/history/entries', label: '纸质补录(逐题/批量)', consumers: ['ui:deepbank'] },
    { path: '/api/history/undo', label: '补录批次撤销', consumers: ['ui:deepbank'] },
    { path: '/api/history/batches', label: '补录批次台账', consumers: ['ui:deepbank'] },
    { path: '/api/graph', label: '图谱数据', consumers: ['ui:graph'] },
    // v1.8 交互式图谱三端点 + 生命周期状态机（白盒链路：client 视图消费）
    { path: '/api/graph/neighborhood', label: '图谱·k跳邻域', consumers: ['ui:graph'] },
    { path: '/api/graph/path', label: '图谱·最短路', consumers: ['ui:graph'] },
    { path: '/api/graph/impact', label: '图谱·影响面', consumers: ['ui:graph'] },
    { path: '/api/lifecycle', label: '生命周期状态机', consumers: ['ui:observability'] },
    { path: '/api/telemetry', label: '遥测', consumers: ['ui:observability'] },
    { path: '/api/capabilities', label: '能力矩阵', consumers: ['ui:observability'] },
    { path: '/api/workspaces', label: '命名空间清单', consumers: ['ui:observability'] },
  ],

  // 宿主 AI 工具（可选消费者，模型增强）
  tools: [
    { name: 'kaogong_launch', class: 'optional-ai', depends: ['/api/status'] },
    { name: 'kaogong_ai_tutor', class: 'optional-ai', depends: ['/api/method', '/api/search'] },
    { name: 'kaogong_ai_plan', class: 'optional-ai', depends: ['/api/progress'] },
    { name: 'kaogong_ai_shenlun', class: 'optional-ai', depends: ['/api/method'] },
    { name: 'kaogong_ai_essay_review', class: 'optional-ai', depends: ['/api/essay/grade', '/api/essay/article', '/api/method'] },
    // cycle-18：方法论方法论检索工具——把内置花生十三体系接进模型增强链路
    { name: 'kaogong_ai_method', class: 'optional-ai', depends: ['/api/huasheng13/search', '/api/huasheng13/doc', '/api/huasheng13/coverage'] },
  ],

  // 客户端 UI 视图（消费端）
  views: [
    { id: 'dashboard', label: '仪表盘' },
    { id: 'practice', label: '刷题' },
    { id: 'deepbank', label: '深度题库' },
    { id: 'tuxing', label: '图形推理' },
    { id: 'exam', label: '整卷模考' },
    { id: 'papers', label: '真题卷' },
    { id: 'topics', label: '专题' },
    { id: 'essay', label: '申论' },
    { id: 'wrongbook', label: '错题本' },
    { id: 'plan', label: '学习计划' },
    { id: 'search', label: '知识检索' },
    { id: 'method', label: '方法论' },
    { id: 'huasheng13', label: '花生十三体系' },
    { id: 'graph', label: '知识图谱' },
    { id: 'repos', label: '题库管理' },
    { id: 'observability', label: '可观测' },
  ],

  // 数据域（16 仓库 × 模块；cycle-18 起含 huasheng13 方法论语料）
  repos: [
    'huasheng13', 'xingcezhenti', 'kaogongzhentizhengliu', 'GongkaoNaoku', 'AdministrativeAptitudeTest',
    'NovaForge', 'kaogong-skill', 'sakib', 'developer2gwy', 'gwy-zhenti', 'Exam_Database',
    'qiuzhao-epi-bank', 'xingce-app', 'gk-tuxing', 'civil-exam-agent', 'yunduanqiqu',
  ],
  modules: ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析'],
  methodTopics: ['行测', '申论', '职测', '综应', '公基', '公文', '面试', '时政', '报考', '复盘'],
}

// ── cycle-18 花生十三体系方法论适配库 · 静态事实源 ──
// 上游：WangJunqing-coder/huasheng13-skill（MIT 内容，公开教学体系整理）
// 设计要点：语料由「📦 题库管理」统一下载到数据根（root 字段=相对路径），本表是「目录结构」的
// 单一事实源——server 解析器 + client 视图 + 覆盖矩阵三方共用，禁止任何一侧再写字面量。
//
// 六模块 ↔ 语料文件映射（modules[].docs 顺序即 UI 展示顺序 = 学习优先级）
//
// 维度适用性（dims）：决定覆盖矩阵「按什么维度考核这个模块」。
// 为什么必须有：早期用统一三维（文档/表格/公式/示例）打分，导致常识判断与申论
// 因为「没有公式」被判 33%/67% —— 但这两个模块本来就不考公式，这是**假阴性**，
// 会让白盒面板对健康模块持续告警（等同于 v1.8 遥测假阳性事故的同族错误）。
// 规则：公式维度只在「有速算/公式体系」的模块计入；常识/申论不计公式，改计示例与表格。
export const HUASHENG13_META = {
  id: 'huasheng13',
  label: '花生十三体系',
  upstream: 'https://github.com/WangJunqing-coder/huasheng13-skill',
  attestation: '内容基于花生十三公开教学体系整理；速算方法为公考培训行业通用方法，非独家版权。',
  // 模块 → 语料（六模块对应行测六大题型；strategy/beikao 为跨模块策略层）
  modules: [
    {
      id: 'ziliao', label: '资料分析', icon: '📊', color: '#0ea5e9',
      weight: 1.15, targetMinutes: 28, targetQuestions: 20,
      docs: [
        { file: 'ziliao-fenxi',   title: 'ABRX 四要素体系', desc: '现期/基期/增长率/增长量的互推关系与全部子题型公式' },
        { file: 'ziliao-susuan',  title: '三大速算方法',     desc: '截位直除 · 415 份数 · 假设分配，附分数比较与首尾数法' },
        { file: 'ziliao-zonghe',  title: '综合分析题专项',   desc: '题型分类 · 常见陷阱 · 提速与蒙题策略' },
      ],
      examples: [{ file: 'ziliao-lianxi', title: '资料分析练习 10 题' }],
    },
    {
      id: 'shuliang', label: '数量关系', icon: '🔢', color: '#f59e0b',
      weight: 1.0, targetMinutes: 10, targetQuestions: 7,
      docs: [
        { file: 'shuliang-guanxi',  title: '全题型解法',   desc: '工程/行程/利润/排列组合/概率/容斥/最值/年龄/几何/溶液/牛吃草' },
        { file: 'shuliang-gongshi', title: '公式速查手册', desc: '十三类题型全部公式，考前一页速查' },
      ],
      examples: [{ file: 'shuliang-lianxi', title: '数量关系练习 18 题' }],
    },
    {
      id: 'yanyu', label: '言语理解', icon: '💬', color: '#10b981',
      weight: 0.6, targetMinutes: 35, targetQuestions: 40,
      docs: [
        { file: 'yanyu-lianjie',    title: '逻辑填空与片段阅读', desc: '语境分析 · 中心理解 · 细节判断 · 语句排序 · 篇章阅读' },
        { file: 'yanyu-ciyu',       title: '高频成语实词辨析',   desc: '200+ 成语分类 · 易混辨析 · 固定搭配' },
        { file: 'yanyu-zhuanxiang', title: '专项突破',           desc: '一空/两空题 · 标题填入 · 语句衔接' },
      ],
      examples: [{ file: 'yanyu-lianxi', title: '言语理解练习 15 题' }],
    },
    {
      id: 'panduan', label: '判断推理', icon: '🧩', color: '#8b5cf6',
      weight: 0.7, targetMinutes: 35, targetQuestions: 40,
      docs: [
        { file: 'panduan-tuili',  title: '图形·定义·类比·逻辑', desc: '四类题型规律体系与翻译推理公式' },
        { file: 'panduan-guilv',  title: '规律速查手册',        desc: '图形规律优先级 · 定义要素 · 类比关系 · 逻辑公式' },
        { file: 'panduan-tuxing', title: '图形推理专项',        desc: '位置/样式/数量/属性规律 · 立体图形 · 训练方法' },
      ],
      examples: [{ file: 'panduan-lianxi', title: '判断推理练习 18 题' }],
    },
    {
      id: 'changshi', label: '常识判断', icon: '🌍', color: '#14b8a6',
      weight: 0.5, targetMinutes: 9, targetQuestions: 20,
      // 常识不考公式：考核维度=文档齐备 + 表格（考点清单）+ 时政素材
      dims: { formula: false, table: true, example: false },
      docs: [
        { file: 'changshi-panduan', title: '常识排除法体系', desc: '政治/法律/经济/历史/文化/地理/科技/时政' },
        { file: 'shizheng-redian',  title: '时政热点积累',   desc: '重要会议 · 重大战略 · 新质生产力 · 科技成就' },
      ],
      examples: [],
    },
    {
      id: 'shenlun', label: '申论', icon: '✍️', color: '#ec4899',
      weight: 1.0, targetMinutes: 150, targetQuestions: 5,
      // 申论是写作科目：不考公式；考核文档齐备 + 素材/规范表 + 配套练习
      dims: { formula: false, table: true, example: true },
      docs: [
        { file: 'shenlun',         title: '申论全题型',   desc: '单一题 · 综合分析 · 提出对策 · 公文写作 · 大作文' },
        { file: 'shenlun-biaoda',  title: '规范表达与金句', desc: '口语转规范 · 政府工作用语 · 论证素材' },
        { file: 'shenlun-sucai',   title: '申论素材库',     desc: '经济/乡村/民生/生态/文化/科技/治理主题素材' },
      ],
      examples: [{ file: 'shenlun-lianxi', title: '申论练习 13 题' }],
    },
  ],
  // 跨模块策略层（不属于单一题型，但决定总得分，单独成区）
  strategy: [
    { file: 'strategy',      title: '答题顺序与时间分配', desc: '模块顺序 · 时间切块 · 选做蒙题 · 套题复盘模板' },
    { file: 'beikao-jihua',  title: '备考三阶段计划',     desc: '30/60/90 天 · 在职/全职 · 各模块提分策略' },
    { file: 'cuoti-muban',   title: '错题本与复盘方法',   desc: '通用+分模块模板 · 复盘方法 · 数字化管理' },
  ],
  // 真题示例库（跨模块）。注意：上游语料实际落在 references/ 下，
  // 曾误声明为 examples/ → 适配层靠 candidateDirs 兜底才不会丢档，
  // 但那会把契约偏差伪装成正常（漏掉一篇只表现在计数上）。
  // 现按磁盘事实声明，与 数据根/huasheng13/references/zhenti-shili.md 一致。
  examples: [{ file: 'zhenti-shili', title: '各模块真题示例与解析', dir: 'references' }],
  // 语料放置根（**相对数据根**，与其它仓库一致：数据根/huasheng13/{references,examples}）；
  // server 解析器按数据根定位，client 不直接读盘。数据根由「📦 题库管理」统一配置。
  root: 'huasheng13',
}

// ── cycle-16 本插件自身元数据（题库管理面板「关于本项目」卡片的单一事实源）──
// 面板不硬编码 URL——server /api/repos 透出 self，UI 消费；改仓库地址只改这里。
export const SELF_META = {
  name: 'dsh-kaogong',
  version: CAPABILITIES.plugin.version,   // 引用单一事实源，杜绝第二处版本字面量（三锚点守卫只认 plugin.version）
  repo: 'https://github.com/xuanyuanchumo/dsh-kaogong',
  homepage: 'https://github.com/xuanyuanchumo/dsh-kaogong#readme',
  releases: 'https://github.com/xuanyuanchumo/dsh-kaogong/releases',
  issues: 'https://github.com/xuanyuanchumo/dsh-kaogong/issues',
  npm: 'https://www.npmjs.com/package/dsh-kaogong',
  license: 'MIT',
  desc: '考公备考整合插件（DSH 宿主原生面板）— 16 个开源仓库一键式整合 · 离线可视化',
}

// ── cycle-16 原始题库注册表（题库管理面板的单一事实源）──
// tier: required=必选 · recommended=推荐 · optional=可选（按需拉取避免一次下载过大）。
// 原则（用户明确要求）：**本插件不内置任何题库/语料数据**，一切数据一律由「📦 题库管理」
// 统一下载配置到数据根。花生十三体系语料也不例外——它只是又多了一个被管理的上游仓库，
// 不允许出现「随包分发/内置」这类旁路（否则数据来源分裂、更新与卸载语义不再统一）。
// upstream: 上游 GitHub 仓库（无 .git 后缀，repoManager 拼接）；size: 上游 pack 体积近似。
// 致敬上游：全部题目数据与解析成果归各仓库作者所有，本插件只做整合与可视化。
export const REPOS_META: any = {
  huasheng13:             { tier: 'required',    size: '336KB', upstream: 'https://github.com/WangJunqing-coder/huasheng13-skill', desc: '花生十三体系方法论 25 篇（方法论视图硬依赖·必选）' },
  xingcezhenti:           { tier: 'required',    size: '341MB', upstream: 'https://github.com/ERRRC/xingcezhenti',           desc: '515套卷58890题行测真题库（刷题视图硬依赖）' },
  'kaogong-skill':        { tier: 'recommended', size: '3MB',   upstream: 'https://github.com/KeWang0622/kaogong-skill',     desc: '考公AI技能包·方法论10主题（专题「另见」区，非硬依赖）' },
  'gk-tuxing':            { tier: 'required',    size: '19MB',  upstream: 'https://github.com/Cha551/gk-tuxing',             desc: '图形推理真题354道逐题解析（图推视图硬依赖）' },
  'gwy-zhenti':           { tier: 'recommended', size: '626MB', upstream: 'https://github.com/ProfessorZhi/gwy-zhenti',      desc: '国考省考真题1683套（真题卷/模考/申论评改依赖）' },
  GongkaoNaoku:           { tier: 'recommended', size: '120MB', upstream: 'https://github.com/jangviktor-web/GongkaoNaoku',  desc: '深度题库27506题五维标注（深度题库视图依赖）' },
  kaogongzhentizhengliu:  { tier: 'optional',    size: '208MB', upstream: 'https://github.com/ERRRC/kaogongzhentizhengliu',  desc: '22375篇考点重组深度笔记（检索增强）' },
  AdministrativeAptitudeTest: { tier: 'optional', size: '2MB',  upstream: 'https://github.com/jecoat/AdministrativeAptitudeTest', desc: '近二十年国考省考试卷PDF（打印模考）' },
  NovaForge:              { tier: 'optional',    size: '3MB',   upstream: 'https://github.com/SiriusFzh/NovaForge',          desc: '通用笔记模板库（LaTeX/Typst/Markdown）' },
  sakib:                  { tier: 'optional',    size: '1MB',   upstream: 'https://github.com/vsakib/sakib',                 desc: '公考知识文档库（检索增强）' },
  developer2gwy:          { tier: 'optional',    size: '1MB',   upstream: 'https://github.com/miss-mumu/developer2gwy',      desc: '程序员上岸公考指南（选岗/策略）' },
  Exam_Database:          { tier: 'optional',    size: '131MB', upstream: 'https://github.com/869909419/Exam_Database',      desc: '多渠道考公素材题库（检索增强）' },
  'qiuzhao-epi-bank':     { tier: 'optional',    size: '486MB', upstream: 'https://github.com/Timothy-yqw19/qiuzhao-epi-bank', desc: '秋招行测/银行EPI 697题PWA（扩展练习）' },
  'xingce-app':           { tier: 'optional',    size: '46MB',  upstream: 'https://github.com/YMDHZBSJ/xingce-app',          desc: '离线行测App 22298题（数据参考）' },
  'civil-exam-agent':     { tier: 'optional',    size: '276MB', upstream: 'https://github.com/tongnian0666-code/civil-exam-agent', desc: '公考督导智能体系统（AI 增强参考）' },
  yunduanqiqu:            { tier: 'optional',    size: '5MB',   upstream: 'https://github.com/hwlvipone/yunduanqiqu',        desc: '申论范文/面试真题/素材分享' },
}

// ── 图构建：邻接表 ──
export function buildGraph({ banks, modules, telemetry, plan }: any = {}) {
  const nodes: any[] = []
  const edges: any[] = []
  const nid = (t, id) => `${t}:${id}`
  const addNode = (t, id, label, meta = {}) => { nodes.push({ id: nid(t, id), type: t, label, ...meta }); return nid(t, id) }
  const addEdge = (s, d, rel, w = 1) => { if (s && d && s !== d) edges.push({ source: s, target: d, rel, w }) }

  const pluginId = addNode('plugin', 'kaogong', 'dsh-kaogong', { version: CAPABILITIES.plugin.version })

  // 生命周期链
  let prev = null
  for (const lc of CAPABILITIES.lifecycle) {
    const id = addNode('lifecycle', lc.stage, lc.stage, { desc: lc.desc })
    addEdge(pluginId, id, 'registers')
    if (prev) addEdge(prev, id, 'next')
    prev = id
  }

  // 视图 → 端点（消费边）
  const viewIds: any = {}
  for (const v of CAPABILITIES.views) viewIds[v.id] = addNode('view', v.id, v.label)
  // 宿主 UI 双入口（左沉浸 / 右并排）
  for (const en of CAPABILITIES.entries || []) {
    const eid = addNode('entry', en.id, `${en.kind}:${en.id}`, { desc: en.desc })
    addEdge(pluginId, eid, 'registers')
    if (en.id === 'tab') addEdge(eid, viewIds['dashboard'], 'hosts')
    if (en.id === 'panel') addEdge(eid, viewIds['graph'], 'hosts')
  }
  // 传输通道（v1.4：同源主 / 独立端口兜底）
  for (const ch of CAPABILITIES.channels || []) {
    const cid = addNode('channel', ch.id, ch.mount, { desc: ch.desc, preferred: !!ch.preferred })
    addEdge(pluginId, cid, 'serves')
    if (ch.id === 'same-origin' && viewIds['dashboard']) addEdge(cid, viewIds['dashboard'], 'hosts')
  }
  const epIds: any = {}
  for (const ep of CAPABILITIES.endpoints) {
    epIds[ep.path] = addNode('endpoint', ep.path, ep.label, { consumers: ep.consumers.length })
    addEdge(pluginId, epIds[ep.path], 'produces')
    // 静态消费关系
    for (const c of ep.consumers) {
      if (c.startsWith('ui:')) {
        const vv = viewIds[c.slice(3)]
        if (vv) addEdge(epIds[ep.path], vv, 'consumed-by')
      }
    }
  }

  // 工具 → 端点
  for (const t of CAPABILITIES.tools) {
    const tid = addNode('tool', t.name, t.name, { class: t.class })
    addEdge(pluginId, tid, 'registers')
    for (const dep of t.depends) addEdge(tid, epIds[dep], 'consumes')
  }

  // 题库数据域
  if (banks && banks.banks) {
    const domain = addNode('domain', 'repos', '本地题库域', { ready: banks.ready, total: banks.total })
    addEdge(pluginId, domain, 'contains')
    for (const [key, info] of entries(banks.banks)) {
      const rid = addNode('repo', key, key, { exists: info.exists, desc: info.desc })
      addEdge(domain, rid, 'contains')
      if (key === 'xingcezhenti') {
        for (const [mname, minfo] of entries((modules && modules.modules) || {})) {
          const mid = addNode('module', mname, mname, { files: minfo.fileCount })
          addEdge(rid, mid, 'contains')
          addEdge(mid, epIds['/api/questions'], 'feeds')
        }
      }
      if (key === 'kaogong-skill') {
        for (const topic of CAPABILITIES.methodTopics) {
          const mtid = addNode('method', topic, topic)
          addEdge(rid, mtid, 'contains')
          addEdge(mtid, epIds['/api/method'], 'feeds')
        }
      }
    }
  }

  // 计划域
  if (plan && plan.phases) {
    const pd = addNode('domain', 'plan', '30天计划', {})
    addEdge(pluginId, pd, 'contains')
    for (const ph of plan.phases) {
      const phid = addNode('phase', ph.name, ph.name, { days: `${ph.startDay}-${ph.endDay}` })
      addEdge(pd, phid, 'contains')
      for (const d of plan.days.filter(x => x.phase === ph.name)) {
        addEdge(phid, addNode('day', 'D' + d.day, 'D' + d.day, { title: d.title }), 'contains')
      }
    }
  }

  return { nodes, edges }
}

// ── PageRank 幂迭代 ──
export function pageRank(nodes, edges, { d = 0.85, iter = 40 } = {}) {
  const n = nodes.length
  if (!n) return {}
  const out: any = {}
  const adj: any = {}
  for (const x of nodes) { out[x.id] = 1 / n; adj[x.id] = [] }
  for (const e of edges) {
    if (adj[e.source] && out[e.target] !== undefined) adj[e.source].push(e.target)
  }
  for (let it = 0; it < iter; it++) {
    let dangling = 0
    for (const x of nodes) if (adj[x.id].length === 0) dangling += out[x.id]
    const next: any = {}
    for (const x of nodes) next[x.id] = (1 - d) / n + d * (dangling / n)
    for (const x of nodes) {
      const share = out[x.id] / (adj[x.id].length || 1)
      for (const t of adj[x.id]) next[t] += d * share
    }
    for (const x of nodes) out[x.id] = next[x.id]
  }
  return out
}

// ── Union-Find 弱连通分量 ──
export function components(nodes, edges) {
  const parent: any = {}
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (const x of nodes) parent[x.id] = x.id
  for (const e of edges) { if (parent[e.source] !== undefined && parent[e.target] !== undefined) union(e.source, e.target) }
  const groups: any = {}
  for (const x of nodes) { const r = find(x.id); (groups[r] = groups[r] || []).push(x.id) }
  return Object.values(groups)
}

// ── 图指标 + 健康度评分 ──
export function graphMetrics(nodes, edges) {
  const V = nodes.length, E = edges.length
  const density = V > 1 ? (E / (V * (V - 1))) : 0
  const degree: any = {}
  for (const x of nodes) degree[x.id] = { in: 0, out: 0 }
  for (const e of edges) {
    if (degree[e.source]) degree[e.source].out++
    if (degree[e.target]) degree[e.target].in++
  }
  // 孤儿：无任何消费/入边的可消费节点（端点/视图/工具）
  const orphans = nodes
    .filter(x => ['endpoint', 'tool', 'view'].includes(x.type))
    .filter(x => (degree[x.id]?.in || 0) === 0)
    .map(x => x.id)
  const comps = components(nodes, edges)
  const rank = pageRank(nodes, edges)
  return { V, E, density: +density.toFixed(4), orphans, components: comps.length, rank }
}

// ── 插件健康度（可解释加权模型）──
// H = w1·连通性 + w2·消费活跃度 + w3·延迟达标率 + w4·(1-错误率) + w5·数据就绪率
export function healthScore({ metrics, telemetry, banks, endpointsCount }: any = {}) {
  const connectivity = metrics.V > 0 ? Math.max(0, 1 - metrics.orphans.length / Math.max(1, metrics.V)) : 0
  const activeRate = metrics.V > 0 ? metrics.density * 10 : 0 // 密度小，放大
  const eps: any = telemetry?.endpoints || {}
  const totalReq = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + (e.count || 0), 0)
  const totalErr = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + (e.errors || 0), 0)
  const errRate = totalReq ? totalErr / totalReq : 0
  const p95All = (Object.values(eps) as any[]).map((e: any) => e.p95 || 0)
  const latencyOk = p95All.length ? p95All.filter(p => p < 200).length / p95All.length : 1
  const dataReady = banks && banks.total ? banks.ready / banks.total : 0
  const W = { connectivity: 0.25, activity: 0.2, latency: 0.2, errors: 0.15, data: 0.2 }
  const H = W.connectivity * Math.min(1, connectivity + activeRate) +
            W.activity * Math.min(1, totalReq > 0 ? 1 : 0.5) +
            W.latency * latencyOk +
            W.errors * (1 - errRate) +
            W.data * dataReady
  return {
    total: +(H * 100).toFixed(1),
    factors: {
      connectivity: +connectivity.toFixed(3),
      requestActivity: totalReq,
      errorRate: +errRate.toFixed(4),
      latencyP95Ok: +latencyOk.toFixed(3),
      dataReady: +dataReady.toFixed(3),
    },
    weights: W,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// cycle-12 图数据层（v1.8.0）：类型元数据 + 交互式图谱分析算法族
//
// 设计约束（docs/design/cycle-12-contract.md §2）：
//  - NODE_META / EDGE_META 是节点/边视觉语义的**单一事实源**，client 视图与
//    /api/graph 同时消费，避免「颜色/标签各写一份」导致的能力矩阵漂移。
//  - 全部算法是**纯函数**：不修改入参（nodes/edges 只读，内部一律复制/索引），
//    输出仅依赖入参内容而与插入顺序无关（必要时字典序排序），因此同输入
//    两次调用结果深相等（可复现，smoke 可断言）。
//  - 节点量级 V≈300-600、E≈1-2k：算法均为 O(V+E) / O(V·E) / O(V·k²) 量级，
//    实测整包 < 20ms；无递归（BFS/显式队列/迭代），不会爆栈。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 节点类型元数据：label 中文名 / color 画布色 / icon 图标 / layer 分层序（0..6）
 * layer 同时作为 layeredLayout 的兜底分层语义（拓扑分层失败时仍可排布）。
 */
export const NODE_META = {
  plugin:    { label: '插件',   color: '#6366f1', icon: '📦', layer: 0 },
  lifecycle: { label: '生命周期', color: '#0ea5e9', icon: '🔁', layer: 1 },
  entry:     { label: '入口',   color: '#8b5cf6', icon: '🚪', layer: 1 },
  channel:   { label: '通道',   color: '#14b8a6', icon: '🔌', layer: 1 },
  view:      { label: '视图',   color: '#f59e0b', icon: '🖥', layer: 2 },
  endpoint:  { label: '端点',   color: '#3b82f6', icon: '🔗', layer: 2 },
  tool:      { label: '工具',   color: '#ec4899', icon: '🧰', layer: 2 },
  domain:    { label: '数据域', color: '#10b981', icon: '🗂', layer: 3 },
  repo:      { label: '仓库',   color: '#64748b', icon: '📚', layer: 4 },
  module:    { label: '模块',   color: '#84cc16', icon: '🧩', layer: 5 },
  method:    { label: '方法论', color: '#a855f7', icon: '📖', layer: 5 },
  phase:     { label: '阶段',   color: '#f97316', icon: '📅', layer: 5 },
  day:       { label: '日',     color: '#94a3b8', icon: '·',  layer: 6 },
}

/** 边类型元数据：label 中文关系名 / color 连线色（图例直接由此渲染） */
export const EDGE_META = {
  contains:    { label: '包含', color: '#94a3b8' },
  produces:    { label: '生产', color: '#3b82f6' },
  consumes:    { label: '消费', color: '#10b981' },
  registers:   { label: '注册', color: '#6366f1' },
  serves:      { label: '服务', color: '#14b8a6' },
  hosts:       { label: '承载', color: '#8b5cf6' },
  next:        { label: '下一阶段', color: '#0ea5e9' },
  'consumed-by': { label: '被消费', color: '#f59e0b' },
  feeds:       { label: '喂给', color: '#84cc16' },
}

// ── 内部工具：无向邻接表（去自环、去重、邻居字典序）──────────────────────
// 确定性基石：所有依赖邻居遍历顺序的算法都走这张表，保证与 edges 的插入
// 顺序无关。复杂度 O(V+E)。不修改入参。
function undirectedAdj(nodes: any[], edges: any[]): Map<string, string[]> {
  const bags = new Map<string, Set<string>>()
  for (const n of nodes) if (n && n.id !== undefined && !bags.has(n.id)) bags.set(n.id, new Set())
  for (const e of edges) {
    if (!e) continue
    const s = e.source, t = e.target
    const a = bags.get(s), b = bags.get(t)
    if (!a || !b || s === t) continue
    a.add(t); b.add(s)
  }
  const adj = new Map<string, string[]>()
  for (const [id, bag] of bags) adj.set(id, [...bag].sort())
  return adj
}

/**
 * 出入度分析 —— O(V+E)。
 * @returns degree: { [id]: {in,out,total} }；stats: 极值/均值/中位数/次数直方图。
 * 直方图按 deg 升序，仅列出实际出现的度数（含 0），便于前端稀疏渲染。
 */
export function degreeAnalysis(nodes: any[] = [], edges: any[] = []) {
  const degree: any = {}
  for (const n of nodes) degree[n.id] = { in: 0, out: 0, total: 0 }
  for (const e of edges) {
    if (!e) continue
    if (degree[e.source]) degree[e.source].out++
    if (degree[e.target]) degree[e.target].in++
  }
  for (const n of nodes) { const d = degree[n.id]; d.total = d.in + d.out }
  const totals = nodes.map(n => degree[n.id].total).sort((a, b) => a - b)
  const sum = totals.reduce((s, x) => s + x, 0)
  const max = totals.length ? totals[totals.length - 1] : 0
  const avg = totals.length ? +(sum / totals.length).toFixed(2) : 0
  const median = !totals.length ? 0
    : totals.length % 2 ? totals[(totals.length - 1) / 2]
    : +((totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2).toFixed(2)
  const counts: any = {}
  for (const t of totals) counts[t] = (counts[t] || 0) + 1
  const histogram = Object.keys(counts).map(Number).sort((a, b) => a - b)
    .map(deg => ({ deg, count: counts[deg] }))
  return { degree, stats: { max, avg, median, histogram } }
}

/**
 * 标签传播社区发现（异步 LPA）—— 最坏 O(maxIter·E)，maxIter≤20。
 * 确定性：节点按 id 字典序扫描、邻居已排序、平票取字典序最小标签，
 * 无随机洗牌；迭代到无变化即提前退出。maxIter 兜底防振荡。
 * @returns [{id,size,members}] —— 按 size 降序、id 字典序；members 升序；
 *          社区 id 取「最小成员 id」，保证 id ∈ members 且全局唯一。
 */
export function labelPropagation(nodes: any[] = [], edges: any[] = [], { maxIter = 20 } = {}) {
  const ids = nodes.map(n => n.id).sort()
  const adj = undirectedAdj(nodes, edges)
  const label = new Map<string, string>()
  for (const id of ids) label.set(id, id)
  let iter = 0
  let changed = true
  while (changed && iter < maxIter) {
    changed = false; iter++
    for (const id of ids) {
      const counts = new Map<string, number>()
      for (const nb of adj.get(id) || []) {
        const lb = label.get(nb)
        counts.set(lb, (counts.get(lb) || 0) + 1)
      }
      if (!counts.size) continue
      // 平票裁决：计数最大且标签字典序最小（排序后取首个达标项）
      let best = null, bestCount = 0
      for (const [lb, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
        if (c > bestCount) { best = lb; bestCount = c }
      }
      if (best && best !== label.get(id)) { label.set(id, best); changed = true }
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const lb = label.get(id)
    if (!groups.has(lb)) groups.set(lb, [])
    groups.get(lb).push(id)
  }
  const out = [...groups.values()].map(members => {
    const sorted = members.slice().sort()
    return { id: sorted[0], size: sorted.length, members: sorted }
  })
  out.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

/**
 * 无向集聚系数（Watts-Strogatz）—— O(V·k²)，k 为平均度（本图 ~5，很快）。
 * c(v) = 2·links(v) / (k·(k-1))，k<2 记 0；avg 只对 k≥2 的节点取平均。
 * @returns {avg, top:[{id,c}]} —— top 按 c 降序 / id 升序，取前 10。
 */
export function clusteringCoefficient(nodes: any[] = [], edges: any[] = []) {
  const adj = undirectedAdj(nodes, edges)
  const ids = [...adj.keys()].sort()
  const nbSets = new Map<string, Set<string>>()
  for (const id of ids) nbSets.set(id, new Set(adj.get(id)))
  const coef: any = {}
  let sum = 0, cnt = 0
  for (const id of ids) {
    const nb = adj.get(id)
    const k = nb.length
    if (k < 2) { coef[id] = 0; continue }
    let links = 0
    for (let i = 0; i < k; i++) {
      const set = nbSets.get(nb[i])
      for (let j = i + 1; j < k; j++) if (set.has(nb[j])) links++
    }
    const c = (2 * links) / (k * (k - 1))
    coef[id] = +c.toFixed(4)
    sum += c; cnt++
  }
  const avg = cnt ? +(sum / cnt).toFixed(4) : 0
  const top = ids.map(id => ({ id, c: coef[id] }))
    .sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 10)
  return { avg, top }
}

/**
 * Brandes 介数中心性（无向、无权）—— O(V·E)，V=600/E=2k 实测 ~20ms。
 * 每源一次 BFS：sigma 记最短路条数、d 记层深；回推按 sigma 比例累加依赖量。
 * 实现细节：节点先映射为整数下标，σ/dist/delta 用 TypedArray，避免每源
 * 重建 O(V) 个 Map/数组（原 Map 版 600 节点实测 320ms，TypedArray 版 ~20ms）。
 * 归一化：无向图除以 ((V-1)(V-2)/2)，score 落在 0..1（极端稠密图 σ 溢出时
 * 该节点记 0，保证输出始终有限可 JSON 化）。
 * @returns [{id,score}] —— 按 score 降序 / id 升序，取前 20。
 */
export function brandesBetweenness(nodes: any[] = [], edges: any[] = []) {
  const adj = undirectedAdj(nodes, edges)
  const ids = [...adj.keys()].sort()
  const n = ids.length
  if (n < 3) return ids.map(id => ({ id, score: 0 }))
  const idx = new Map<string, number>()
  for (let i = 0; i < n; i++) idx.set(ids[i], i)
  const adjIdx: number[][] = ids.map(id => adj.get(id).map(x => idx.get(x)))
  // 前驱表用「CSR 式链表」而非 Array<number[]>：每源零分配、零 GC 抖动。
  // 容量上界 = 邻接表条目总数（每源每条 BFS 边最多贡献 1 个前驱条目）。
  let cap = 0
  for (const a of adjIdx) cap += a.length
  const prevHead = new Int32Array(n)
  const prevFrom = new Int32Array(cap + 1)
  const prevNext = new Int32Array(cap + 1)
  const CB = new Float64Array(n)
  const sigma = new Float64Array(n)
  const delta = new Float64Array(n)
  const dist = new Int32Array(n)
  const stack = new Int32Array(n)
  const order = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    sigma.fill(0); delta.fill(0); dist.fill(-1); prevHead.fill(-1)
    sigma[s] = 1; dist[s] = 0
    let qh = 0, qt = 0, sp = 0, pc = 0
    order[qt++] = s
    while (qh < qt) {
      const v = order[qh++]
      stack[sp++] = v
      const dv = dist[v] + 1
      for (const w of adjIdx[v]) {
        if (dist[w] < 0) { dist[w] = dv; order[qt++] = w }
        if (dist[w] === dv) {
          sigma[w] += sigma[v]
          if (!isFinite(sigma[w])) sigma[w] = 1e300 // 极端稠密图防溢出（保守截断）
          prevFrom[pc] = v; prevNext[pc] = prevHead[w]; prevHead[w] = pc; pc++
        }
      }
    }
    while (sp > 0) {
      const w = stack[--sp]
      const sw = sigma[w]
      let e = prevHead[w]
      while (e !== -1) {
        const v = prevFrom[e]
        if (sw > 0) delta[v] += (sigma[v] / sw) * (1 + delta[w])
        e = prevNext[e]
      }
      if (w !== s) CB[w] += delta[w]
    }
  }
  const norm = 1 / (((n - 1) * (n - 2)) / 2)
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    const score = CB[i] * norm
    out.push({ id: ids[i], score: isFinite(score) ? +score.toFixed(4) : 0 })
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 20)
}

/**
 * Kahn 拓扑最长路径分层 —— O(V+E)。
 * layer(v) = max(layer(前驱)) + 1；入度为 0 的节点为第 0 层。
 * 环内剩余节点（Kahn 无法出队）统一置于 maxLayer+1，保证「分层覆盖全部节点」
 * 这一不变量恒成立（测绘场景覆盖率优先于环内精确深度）。
 * @returns {layer:{[id]:number}, maxLayer}
 */
export function topoLayers(nodes: any[] = [], edges: any[] = []) {
  const ids = nodes.map(n => n.id).sort()
  const inDeg = new Map<string, number>()
  const outAdj = new Map<string, string[]>()
  for (const id of ids) { inDeg.set(id, 0); outAdj.set(id, []) }
  for (const e of edges) {
    if (!e || !inDeg.has(e.source) || !inDeg.has(e.target)) continue
    outAdj.get(e.source).push(e.target)
    inDeg.set(e.target, inDeg.get(e.target) + 1)
  }
  for (const id of ids) outAdj.get(id).sort()
  const layer = new Map<string, number>()
  for (const id of ids) layer.set(id, 0)
  // 初始队列即已按字典序（ids 有序），后续入队顺序由出邻表有序保证 → 确定性
  const queue = ids.filter(id => inDeg.get(id) === 0)
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi]
    for (const w of outAdj.get(v)) {
      if (layer.get(w) < layer.get(v) + 1) layer.set(w, layer.get(v) + 1)
      inDeg.set(w, inDeg.get(w) - 1)
      if (inDeg.get(w) === 0) queue.push(w)
    }
  }
  let maxLayer = 0
  for (const id of ids) maxLayer = Math.max(maxLayer, layer.get(id))
  const leftover = ids.filter(id => inDeg.get(id) > 0)
  if (leftover.length) {
    const tail = maxLayer + 1
    for (const id of leftover) layer.set(id, tail)
    maxLayer = tail
  }
  const out: any = {}
  for (const id of ids) out[id] = layer.get(id)
  return { layer: out, maxLayer }
}

/**
 * 无向 BFS 最短路 —— O(V+E)。
 * @returns {found, path, length}：未找到时 path=[] / length=0；
 *          from===to 视为 found 且 length=0；未知节点直接 not-found。
 */
export function shortestPath(nodes: any[] = [], edges: any[] = [], from: string, to: string) {
  const adj = undirectedAdj(nodes, edges)
  if (!from || !to || !adj.has(from) || !adj.has(to)) return { found: false, path: [], length: 0 }
  if (from === to) return { found: true, path: [from], length: 0 }
  const prev = new Map<string, string>()
  const seen = new Set<string>([from])
  const queue: string[] = [from]
  let found = false
  for (let qi = 0; qi < queue.length && !found; qi++) {
    const v = queue[qi]
    for (const w of adj.get(v)) {
      if (seen.has(w)) continue
      seen.add(w); prev.set(w, v)
      if (w === to) { found = true; break }
      queue.push(w)
    }
  }
  if (!found) return { found: false, path: [], length: 0 }
  const rev: string[] = [to]
  while (rev[rev.length - 1] !== from) rev.push(prev.get(rev[rev.length - 1]))
  const path = rev.reverse()
  return { found: true, path, length: path.length - 1 }
}

/**
 * k 跳邻域（无向）—— O(V+E)。
 * depth 内部 clamp 到 1..3（HTTP 层同样 clamp，双保险）。
 * @returns {center, depth, nodes:[node], edges:[edge]}：nodes 按 id 升序，
 *          edges 为两端都在邻域内的原始边（source,target,rel 三级排序）。
 */
export function neighborhood(nodes: any[] = [], edges: any[] = [], id: string, depth = 1) {
  const d = Math.max(1, Math.min(3, Math.floor(Number(depth) || 1)))
  const adj = undirectedAdj(nodes, edges)
  if (!id || !adj.has(id)) return { center: id, depth: d, nodes: [], edges: [] }
  const seen = new Set<string>([id])
  let frontier: string[] = [id]
  for (let k = 0; k < d; k++) {
    const next: string[] = []
    for (const v of frontier) {
      for (const w of adj.get(v)) {
        if (seen.has(w)) continue
        seen.add(w); next.push(w)
      }
    }
    if (!next.length) break
    frontier = next
  }
  const byId = new Map<string, any>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)
  const ns = [...seen].sort().map(x => byId.get(x))
  const es = edges.filter(e => e && seen.has(e.source) && seen.has(e.target)).slice()
  es.sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1
    if (a.target !== b.target) return a.target < b.target ? -1 : 1
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  })
  return { center: id, depth: d, nodes: ns, edges: es }
}

/**
 * 反向可达（影响面）—— O(V+E)。
 * 沿边反向 BFS：谁会因为 node 变化而受影响。dependents 含自身（自反性），
 * 按 id 升序返回，count = dependents.length。
 */
export function reverseReach(nodes: any[] = [], edges: any[] = [], id: string) {
  const ids = nodes.map(n => n.id)
  const known = new Set(ids)
  if (!id || !known.has(id)) return { node: id, dependents: [], count: 0 }
  const radj = new Map<string, string[]>()
  for (const x of ids) radj.set(x, [])
  for (const e of edges) {
    if (!e || !radj.has(e.target) || !radj.has(e.source)) continue
    radj.get(e.target).push(e.source)
  }
  for (const x of ids) radj.get(x).sort()
  const seen = new Set<string>([id])
  const queue: string[] = [id]
  for (let qi = 0; qi < queue.length; qi++) {
    for (const w of radj.get(queue[qi])) {
      if (seen.has(w)) continue
      seen.add(w); queue.push(w)
    }
  }
  // 自反闭包：影响面必须包含被查节点自身（语义 = 「改动此节点会波及的集合」，
  // 该节点本身当然在其中）。原实现返回 strict 反向可达（不含自身），
  // 会让 UI 上的「影响面 count」比实际少 1，且自反性测试失败。
  const dependents = [...seen].sort()
  return { node: id, dependents, count: dependents.length }
}

/**
 * 确定性分层布局（canvas 用）—— O(V+E)。
 * y 轴 = 拓扑层号归一化（单层时 0.5）；x 轴 = 同层内按 id 字典序均匀铺开
 * （同层单节点时居中）。输出坐标全部落在 0..1，宽度/高度归一为 1。
 * @returns {id:{x,y}, width, height}
 */
export function layeredLayout(nodes: any[] = [], edges: any[] = []) {
  const ids = nodes.map(n => n.id).sort()
  if (!ids.length) return { id: {}, width: 1, height: 1 }
  const { layer, maxLayer } = topoLayers(nodes, edges)
  const cols = maxLayer + 1
  const byLayer: string[][] = []
  for (let l = 0; l < cols; l++) byLayer.push([])
  for (const id of ids) byLayer[layer[id]].push(id) // ids 已排序 → 层内天然有序
  const pos: any = {}
  for (let l = 0; l < cols; l++) {
    const arr = byLayer[l]
    const y = cols > 1 ? +(l / (cols - 1)).toFixed(4) : 0.5
    for (let i = 0; i < arr.length; i++) {
      const x = arr.length > 1 ? +(i / (arr.length - 1)).toFixed(4) : 0.5
      pos[arr[i]] = { x, y }
    }
  }
  return { id: pos, width: 1, height: 1 }
}
