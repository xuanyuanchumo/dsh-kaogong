/**
 * huasheng13-view.ts — 花生十三体系方法论消费端视图（cycle-18 · D3）
 *
 * 数据源：/api/huasheng13/{catalog,doc,search,coverage,practice,trace} 六个端点
 * （语料由「📦 题库管理」安装到数据根）。本文件只**消费**端点，不新增任何端点，
 * 也绝不 import obs-view 内部函数（视觉语言对齐但不耦合，避免模块拓扑耦合）。
 *
 * 五分区：
 *   ① 🧭 体系总览  六模块卡（图标/权重/目标用时/题量）+ 覆盖率环形进度 + 缺口清单
 *   ② 📚 目录浏览  模块 → 文档两栏；右手零依赖手写 markdown 渲染（标题/表格/代码/列表/引用/图片）
 *   ③ 🔍 检索      BM25 结果列表 + 命中高亮 + took 毫秒 + 相关性置信度
 *   ④ ✏️ 配套练习  抽题 → 作答 → 本地判分（answerIsLetter 分支，见下方说明）
 *   ⑤ 📡 白盒链路  trace 端点：命中数 / p50 / p95 / 检索命中率 / 最近调用流
 *
 * ## answerIsLetter 分支（关键，勿简化）
 * 服务端 practice 返回的题目里，只有字母形态答案（A-D）才可自动判分。
 * `answerIsLetter:false` 的题（数量关系全部、申论全部、判断推理部分）**没有**
 * 可自动比对的字母答案——此时：
 *   · 绝不渲染「0 个选项的空壳选择题」；
 *   · 选项存在时以**只读参考列表**呈现并标注「仅供对照」；
 *   · 只提供「查看解析」+ 自评（我答对了 / 我没答对）两条路径，本地记录自评结果。
 * 判据见 hs13AnswerKey / canAuto 表达式（见 Hs13Practice 内注释）。
 *
 * ## 硬性纪律（本项目历史事故沉淀）
 *  ① 单 combo 作用域：本模块**全部**顶层标识符带 hs13 / Hs13 前缀（教训⑨：撞名即重复声明 SyntaxError）。
 *  ② 子视图一律 `h(Comp, props)` 真组件挂载，禁止把含 hook 的函数当普通函数直调（R9 = 宿主 GUI 白屏）。
 *  ③ 事件一律 onClick 驼峰（R6：小写 onclick 被 React 静默吞掉）。
 *  ④ 所有接口字段视为可选，缺失即卡片级降级；**绝不输出 role="alert"**（render 测试全量断言）。
 *  ⑤ 零依赖：markdown 手写渲染，不引任何 markdown 库。
 *  ⑥ 配色只用既有 CSS 变量 + 接口返回的模块 color，不硬编码新色板。
 *  ⑦ 响应式：卡片网格 repeat(auto-fit,minmax(...)) 自适应（<720px 自然单列，>=720px 两栏）。
 */
import { h, React, Stat, Bar, Card, KV_TAG, KV_BTN, OptionRow } from '../ui-kit.js';
import { hs13Num, Hs13Markdown, Hs13Snippet } from './huasheng13-md.js';
/* ═══════════════════ 常量（全部 hs13 前缀） ═══════════════════ */
/** 五分区定义（顺序即展示顺序；label 带 emoji 与既有导航口径一致） */
const HS13_SECTIONS = [
    { id: 'overview', label: '🧭 体系总览' },
    { id: 'catalog', label: '📚 目录浏览' },
    { id: 'search', label: '🔍 检索' },
    { id: 'practice', label: '✏️ 配套练习' },
    { id: 'trace', label: '📡 白盒链路' },
];
/** 检索快捷词（花生十三体系的高频方法名，点一下即搜，降低上手成本） */
const HS13_QUICK_SEARCH = ['截位直除', '假设分配', '415 份数', 'ABRX', '图形推理', '大作文'];
/** 端点中文名（trace 表格首列；未知路径原样显示，绝不臆造） */
const HS13_EP_LABEL = {
    '/api/huasheng13/catalog': '目录树',
    '/api/huasheng13/doc': '单篇全文',
    '/api/huasheng13/search': 'BM25 检索',
    '/api/huasheng13/coverage': '覆盖矩阵',
    '/api/huasheng13/practice': '配套练习',
    '/api/huasheng13/trace': '链路追踪',
};
/** 归一到 [0,1]（覆盖率、进度条共用） */
function hs13Clamp01(v) {
    const n = hs13Num(v);
    return n < 0 ? 0 : n > 1 ? 1 : n;
}
/** 字数可读化：13107 → 1.3 万字 */
function hs13FmtChars(v) {
    const n = hs13Num(v);
    if (n <= 0)
        return '—';
    if (n >= 10000)
        return (n / 10000).toFixed(1) + ' 万字';
    return Math.round(n) + ' 字';
}
/** 比例可读化：0.9756 → 97.6% */
function hs13FmtPct(v) {
    return (hs13Clamp01(v) * 100).toFixed(1) + '%';
}
/** 毫秒时间戳 → 本地 HH:MM:SS（0/无效 → '—'，绝不显示 Invalid Date） */
function hs13FmtTime(ts) {
    const n = hs13Num(ts);
    if (n <= 0)
        return '—';
    try {
        const d = new Date(n);
        if (!d || isNaN(d.getTime()))
            return '—';
        const p = (x) => String(x).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    catch {
        return '—';
    }
}
/** 耗时/分值可读化：12.3456 → '12.35'（固定两位，避免长尾小数撑爆布局） */
function hs13Fmt2(v) {
    const n = hs13Num(v);
    return n.toFixed(2);
}
/**
 * 从答案原文提取可判分的选项字母。
 * 服务端 answerIsLetter 的判据是 `/^[A-Da-d](\s|$)/`，这里做同样的归一：
 * 允许前导 '*'（加粗残留）与空白，取首个 A-D 字母并大写；非字母形态返回 ''。
 */
function hs13AnswerKey(answer) {
    const m = /^[\s*"「『]*([A-Da-d])(?![\u4e00-\u9fa5A-Za-z])/.exec(String(answer == null ? '' : answer));
    return m ? m[1].toUpperCase() : '';
}
/** 模块色兜底链：接口 color → 主题变量（不新增色板） */
function hs13ColorOf(m) {
    const c = m && typeof m.color === 'string' ? m.color : '';
    return c || 'var(--brand,#6366f1)';
}
function hs13CatalogGroups(cat) {
    const out = [];
    const mods = cat && Array.isArray(cat.modules) ? cat.modules : [];
    for (const m of mods) {
        if (!m || typeof m !== 'object')
            continue;
        const docs = [];
        for (const d of (Array.isArray(m.docs) ? m.docs : [])) {
            if (d && d.file)
                docs.push({ file: String(d.file), title: d.title || d.file, desc: d.desc || '', chars: d.chars, tables: d.tables, formulas: d.formulas, kind: 'doc' });
        }
        for (const e of (Array.isArray(m.examples) ? m.examples : [])) {
            if (e && e.file)
                docs.push({ file: String(e.file), title: e.title || e.file, desc: e.desc || '', chars: e.chars, tables: e.tables, formulas: e.formulas, kind: 'example' });
        }
        out.push({ id: String(m.id || ''), label: m.label || m.id || '模块', icon: m.icon || '📄', color: hs13ColorOf(m), docs });
    }
    const strat = (cat && Array.isArray(cat.strategy) ? cat.strategy : [])
        .filter((d) => d && d.file)
        .map((d) => ({ file: String(d.file), title: d.title || d.file, desc: d.desc || '', chars: d.chars, tables: d.tables, formulas: d.formulas, kind: 'strategy' }));
    if (strat.length)
        out.push({ id: '__strategy', label: '跨模块策略', icon: '🧭', color: '#6366f1', docs: strat });
    const exs = (cat && Array.isArray(cat.examples) ? cat.examples : [])
        .filter((d) => d && d.file)
        .map((d) => ({ file: String(d.file), title: d.title || d.file, desc: d.desc || '', chars: d.chars, tables: d.tables, formulas: d.formulas, kind: 'example' }));
    if (exs.length)
        out.push({ id: '__examples', label: '真题示例', icon: '🏆', color: '#10b981', docs: exs });
    return out;
}
/**
 * practice 题目的可自动判分判据（与 answerIsLetter 分支一一对应）：
 * 必须同时满足 ① 服务端标注 answerIsLetter===true ② 能解析出 A-D 字母 ③ 选项非空。
 * 任一不满足即走「查看解析 + 自评」路径，绝不渲染空壳选择题。
 */
function hs13CanAutoGrade(it) {
    if (!it || typeof it !== 'object')
        return false;
    if (it.answerIsLetter !== true)
        return false;
    if (!hs13AnswerKey(it.answer))
        return false;
    return Array.isArray(it.options) && it.options.length > 0;
}
/* ═══════════════════ 展示型子组件（全部经 h() 挂载） ═══════════════════ */
/** 覆盖率环形进度 props（纯 SVG，无 hook）。pct 0-1，中心显示百分比。 */
interface Hs13DonutProps { pct?: any; size?: any; stroke?: any; color?: any; children?: any }
/** 覆盖率环形进度（纯 SVG，无 hook）。pct 0-1，中心显示百分比。 */
function Hs13Donut(props) {
    const pct = hs13Clamp01(props.pct);
    const size = hs13Num(props.size) || 96;
    const stroke = hs13Num(props.stroke) || 9;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const on = c * pct;
    const color = props.color || 'var(--brand,#6366f1)';
    const mid = size / 2;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
                <circle cx={mid} cy={mid} r={r} fill="none" stroke="rgba(148,163,184,.26)" strokeWidth={stroke} />
                <circle cx={mid} cy={mid} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={on.toFixed(1) + ' ' + Math.max(0, c - on).toFixed(1)}
                    transform={'rotate(-90 ' + mid + ' ' + mid + ')'} />
                <text x={mid} y={mid + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={size / 6} fontWeight={800} fill={color} fontFamily="inherit">
                    {/* 用 hs13FmtPct 统一口径（0.9756 → 97.6%）：此前 Math.round 得 98%，
                        与页面其他覆盖率文案（97.6%）不一致，白盒读数会互相打脸。 */}
                    {hs13FmtPct(pct)}</text>
            </svg>
            {props.children || null}
        </div>
    );
}
/** 体系总览的模块卡 props：图标 + 名称 + 权重/目标用时/题量 + 覆盖率条 + 语料统计 */
interface Hs13ModuleCardProps { m?: any; cov?: any; onPick?: any }
/** 体系总览的模块卡：图标 + 名称 + 权重/目标用时/题量 + 覆盖率条 + 语料统计 */
function Hs13ModuleCard(props) {
    const m = props && props.m ? props.m : {};
    const cov = props && props.cov ? props.cov : null;
    const color = hs13ColorOf(m);
    const pct = cov ? hs13Clamp01(cov.coverage) * 100 : 0;
    const docs = Array.isArray(m.docs) ? m.docs : [];
    const exs = Array.isArray(m.examples) ? m.examples : [];
    const present = docs.filter((d) => d && d.present !== false).length;
    const pick = props && props.onPick ? props.onPick : null;
    return (
        <div style={{
            border: '1px solid rgba(148,163,184,.22)', borderRadius: 14, padding: 14,
            background: 'var(--surface-card,#fff)', position: 'relative', overflow: 'hidden',
            cursor: pick ? 'pointer' : 'default', transition: 'transform .15s, box-shadow .15s',
        }} onClick={pick ? () => pick(m) : undefined}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 19, lineHeight: 1 }}>{m.icon || '📄'}</span>
                <span style={{ fontWeight: 800, fontSize: 13.5 }}>{m.label || m.id || '模块'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: color }}>{pct.toFixed(0) + '%'}</span>
            </div>
            <Bar pct={pct} color={color} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(99,102,241,.10)', color: '#4f46e5' }}>{'权重 ' + (hs13Num(m.weight) || 1)}</span>
                <span style={{ ...KV_TAG, fontSize: 10 }}>{'⏱ ' + (hs13Num(m.targetMinutes) || 0) + ' 分'}</span>
                <span style={{ ...KV_TAG, fontSize: 10 }}>{'🎯 ' + (hs13Num(m.targetQuestions) || 0) + ' 题'}</span>
            </div>
            <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 7 }}>{'语料 ' + present + '/' + docs.length + ' 篇' + (exs.length ? ' · 练习 ' + exs.length + ' 套' : '')}</div>
            {cov ? <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 3 }}>{'表格 ' + (hs13Num(cov.tables) || 0) + ' · 公式 ' + (hs13Num(cov.formulas) || 0) + ' · ' + hs13FmtChars(cov.chars)}</div> : null}
            {pick ? <div style={{ fontSize: 10.5, color: color, fontWeight: 700, marginTop: 7 }}>查看目录 →</div> : null}
        </div>
    );
}
/* ═══════════════════ ① 体系总览 ═══════════════════ */
/** 体系总览分区 props（api：学习服务通道；onPick：点模块卡跳目录浏览） */
interface Hs13OverviewProps { api?: any; onPick?: any }
function Hs13Overview(props) {
    const api = props && props.api;
    const [cat, setCat] = React.useState(null);
    const [cov, setCov] = React.useState(null);
    const [err, setErr] = React.useState('');
    React.useEffect(() => {
        let dead = false;
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return () => { };
        }
        setErr('');
        (async () => {
            try {
                const [c1, c2] = await Promise.all([
                    api('/huasheng13/catalog').catch(() => null),
                    api('/huasheng13/coverage').catch(() => null),
                ]);
                if (dead)
                    return;
                setCat(c1 && typeof c1 === 'object' ? c1 : null);
                setCov(c2 && typeof c2 === 'object' ? c2 : null);
            }
            catch (e) {
                if (!dead)
                    setErr(String((e && e.message) || e));
            }
        })();
        return () => { dead = true; };
    }, [api]);
    const mods = cat && Array.isArray(cat.modules) ? cat.modules : [];
    const covById = {};
    const covMods = cov && Array.isArray(cov.modules) ? cov.modules : [];
    for (const m of covMods)
        if (m && m.id)
            covById[String(m.id)] = m;
    const meta = (cat && cat.meta) || {};
    const overall = cov ? hs13Clamp01(cov.overall) : 0;
    const docCount = hs13Num(meta.docCount) || mods.reduce((a, m) => a + (Array.isArray(m.docs) ? m.docs.length : 0) + (Array.isArray(m.examples) ? m.examples.length : 0), 0);
    const available = meta.available != null ? hs13Num(meta.available) : docCount;
    const gaps = cov && Array.isArray(cov.gaps) ? cov.gaps : [];
    const pick = typeof (props && props.onPick) === 'function' ? props.onPick : null;
    return (
        <div>
            {/* ── 头部条：版本 / 语料可用性 / 索引状态（字段缺失整项不渲染）── */}
            <div style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14,
                padding: '10px 14px', borderRadius: 12,
                background: 'linear-gradient(135deg,rgba(99,102,241,.08),rgba(20,184,166,.06))',
                border: '1px solid rgba(99,102,241,.22)',
            }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>📖 花生十三体系方法论</span>
                {meta.version ? <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#059669' }}>{'v' + meta.version}</span> : null}
                <span style={{ ...KV_TAG }}>{'语料 ' + available + '/' + docCount + ' 篇'}</span>
                {meta.builtAt ? <span style={{ ...KV_TAG, fontSize: 10 }}>{'索引 ' + hs13FmtTime(meta.builtAt)}</span> : null}
                {meta.degraded ? <span style={{ ...KV_TAG, background: 'rgba(245,158,11,.14)', color: '#b45309' }}>⚠ 索引降级（部分语料未命中）</span> : null}
                {meta.upstream ? <a href={String(meta.upstream)} target="_blank" rel="noreferrer noopener"
                    style={{ ...KV_BTN, marginLeft: 'auto', textDecoration: 'none', fontSize: 10.5 }}>上游语料 ↗</a> : null}
            </div>
            {err ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + err + '（服务可用时自动恢复）'}</div> : null}
            {cov && cov.degraded ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ 覆盖矩阵降级：' + String(cov.error || '索引未就绪')}</div> : null}
            {/* ── 覆盖率环 + 量化卡 ── */}
            <Card title="📊 体系覆盖率">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, alignItems: 'center' }}>
                    <Hs13Donut pct={overall} size={104} color="var(--brand,#6366f1)">
                        <div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>六模块加权覆盖</div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{'缺口 ' + gaps.length + ' 项' + (cov && cov.expectedDims ? ' · 维度 ' + hs13Num(cov.presentDims) + '/' + hs13Num(cov.expectedDims) : '')}</div>
                        </div>
                    </Hs13Donut>
                    <Stat v={mods.length || covMods.length || 0} l="模块" color="#6366f1" />
                    <Stat v={docCount} l="语料篇数" color="#0ea5e9" />
                    <Stat v={covMods.reduce((a, m) => a + (hs13Num(m.formulas) || 0), 0)} l="公式条目" color="#f59e0b" />
                    <Stat v={covMods.reduce((a, m) => a + (hs13Num(m.tables) || 0), 0)} l="表格数" color="#10b981" />
                </div>
            </Card>
            {/* ── 六模块卡网格（auto-fit → <720px 自然单列）── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12, marginBottom: 14 }}>
                {mods.length
                    ? mods.map((m, i) => <Hs13ModuleCard {...{ key: 'hs13mod' + i }} m={m} cov={covById[String(m.id)] || null}
                        onPick={pick ? (mm) => pick(mm) : null} />)
                    : <div style={{ fontSize: 12, color: '#64748b' }}>{cat ? '目录暂无可展示的模块' : '正在读取方法论目录…'}</div>}
            </div>
            {/* ── 缺口清单（有则列，无则一句「无缺口」）── */}
            <Card title="🧩 覆盖缺口">
                {gaps.length
                    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {gaps.slice(0, 24).map((g, i) => <div {...{ key: 'hs13gap' + i }}
                            style={{ fontSize: 11.5, color: '#475569', padding: '5px 9px', borderRadius: 8, background: 'rgba(245,158,11,.08)' }}>
                            {'· ' + String(g.label || g.module || '模块') + '：' + String(g.detail || '')}
                        </div>)}
                    </div>
                    : <div style={{ fontSize: 11.5, color: '#059669' }}>✓ 六模块语料维度齐全，无覆盖缺口</div>}
            </Card>
        </div>
    );
}
/* ═══════════════════ ② 目录浏览 ═══════════════════ */
/** 单篇全文阅读器 props（自管 fetch；key=file 由父组件控制重挂载，切换即干净重取） */
interface Hs13DocReaderProps { api?: any; file?: any }
/** 单篇全文阅读器（自管 fetch；key=file 由父组件控制重挂载，切换即干净重取） */
function Hs13DocReader(props) {
    const api = props && props.api;
    const file = String((props && props.file) || '');
    const [doc, setDoc] = React.useState(null);
    const [err, setErr] = React.useState('');
    React.useEffect(() => {
        let dead = false;
        setDoc(null);
        setErr('');
        if (!file)
            return () => { };
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return () => { };
        }
        ;
        (async () => {
            try {
                const d = await api('/huasheng13/doc?file=' + encodeURIComponent(file));
                if (dead)
                    return;
                if (d && d.error && !d.markdown)
                    setErr(String(d.error));
                else
                    setDoc(d && typeof d === 'object' ? d : null);
            }
            catch (e) {
                if (!dead)
                    setErr(String((e && e.message) || e));
            }
        })();
        return () => { dead = true; };
    }, [api, file]);
    if (!file) {
        return <Card title="📄 全文阅读"><div style={{ fontSize: 12, color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>← 从左侧目录选择一篇语料</div></Card>;
    }
    if (err) {
        return <Card title={'📄 ' + file}><div style={{ fontSize: 12, color: '#b45309' }}>{'⚠ ' + err}</div><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>请到「📦 题库管理」安装或重装必选包 huasheng13</div></Card>;
    }
    if (!doc) {
        return <div className="kg-load" style={{ padding: 30 }}><div className="kg-spin" />读取语料…</div>;
    }
    const markdown = String(doc.markdown || '');
    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>{String(doc.title || file)}</span>
                {doc.weight != null ? <span style={{ ...KV_TAG, background: 'rgba(245,158,11,.12)', color: '#b45309' }}>{'密度 ' + hs13Fmt2(doc.weight)}</span> : null}
                <span style={{ ...KV_TAG, fontSize: 10 }}>{hs13FmtChars(doc.chars)}</span>
                <span style={{ ...KV_TAG, fontSize: 10 }}>{'表 ' + (hs13Num(doc.tables) || 0)}</span>
                <span style={{ ...KV_TAG, fontSize: 10 }}>{'式 ' + (hs13Num(doc.formulas) || 0)}</span>
                {doc.sectionCount ? <span style={{ ...KV_TAG, fontSize: 10 }}>{'节 ' + hs13Num(doc.sectionCount)}</span> : null}
                <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{String(doc.file || file)}</span>
            </div>
            <div style={{
                background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.2)',
                borderRadius: 12, padding: '6px 16px 16px', maxHeight: '62vh', overflowY: 'auto',
            }}><Hs13Markdown src={markdown} /></div>
        </div>
    );
}
/** 目录浏览分区 props（initial* 供跨分区跳转注入） */
interface Hs13CatalogProps { api?: any; initialModule?: any; initialFile?: any }
function Hs13Catalog(props) {
    const api = props && props.api;
    const [cat, setCat] = React.useState(null);
    const [err, setErr] = React.useState('');
    const [modId, setModId] = React.useState(String((props && props.initialModule) || ''));
    const [file, setFile] = React.useState(String((props && props.initialFile) || ''));
    React.useEffect(() => {
        let dead = false;
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return () => { };
        }
        ;
        (async () => {
            try {
                const c = await api('/huasheng13/catalog');
                if (!dead)
                    setCat(c && typeof c === 'object' ? c : null);
            }
            catch (e) {
                if (!dead)
                    setErr(String((e && e.message) || e));
            }
        })();
        return () => { dead = true; };
    }, [api]);
    const groups = hs13CatalogGroups(cat);
    const cur = groups.find((g) => g.id === modId) || groups[0] || null;
    const docs = cur ? cur.docs : [];
    const sel = file || (docs[0] ? docs[0].file : '');
    const pickDoc = (f) => setFile(f);
    /** 左栏：模块胶囊 + 当前模块文档列表 */
    const left = (
        <div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                {groups.length
                    ? groups.map((g) => <button {...{ key: 'hs13g' + g.id }}
                        style={{
                            ...KV_BTN, border: 0, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 8,
                            ...(cur && cur.id === g.id ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' } : {}),
                        }}
                        onClick={() => { setModId(g.id); setFile(''); }}>{g.icon + ' ' + g.label}</button>)
                    : <span style={{ fontSize: 11.5, color: '#64748b' }}>{cat ? '目录暂缺' : '读取目录…'}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {docs.length
                    ? docs.map((d) => {
                        const on = d.file === sel;
                        return (
                            <div {...{ key: 'hs13d' + d.file }}
                                style={{
                                    padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
                                    border: '1px solid ' + (on ? hs13ColorOf(cur) : 'rgba(148,163,184,.22)'),
                                    background: on ? 'rgba(99,102,241,.07)' : 'transparent',
                                }}
                                onClick={() => pickDoc(d.file)}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ fontSize: 11.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                                    {d.kind === 'example' ? <span style={{ ...KV_TAG, fontSize: 9, padding: '1px 6px', background: 'rgba(16,185,129,.12)', color: '#059669' }}>练习</span> : null}
                                </div>
                                {d.desc ? <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3, lineHeight: 1.55 }}>{d.desc}</div> : null}
                                <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 3 }}>{[hs13FmtChars(d.chars), d.tables != null ? '表 ' + hs13Num(d.tables) : '', d.formulas != null ? '式 ' + hs13Num(d.formulas) : ''].filter(Boolean).join(' · ')}</div>
                            </div>
                        );
                    })
                    : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>该分组暂无文档</div>}
            </div>
        </div>
    );
    /** 右栏：全文（key 含 file → 切文档即重挂载重新取数，父 hook 链恒定） */
    const right = <div><Hs13DocReader {...{ key: 'hs13doc-' + sel }} api={api} file={sel} /></div>;
    return (
        <div>
            {err ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + err + '（服务可用时自动恢复）'}</div> : null}
            {/* 两栏：auto-fit 280px → <720px 单列堆叠，>=720px 并排两栏（无需 JS 媒体查询） */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, alignItems: 'start' }}>{left}{right}</div>
        </div>
    );
}
/* ═══════════════════ ③ 检索 ═══════════════════ */
/** 检索分区 props */
interface Hs13SearchProps { api?: any }
function Hs13Search(props) {
    const api = props && props.api;
    const [q, setQ] = React.useState('');
    const [res, setRes] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState('');
    const [openFile, setOpenFile] = React.useState('');
    const run = async (text) => {
        const query = String(text == null ? '' : text).trim();
        setOpenFile('');
        setErr('');
        if (!query) {
            setRes(null);
            return;
        }
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return;
        }
        setBusy(true);
        try {
            const d = await api('/huasheng13/search?q=' + encodeURIComponent(query) + '&limit=10');
            setRes(d && typeof d === 'object' ? d : null);
        }
        catch (e) {
            setErr(String((e && e.message) || e));
        }
        finally {
            setBusy(false);
        }
    };
    const results = res && Array.isArray(res.results) ? res.results : [];
    const conf = res && res.confidence ? String(res.confidence) : '';
    const confMeta = conf === 'high'
        ? { text: '精确命中', bg: 'rgba(16,185,129,.12)', fg: '#059669' }
        : conf === 'medium'
            ? { text: '全词共现', bg: 'rgba(99,102,241,.12)', fg: '#4f46e5' }
            : conf === 'low' ? { text: '部分命中', bg: 'rgba(245,158,11,.14)', fg: '#b45309' } : null;
    return (
        <div>
            {/* 搜索框 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input value={q}
                    placeholder="输入考点/方法名，如 截位直除、假设分配、ABRX"
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e && (e.key === 'Enter' || e.keyCode === 13))
                        run(q); }}
                    style={{
                        flex: '1 1 220px', minWidth: 0, padding: '8px 12px', borderRadius: 10,
                        border: '1.5px solid rgba(148,163,184,.35)', fontSize: 13, fontFamily: 'inherit',
                        background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)', outline: 'none',
                    }} />
                <button style={{ ...KV_BTN, padding: '8px 16px', fontWeight: 700 }}
                    onClick={() => run(q)}>{busy ? '检索中…' : '检索'}</button>
            </div>
            {/* 快捷词 */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 10.5, color: '#94a3b8', alignSelf: 'center' }}>快捷：</span>
                {HS13_QUICK_SEARCH.map((w) => <button {...{ key: 'hs13q' + w }}
                    style={{ ...KV_BTN, borderRadius: 20, padding: '2px 11px', fontSize: 11 }}
                    onClick={() => { setQ(w); run(w); }}>{w}</button>)}
            </div>
            {err ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + err}</div> : null}
            {res && res.degraded ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ 检索降级：' + String(res.error || '索引未就绪')}</div> : null}
            {/* 结果摘要行：took 毫秒必显（性能可感知），置信度提示不丢结果只提示 */}
            {res && !res.degraded ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 11 }}>
                <span style={{ color: '#64748b' }}>{'「' + String(res.query || q) + '」命中 ' + results.length + ' 篇 · ' + hs13Fmt2(res.took) + ' ms'}</span>
                {confMeta ? <span style={{ ...KV_TAG, background: confMeta.bg, color: confMeta.fg, fontSize: 10 }}>{confMeta.text}</span> : null}
                {res.phraseHit ? <span style={{ ...KV_TAG, fontSize: 10 }}>整串命中</span> : null}
                {res.filtered ? <span style={{ fontSize: 10, color: '#94a3b8' }}>{'（长尾已裁 ' + hs13Num(res.filtered) + ' 条）'}</span> : null}
                {res.coverage != null ? <span style={{ fontSize: 10, color: '#94a3b8' }}>{'词覆盖 ' + hs13FmtPct(res.coverage)}</span> : null}
            </div> : null}
            {/* 空态/提示（服务端 note 直接透出，绝不臆造） */}
            {res && !results.length && !busy
                ? <div style={{ fontSize: 12, color: '#64748b', padding: '16px 0' }}>{String(res.note || '未找到匹配语料')}</div>
                : null}
            {!res && !busy ? <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>BM25 全文检索内置 25 篇语料：中文按字符 bigram + 单字双粒度切分，title×3 / heading×2 / 正文×1 加权。</div> : null}
            {/* 结果列表 */}
            {results.length
                ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {results.map((r, i) => {
                        const on = r.file === openFile;
                        return (
                            <div {...{ key: 'hs13r' + (r.file || i) }}
                                style={{
                                    border: '1px solid ' + (on ? 'rgba(99,102,241,.5)' : 'rgba(148,163,184,.22)'),
                                    borderRadius: 12, padding: 12, background: 'var(--surface-card,#fff)', cursor: 'pointer',
                                }}
                                onClick={() => setOpenFile(on ? '' : String(r.file || ''))}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 800, fontSize: 12.5, flex: 1, minWidth: 120 }}>{String(r.title || r.file || '未命名')}</span>
                                    <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(99,102,241,.10)', color: '#4f46e5' }}>{'score ' + hs13Fmt2(r.score)}</span>
                                    {r.moduleId ? <span style={{ ...KV_TAG, fontSize: 10 }}>{String(r.moduleId)}</span> : null}
                                    <span style={{ fontSize: 10, color: '#94a3b8' }}>{String(r.file || '')}</span>
                                </div>
                                {(Array.isArray(r.snippets) ? r.snippets : []).slice(0, 2).map((s, si) => <div {...{ key: 'hs13sn' + si }}>
                                    {s && s.heading ? <div style={{ fontSize: 10.5, color: '#6366f1', fontWeight: 700, marginTop: 6 }}>{'§ ' + String(s.heading)}</div> : null}
                                    <Hs13Snippet text={(s && s.text) || ''} terms={r.terms} />
                                </div>)}
                                {!(Array.isArray(r.snippets) && r.snippets.length) && r.highlight
                                    ? <Hs13Snippet text={String(r.highlight)} terms={r.terms} /> : null}
                                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 7 }}>{on ? '▾ 收起全文' : '▸ 展开全文'}{Array.isArray(r.terms) && r.terms.length ? ' · 命中词：' + r.terms.slice(0, 8).join(' / ') : ''}</div>
                            </div>
                        );
                    })}
                </div>
                : null}
            {/* 展开的全文阅读器（真组件挂载） */}
            {openFile ? <div style={{ marginTop: 14 }}><Hs13DocReader {...{ key: 'hs13sdoc-' + openFile }} api={api} file={openFile} /></div> : null}
        </div>
    );
}
/* ═══════════════════ ④ 配套练习 ═══════════════════ */
/** 配套练习分区 props（initialFile 供检索跳题注入） */
interface Hs13PracticeProps { api?: any; initialFile?: any }
function Hs13Practice(props) {
    const api = props && props.api;
    const [files, setFiles] = React.useState([]);
    const [file, setFile] = React.useState(String((props && props.initialFile) || 'ziliao-lianxi'));
    const [data, setData] = React.useState(null);
    const [err, setErr] = React.useState('');
    const [idx, setIdx] = React.useState(0);
    const [marks, setMarks] = React.useState({});
    const [nonce, setNonce] = React.useState(0);
    // 练习文件清单：六模块 examples + 顶层 examples（字段缺失则清单为空，不影响主流程）
    React.useEffect(() => {
        let dead = false;
        if (typeof api !== 'function')
            return () => { };
        (async () => {
            try {
                const c = await api('/huasheng13/catalog').catch(() => null);
                if (dead)
                    return;
                const list = [];
                const mods = c && Array.isArray(c.modules) ? c.modules : [];
                for (const m of mods) {
                    for (const e of (Array.isArray(m.examples) ? m.examples : [])) {
                        if (e && e.file)
                            list.push({ file: String(e.file), title: String(e.title || e.file), label: (m.label || '') + ' · ' + String(e.title || e.file), color: hs13ColorOf(m) });
                    }
                }
                for (const e of (c && Array.isArray(c.examples) ? c.examples : [])) {
                    if (e && e.file)
                        list.push({ file: String(e.file), title: String(e.title || e.file), label: '真题 · ' + String(e.title || e.file), color: '#10b981' });
                }
                setFiles(list);
                if (list.length) {
                    setFile((prev) => (list.some((x) => x.file === prev) ? prev : list[0].file));
                }
            }
            catch {
                if (!dead)
                    setFiles([]);
            }
        })();
        return () => { dead = true; };
    }, [api]);
    // 抽题：file / nonce（重抽）变化即重取；n=20 一次取足，前端分页
    React.useEffect(() => {
        let dead = false;
        setData(null);
        setErr('');
        setIdx(0);
        if (!file)
            return () => { };
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return () => { };
        }
        ;
        (async () => {
            try {
                const d = await api('/huasheng13/practice?file=' + encodeURIComponent(file) + '&n=20');
                if (dead)
                    return;
                setData(d && typeof d === 'object' ? d : null);
            }
            catch (e) {
                if (!dead)
                    setErr(String((e && e.message) || e));
            }
        })();
        return () => { dead = true; };
    }, [api, file, nonce]);
    const items = data && Array.isArray(data.items) ? data.items : [];
    const cur = items.length ? items[Math.min(idx, items.length - 1)] : null;
    const mk = cur ? String(cur.index) : '';
    const st = (mk && marks[mk]) || {};
    const answerKey = cur ? hs13AnswerKey(cur.answer) : '';
    // ★ answerIsLetter 分支判据：只有「标注可判 + 有字母答案 + 选项非空」才走自动判分
    const canAuto = hs13CanAutoGrade(cur);
    const optCount = cur && Array.isArray(cur.options) ? cur.options.length : 0;
    const revealed = !!st.revealed;
    const selfMark = st.self === 'right' || st.self === 'wrong' ? st.self : '';
    const showVerdict = canAuto ? revealed : !!selfMark;
    const isRight = canAuto ? (revealed && !!st.chosen && st.chosen === answerKey) : selfMark === 'right';
    const patchMark = (k, patch) => setMarks((prev) => {
        if (!k)
            return prev;
        const next = Object.assign({}, prev);
        next[k] = Object.assign({}, prev[k] || {}, patch);
        return next;
    });
    // 本地统计（判分完全离线：不改服务端状态，不做 SRS 回写）
    let answered = 0;
    let correct = 0;
    for (const k of Object.keys(marks)) {
        const it = items.find((x) => String(x.index) === k);
        if (!it)
            continue;
        const m = marks[k] || {};
        if (hs13CanAutoGrade(it)) {
            if (m.revealed && m.chosen) {
                answered++;
                if (String(m.chosen) === hs13AnswerKey(it.answer))
                    correct++;
            }
        }
        else if (m.self === 'right' || m.self === 'wrong') {
            answered++;
            if (m.self === 'right')
                correct++;
        }
    }
    const pickFileChip = (f) => { setFile(f); setMarks({}); };
    /* ── 选项区：自动判分分支用可点击 OptionRow；否则只读参考列表 ── */
    const optionRows = optCount
        ? cur.options.map((o) => {
            const key = String(o && o.key != null ? o.key : '');
            const text = String(o && o.text != null ? o.text : '');
            // 自动判分分支的状态着色；只读分支统一 idle（不可点）
            let state = 'idle';
            if (canAuto) {
                if (revealed && key === answerKey)
                    state = 'right';
                else if (revealed && key === st.chosen)
                    state = 'wrong';
                else if (!revealed && key === st.chosen)
                    state = 'chosen';
            }
            return <OptionRow {...{ key: 'hs13opt-' + key }}
                label={key || '?'} text={text} state={state}
                disabled={!canAuto || revealed}
                onClick={() => patchMark(mk, { chosen: key })} />;
        })
        : null;
    return (
        <div>
            {/* ── 练习集选择（胶囊）── */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>练习集：</span>
                {files.length
                    ? files.map((f) => <button {...{ key: 'hs13pf' + f.file }}
                        style={{
                            ...KV_BTN, borderRadius: 20, padding: '2px 11px', fontSize: 11,
                            ...(f.file === file ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}),
                        }}
                        onClick={() => pickFileChip(f.file)}>{f.label || f.title}</button>)
                    : <span style={{ fontSize: 11, color: '#94a3b8' }}>练习清单读取中…</span>}
                <button style={{ ...KV_BTN, marginLeft: 'auto', fontSize: 11 }}
                    onClick={() => { setMarks({}); setNonce((n) => n + 1); }}>↻ 重新抽题</button>
            </div>
            {err ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + err}</div> : null}
            {data && data.degraded ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + String(data.error || '语料缺失，练习不可用')}</div> : null}
            {data && data.note ? <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>{'ℹ ' + String(data.note)}</div> : null}
            {!items.length && !err && data
                ? <div style={{ fontSize: 12, color: '#64748b', padding: '14px 0' }}>该语料没有可抽取的练习题，试试其他练习集。</div>
                : null}
            {!data && !err ? <div className="kg-load" style={{ padding: 26 }}><div className="kg-spin" />抽取练习题…</div> : null}
            {cur ? <Card title={'✏️ ' + String(cur.title || '练习 ' + (idx + 1))}>
                {/* 题头元信息 */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 9 }}>
                    <span style={{ ...KV_TAG, fontSize: 10 }}>{'第 ' + (idx + 1) + ' / ' + items.length + ' 题'}</span>
                    {cur.category ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(14,165,233,.12)', color: '#0369a1' }}>{String(cur.category)}</span> : null}
                    {canAuto
                        ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(16,185,129,.12)', color: '#059669' }}>可自动判分</span>
                        : <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(245,158,11,.14)', color: '#b45309' }}>自评题（无字母答案）</span>}
                    <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{'已答 ' + answered + ' · 正确 ' + correct}</span>
                </div>
                {/* 题干（材料/问题，markdown 渲染） */}
                <div style={{ fontSize: 13, lineHeight: 1.85 }}><Hs13Markdown src={String(cur.stem || '')} /></div>
                {/* ── 选项：有选项才渲染；canAuto 时可点，否则只读参考 ── */}
                {optCount
                    ? <div style={{ marginTop: 10 }}>{optionRows}{!canAuto ? <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 6 }}>（本题选项仅供参考：服务端未提供可判分的字母答案，请直接「查看解析」后自评）</div> : null}</div>
                    : <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8 }}>（本题为主观/无选项题，直接展开解析后自评）</div>}
                {/* ── 操作区：两条互斥路径 ── */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                    {canAuto
                        // ① 自动判分：提交判分（选了才可点）→ 已判分后显示下一题
                        ? (revealed
                            ? <span style={{ fontSize: 12, fontWeight: 800, color: isRight ? '#059669' : '#dc2626' }}>{isRight ? '✓ 回答正确' : '✗ 回答错误（正确答案 ' + (answerKey || '—') + '）'}</span>
                            : <button style={{ ...KV_BTN, padding: '7px 16px', fontWeight: 700, ...(st.chosen ? { borderColor: '#6366f1', color: '#4f46e5' } : {}) }}
                                onClick={() => { if (st.chosen)
                                    patchMark(mk, { revealed: true }); }}>{st.chosen ? '提交判分' : '请先选择一项'}</button>)
                        // ② 自评路径：查看解析 / 我答对了 / 我没答对（绝不渲染空壳选择题）
                        : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <button style={{ ...KV_BTN, padding: '7px 14px', fontWeight: 700 }}
                                onClick={() => patchMark(mk, { revealed: !revealed })}>{revealed ? '▾ 收起解析' : '▸ 查看解析'}</button>
                            <button style={{ ...KV_BTN, padding: '7px 14px', fontWeight: 700, ...(selfMark === 'right' ? { borderColor: '#10b981', color: '#059669', background: 'rgba(16,185,129,.09)' } : {}) }}
                                onClick={() => patchMark(mk, { self: 'right', revealed: true })}>✓ 我答对了</button>
                            <button style={{ ...KV_BTN, padding: '7px 14px', fontWeight: 700, ...(selfMark === 'wrong' ? { borderColor: '#ef4444', color: '#dc2626', background: 'rgba(239,68,68,.08)' } : {}) }}
                                onClick={() => patchMark(mk, { self: 'wrong', revealed: true })}>✗ 我没答对</button>
                            {selfMark ? <span style={{ fontSize: 11.5, fontWeight: 700, color: selfMark === 'right' ? '#059669' : '#dc2626' }}>{selfMark === 'right' ? '已记为答对' : '已记为答错'}</span> : null}
                        </div>}
                    {/* 翻页 */}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button style={{ ...KV_BTN, fontSize: 11 }}
                            onClick={() => setIdx((n) => Math.max(0, n - 1))}>← 上一题</button>
                        <button style={{ ...KV_BTN, fontSize: 11 }}
                            onClick={() => setIdx((n) => Math.min(items.length - 1, n + 1))}>下一题 →</button>
                    </span>
                </div>
                {/* ── 判分后：解析 + 易错点（纯展示，无 alert 角色）── */}
                {showVerdict ? <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed rgba(148,163,184,.35)' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: '#4f46e5' }}>📖 解析</span>
                        {/* 答案原文：非字母形态也如实展示（它是解析结论，不是判分依据） */}
                        {String(cur.answer || '')
                            ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(99,102,241,.10)', color: '#4338ca' }}>{'答案：' + String(cur.answer)}</span>
                            : <span style={{ ...KV_TAG, fontSize: 10 }}>无标准答案</span>}
                    </div>
                    {cur.analysis
                        ? <Hs13Markdown src={String(cur.analysis)} />
                        : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>（该题未附解析正文）</div>}
                    {cur.pitfalls ? <div style={{ marginTop: 8, padding: '8px 11px', borderRadius: 9, background: 'rgba(239,68,68,.06)', borderLeft: '3px solid rgba(239,68,68,.5)' }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', marginBottom: 3 }}>⚠️ 易错点</div>
                        <div style={{ fontSize: 11.5, lineHeight: 1.75, color: '#475569', whiteSpace: 'pre-wrap' }}>{String(cur.pitfalls)}</div>
                    </div> : null}
                </div> : null}
            </Card> : null}
        </div>
    );
}
/* ═══════════════════ ⑤ 白盒链路 ═══════════════════ */
/** 白盒链路分区 props */
interface Hs13TraceProps { api?: any }
function Hs13Trace(props) {
    const api = props && props.api;
    const [tr, setTr] = React.useState(null);
    const [err, setErr] = React.useState('');
    const [nonce, setNonce] = React.useState(0);
    React.useEffect(() => {
        let dead = false;
        if (typeof api !== 'function') {
            setErr('学习服务通道未就绪');
            return () => { };
        }
        ;
        (async () => {
            try {
                const d = await api('/huasheng13/trace');
                if (dead)
                    return;
                setTr(d && typeof d === 'object' ? d : null);
                setErr('');
            }
            catch (e) {
                if (!dead)
                    setErr(String((e && e.message) || e));
            }
        })();
        return () => { dead = true; };
    }, [api, nonce]);
    const eps = (tr && tr.endpoints && typeof tr.endpoints === 'object') ? tr.endpoints : {};
    const epRows = Object.keys(eps).map((p) => ({
        path: p,
        label: HS13_EP_LABEL[p] || p,
        hits: hs13Num(eps[p] && eps[p].hits),
        p50: hs13Num(eps[p] && eps[p].p50),
        p95: hs13Num(eps[p] && eps[p].p95),
        lastAt: hs13Num(eps[p] && eps[p].lastAt),
        samples: hs13Num(eps[p] && eps[p].samples),
    }));
    const maxHits = epRows.reduce((a, r) => Math.max(a, r.hits), 0);
    const totalHits = epRows.reduce((a, r) => a + r.hits, 0);
    const worstP95 = epRows.reduce((a, r) => Math.max(a, r.p95), 0);
    const s = (tr && tr.searches) || {};
    const reads = (tr && tr.docs && tr.docs.reads) || {};
    const recent = tr && Array.isArray(tr.recent) ? tr.recent : [];
    const decl = (tr && tr.declaration) || {};
    const corpus = (tr && tr.corpus) || {};
    const ring = (tr && tr.ring) || {};
    const frozenRows = epRows.slice().sort((a, b) => b.hits - a.hits);
    return (
        <div>
            {/* 刷新条 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 11.5, color: '#64748b' }}>本域调用计数（按工作区分槽隔离，?ws= 互不污染）</span>
                <button style={{ ...KV_BTN, padding: '4px 12px', fontWeight: 700 }}
                    onClick={() => setNonce((n) => n + 1)}>↻ 刷新</button>
                {tr && tr.at ? <span style={{ fontSize: 10, color: '#94a3b8' }}>{'采样 ' + hs13FmtTime(tr.at)}</span> : null}
            </div>
            {err ? <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 10 }}>{'⚠ ' + err}</div> : null}
            {!tr && !err ? <div className="kg-load" style={{ padding: 26 }}><div className="kg-spin" />读取链路追踪…</div> : null}
            {/* 量化卡 */}
            {tr ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
                <Stat v={totalHits} l="端点总命中" color="#6366f1" />
                <Stat v={hs13FmtPct(s.hitRate)} l="检索命中率" color={hs13Num(s.hitRate) >= 0.5 ? '#10b981' : '#f59e0b'} />
                <Stat v={hs13Num(s.total)} l="检索次数" color="#0ea5e9" />
                <Stat v={hs13Fmt2(worstP95)} l="最差 p95 (ms)" color={worstP95 > 200 ? '#ef4444' : '#10b981'} />
                <Stat v={hs13Num(tr.docs && tr.docs.distinct)} l="被读语料" color="#8b5cf6" />
            </div> : null}
            {/* 端点表（命中 / p50 / p95 / 最近调用） */}
            {tr ? <Card title="📡 端点命中与延迟">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {epRows.map((r) => <div {...{ key: 'hs13ep' + r.path }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
                            <span style={{ fontWeight: 700, minWidth: 86 }}>{r.label}</span>
                            <span style={{ ...KV_TAG, fontSize: 9.5 }}>{'p50 ' + hs13Fmt2(r.p50)}</span>
                            <span style={{ ...KV_TAG, fontSize: 9.5, background: r.p95 > 200 ? 'rgba(239,68,68,.12)' : 'rgba(148,163,184,.15)', color: r.p95 > 200 ? '#dc2626' : '#64748b' }}>{'p95 ' + hs13Fmt2(r.p95)}</span>
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>{'末次 ' + hs13FmtTime(r.lastAt)}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 800, color: r.hits ? '#4f46e5' : '#cbd5e1' }}>{String(r.hits)}</span>
                        </div>
                        <div style={{ marginTop: 4 }}><Bar pct={maxHits ? (r.hits / maxHits) * 100 : 0} color={r.hits ? '#6366f1' : 'rgba(148,163,184,.35)'} /></div>
                        <div style={{ fontSize: 9.5, color: '#cbd5e1', marginTop: 2 }}>{r.path}</div>
                    </div>)}
                </div>
            </Card> : null}
            {/* 检索与语料 */}
            {tr ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, alignItems: 'start' }}>
                <Card title="🔍 检索统计">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5 }}>
                        {hs13Kv('总检索', hs13Num(s.total))}
                        {hs13Kv('命中 / 未命中', hs13Num(s.hit) + ' / ' + hs13Num(s.miss))}
                        {hs13Kv('空查询', hs13Num(s.empty) + '（不计入命中率分母）')}
                        {hs13Kv('命中率', hs13FmtPct(s.hitRate))}
                    </div>
                    <div style={{ marginTop: 10 }}><Bar pct={hs13Clamp01(s.hitRate) * 100} color="#10b981" /></div>
                </Card>
                <Card title="📚 语料读取分布">
                    {Object.keys(reads).length
                        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5 }}>
                            {Object.keys(reads).slice(0, 12).map((f) => <div {...{ key: 'hs13rd' + f }} style={{ display: 'flex', gap: 8 }}>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }}>{f}</span>
                                <span style={{ fontWeight: 700, color: '#4f46e5' }}>{String(hs13Num(reads[f]))}</span>
                            </div>)}
                        </div>
                        : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>本次尚无单篇全文读取记录（进「目录浏览」点一篇即可产生）</div>}
                    <div style={{ marginTop: 10, fontSize: 10.5, color: '#94a3b8', lineHeight: 1.7 }}>{'索引源 ' + String(corpus.source || 'none') + ' · 构建 ' + hs13Fmt2(corpus.buildMs) + ' ms'
                        + (corpus.snapshotPresent ? ' · 快照已落盘' : ' · 无快照')
                        + (corpus.degraded ? ' · ⚠ 降级' : '')}</div>
                    {/* cycle-30（T-031 清偿）：语料更新提示——版本/更新时间 + 跳题库管理入口（不重复造安装器） */}
                    {corpus.updateHint ? <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.7, color: corpus.updateHint.stale ? '#b45309' : '#94a3b8' }}>
                        {'语料版本：最后变更 ' + String(corpus.updateHint.lastChangedAt || '—') + '（' + (corpus.updateHint.lastChangedDaysAgo || 0) + ' 天前）'}
                        {corpus.updateHint.stale ? ' · ⚠ 超过 30 天未更新' : ''}
                        <span style={{ marginLeft: 6, cursor: 'pointer', color: '#4f46e5', fontWeight: 700 }}
                            onClick={() => { try { if (typeof props.onGo === 'function') props.onGo('repos', {}) } catch {} }}
                            title="打开题库管理检查语料更新（pull 即可，fixtureHash 自动失效快照）">{'→ 去题库管理更新'}</span>
                    </div> : null}
                </Card>
            </div> : null}
            {/* 声明对账（白盒假阳性守卫） */}
            {tr && decl.endpoints ? <Card title="🧾 声明对账（路由 ↔ CAPABILITIES.endpoints）">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{
                        ...KV_TAG, fontSize: 10,
                        background: decl.allDeclared ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
                        color: decl.allDeclared ? '#059669' : '#dc2626',
                    }}>{decl.allDeclared ? '✓ 六端点全部已声明' : '✗ 存在未声明端点'}</span>
                    <span style={{ ...KV_TAG, fontSize: 10 }}>{'声明总数 ' + hs13Num(decl.declaredTotal)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#64748b' }}>
                    {(Array.isArray(decl.endpoints) ? decl.endpoints : []).map((d, i) => <div {...{ key: 'hs13dc' + i }}>{(d && d.declared ? '✓ ' : '✗ ') + String((d && d.path) || '')}</div>)}
                </div>
            </Card> : null}
            {/* 最近调用流 */}
            {tr ? <Card title={'🧵 最近调用流（环形缓冲尾部 ' + recent.length + ' 条）'}>
                {recent.length
                    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
                        {recent.slice().reverse().map((ev, i) => <div {...{ key: 'hs13ev' + i }}
                            style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 10.5, padding: '3px 7px', borderRadius: 7, background: i % 2 ? 'transparent' : 'rgba(148,163,184,.06)' }}>
                            <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace,Consolas,monospace', flexShrink: 0 }}>{hs13FmtTime(ev && ev.at)}</span>
                            <span style={{ ...KV_TAG, fontSize: 9, padding: '0 6px', background: 'rgba(99,102,241,.10)', color: '#4f46e5', flexShrink: 0 }}>{String((ev && ev.kind) || '—')}</span>
                            <span style={{ flex: 1, minWidth: 0, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String((ev && ev.detail) || '')}>{String((ev && ev.detail) || '')}</span>
                            {hs13Num(ev && ev.ms) ? <span style={{ color: '#94a3b8', flexShrink: 0 }}>{hs13Fmt2(ev.ms) + 'ms'}</span> : null}
                        </div>)}
                    </div>
                    : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>暂无调用记录（在上方四个分区各点一次即可产生链路事件）</div>}
                <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 8 }}>{'环形缓冲：事件 ' + hs13Num(ring.recentLen) + '/' + hs13Num(ring.recentCap)
                    + ' · 延迟样本上限 ' + hs13Num(ring.latCap)
                    + ' · 工作区槽位 ' + hs13Num(ring.slots) + '/' + hs13Num(ring.slotsCap)}</div>
            </Card> : null}
            {/* 最高频端点简表（warn 冻结：帮助定位「哪个端点最热」） */}
            {tr && frozenRows.length && maxHits > 0 ? <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>{'最热端点：' + frozenRows[0].label + '（' + frozenRows[0].hits + ' 次，点击上方「刷新」可更新计数）'}</div> : null}
        </div>
    );
}
/** trace 用的键值行（纯函数式小工具，无 hook） */
function hs13Kv(k, v) {
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ color: '#64748b', minWidth: 96 }}>{String(k)}</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary,#0f172a)' }}>{String(v)}</span>
        </div>
    );
}
/* ═══════════════════ 主视图 ═══════════════════ */
/**
 * 花生十三体系主视图（左栏「考公学习」面板的一级视图，id = 'huasheng13'）。
 *
 * 分区采用「懒挂载 + 常驻 + display:none 隐藏」模式（与专题枢纽同构）：
 * 首次进入某分区才挂载，切走不卸载 → 状态不丢、不重复请求；父组件 hook 数恒定。
 * 带 data-kg-hs13-tab 锚点供测试定位（分区是组件内 tab，非路由）。
 */
/** NativeHuasheng13View props（initialSection 供宿主路由注入口） */
interface NativeHuasheng13ViewProps { api?: any; initialSection?: string }
export function NativeHuasheng13View(props) {
    const api = props && props.api;
    const [sec, setSec] = React.useState(String((props && props.initialSection) || 'overview'));
    const [visited, setVisited] = React.useState({ overview: true });
    // 跨分区跳转参数：总览点模块 → 目录浏览定位到该模块；检索/练习共用同一注入口
    const [catalogSeed, setCatalogSeed] = React.useState({ moduleId: '', file: '' });
    const visit = (id) => {
        setSec(id);
        setVisited((v) => (v[id] ? v : Object.assign({}, v, { [id]: true })));
    };
    const jumpToCatalog = (m) => {
        const docs = m && Array.isArray(m.docs) ? m.docs : [];
        setCatalogSeed({ moduleId: String((m && m.id) || ''), file: docs.length ? String(docs[0].file || '') : '' });
        visit('catalog');
    };
    // 分区 tab 条（胶囊选中渐变；data-kg-hs13-tab 供测试/脚本锚定）
    const tabRow = (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, padding: 4, background: 'rgba(148,163,184,.09)', borderRadius: 12 }}>
            {HS13_SECTIONS.map((tb) => <button {...{ key: tb.id }} {...{ 'data-kg-hs13-tab': tb.id }}
                style={{
                    ...KV_BTN, border: 0, padding: '7px 15px', fontSize: 12.5, fontWeight: 700, borderRadius: 9,
                    ...(sec === tb.id ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' } : {}),
                }}
                onClick={() => visit(tb.id)}>{tb.label}</button>)}
        </div>
    );
    // 非当前分区 display:none 隐藏（保持挂载 → 状态不丢，R9：hook 链恒定）
    const wrap = (id, node) => <div {...{ key: 'hs13w-' + id }} style={sec === id ? undefined : { display: 'none' }}>{node}</div>;
    return (
        <div {...{ 'data-kg-hs13-root': '1' }}>
            {tabRow}
            {visited.overview ? wrap('overview', <Hs13Overview {...{ key: 'hs13-overview' }} api={api} onPick={jumpToCatalog} />) : null}
            {visited.catalog ? wrap('catalog', <Hs13Catalog {...{ key: 'hs13-catalog-' + catalogSeed.moduleId + '-' + catalogSeed.file }}
                api={api} initialModule={catalogSeed.moduleId} initialFile={catalogSeed.file} />) : null}
            {visited.search ? wrap('search', <Hs13Search {...{ key: 'hs13-search' }} api={api} />) : null}
            {visited.practice ? wrap('practice', <Hs13Practice {...{ key: 'hs13-practice' }} api={api} />) : null}
            {visited.trace ? wrap('trace', <Hs13Trace {...{ key: 'hs13-trace' }} api={api} />) : null}
        </div>
    );
}
