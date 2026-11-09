/**
 * client/huasheng13-md.ts — 方法论视图的零依赖 Markdown 渲染链（cycle-18 复杂度拆分）
 *
 * 拆分动因：huasheng13-view.ts 单文件复杂度 218 > 预算 180（.cycles/config.yml complexity_budget）。
 * 拆法＝**只读纯函数外提**（本项目既定模式，见 CLAUDE.md cycle-13 教训①）：
 * 本模块只做「Markdown 文本 → React 节点」的纯变换，不持有可变状态、不发请求、不读盘。
 *
 * 覆盖：标题 / 段落 / 无序·有序列表 / 表格 / 代码围栏 / 引用 / 分隔线；检索命中高亮。
 * 安全：一切文本经 h() 生成元素，**绝不拼 HTML 字符串**（服务端从不注入 HTML，避免 XSS 面）。
 * 零 npm 依赖（不引 markdown 库）。
 *
 * ⚠️ 事故警示（cycle-18 R26）：本文件首次拆分用「朴素花括号计数」定位函数边界，
 * 被正则字面量里的 `{}`（如 /{1,6}/、/[.*+?^${}()|[\]\\]/）骗过 → 函数被截断、
 * 源文件语法损坏。教训：**拆分脚本必须以「顶层声明行号」为边界，禁止用括号平衡推断**；
 * 且重构前先确认可恢复路径（本次靠 dist/ 上一版产物无损恢复）。
 */
import { h } from './ui-kit.js'

/** 命中高亮底色（检索命中与模块强调共用，克制使用） */
const HS13_HIT_BG = 'rgba(245,158,11,.32)';
/* ═══════════════════ 纯函数工具 ═══════════════════ */
/** 数值兜底：非数/NaN/Infinity 一律归 0（接口字段全部可选，不能把 NaN 带进渲染） */
export function hs13Num(v) {
    const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v));
    return isFinite(n) ? n : 0;
}
/** 表格行拆分：去掉首尾竖线后按 | 切（单元格 trim） */
function hs13SplitRow(line) {
    let s = String(line == null ? '' : line).trim();
    if (s.charAt(0) === '|')
        s = s.slice(1);
    if (s.charAt(s.length - 1) === '|')
        s = s.slice(0, -1);
    return s.split('|').map((x) => x.trim());
}
/** 表格分隔行判定（| --- | :---: | 等；必须含 '-' 且只由 | - : 空白组成） */
function hs13IsTableSep(line) {
    const s = String(line == null ? '' : line).trim();
    if (!s || s.indexOf('-') < 0)
        return false;
    return /^\|?[\s:|-]+\|?$/.test(s);
}
/** 行是否属于「块起始」（段落累积在遇到块起始时截断，避免列表被并进段落） */
function hs13BlockStart(line) {
    const t = String(line == null ? '' : line).trim();
    if (!t)
        return true;
    if (/^```/.test(t))
        return true;
    if (/^#{1,6}\s+/.test(t))
        return true;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t))
        return true;
    if (/^\|/.test(t))
        return true;
    if (/^>\s?/.test(t))
        return true;
    if (/^([-*+]|\d+[.)])\s+/.test(t))
        return true;
    return false;
}
/**
 * markdown → 块级 token 数组（零依赖手写；复杂度 O(n)，n = 行数）。
 * 支持的块：标题(#1-6) / 段落 / 无序列表 / 有序列表 / 表格 / 代码围栏 / 引用 / 分隔线。
 * CRLF 先归一（语料历史是 CRLF，不归一会让表头判定全部失败）。
 */
function hs13MarkdownBlocks(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const raw = lines[i];
        const t = String(raw == null ? '' : raw).trim();
        if (!t) {
            i++;
            continue;
        }
        // ── 代码围栏（闭合缺失也容忍：吃到文末） ──
        const fence = /^```\s*([\w#+-]*)\s*$/.exec(t);
        if (fence) {
            const lang = fence[1] || '';
            const buf = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(String(lines[i]).trim())) {
                buf.push(lines[i]);
                i++;
            }
            i++;
            blocks.push({ t: 'code', lang, text: buf.join('\n') });
            continue;
        }
        // ── 标题 ──
        const hm = /^(#{1,6})\s+(.*)$/.exec(t);
        if (hm) {
            blocks.push({ t: 'h', level: hm[1].length, text: hm[2] });
            i++;
            continue;
        }
        // ── 分隔线 ──
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
            blocks.push({ t: 'hr' });
            i++;
            continue;
        }
        // ── 表格（当前行以 | 开头 且 下一行是分隔行）──
        if (/^\|/.test(t) && i + 1 < lines.length && hs13IsTableSep(lines[i + 1])) {
            const head = hs13SplitRow(t);
            const rows = [];
            i += 2;
            while (i < lines.length && /^\|/.test(String(lines[i]).trim())) {
                rows.push(hs13SplitRow(lines[i]));
                i++;
            }
            blocks.push({ t: 'table', head, rows });
            continue;
        }
        // ── 引用（连续的 > 行合并为一块）──
        if (/^>\s?/.test(t)) {
            const buf = [];
            while (i < lines.length && /^>\s?/.test(String(lines[i]).trim())) {
                buf.push(String(lines[i]).trim().replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({ t: 'quote', text: buf.join('\n') });
            continue;
        }
        // ── 无序列表（后续非块行并进上一项，兼容软换行）──
        if (/^([-*+])\s+/.test(t)) {
            const items = [];
            while (i < lines.length) {
                const s = String(lines[i]).trim();
                if (/^([-*+])\s+/.test(s)) {
                    items.push(s.replace(/^([-*+])\s+/, ''));
                    i++;
                }
                else if (s && !hs13BlockStart(s) && items.length) {
                    items[items.length - 1] += '\n' + s;
                    i++;
                }
                else
                    break;
            }
            blocks.push({ t: 'ul', items });
            continue;
        }
        // ── 有序列表 ──
        const ol = /^(\d+)[.)]\s+/.exec(t);
        if (ol) {
            const items = [];
            while (i < lines.length) {
                const s = String(lines[i]).trim();
                const m2 = /^(\d+)[.)]\s+/.exec(s);
                if (m2) {
                    items.push(s.replace(/^(\d+)[.)]\s+/, ''));
                    i++;
                }
                else if (s && !hs13BlockStart(s) && items.length) {
                    items[items.length - 1] += '\n' + s;
                    i++;
                }
                else
                    break;
            }
            blocks.push({ t: 'ol', items });
            continue;
        }
        // ── 段落：连续非块起始行合并（保留原换行，CJK 语料不宜强行补空格）──
        const buf = [];
        while (i < lines.length) {
            const s = String(lines[i]);
            if (!String(s).trim())
                break;
            if (buf.length > 0 && hs13BlockStart(s))
                break;
            buf.push(s);
            i++;
        }
        if (buf.length) {
            blocks.push({ t: 'p', text: buf.join('\n') });
        }
        else {
            // 防御分支：「看着像块起始但上面各分支都没接住」的行（如孤立的 |无表头|）
            // 也要保住原文 —— 按段落吐出并前进一行，绝不静默丢语料、绝不原地死循环
            blocks.push({ t: 'p', text: String(lines[i] == null ? '' : lines[i]) });
            i++;
        }
    }
    return blocks;
}
/** 正则字面量转义（检索词来自用户输入，必须转义后才能拼 RegExp） */
function hs13EscapeRe(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * 命中高亮切分：按 terms 里任一子串切段，返回 [{hit, v}]。
 * terms 是服务端 BM25 的 token（中文 bigram + 单字），可能重叠 → 交替匹配即可，
 * 视觉上仍正确（不会重复叠加样式）。空 terms 原样返回单段，调用方无需分支。
 */
function hs13HighlightParts(text, terms) {
    const src = String(text == null ? '' : text);
    const list = (Array.isArray(terms) ? terms : [])
        .filter((x) => typeof x === 'string' && x.length > 0)
        .slice(0, 24);
    if (!src || !list.length)
        return [{ hit: false, v: src }];
    const re = new RegExp('(' + list.map(hs13EscapeRe).join('|') + ')', 'g');
    const out = [];
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (!m[0]) {
            re.lastIndex++;
            continue;
        } // 零宽匹配防御，绝不死循环
        if (m.index > last)
            out.push({ hit: false, v: src.slice(last, m.index) });
        out.push({ hit: true, v: m[0] });
        last = m.index + m[0].length;
    }
    if (last < src.length)
        out.push({ hit: false, v: src.slice(last) });
    return out;
}
/**
 * 行内 markdown → React 节点数组：**加粗** / `行内代码` / ![alt](src) 图片。
 * 必须用 h() 生成元素（不能拼 HTML 字符串，服务端不注入 HTML 就是为了避免 XSS 面）。
 */
function hs13Inline(text, keyBase) {
    const src = String(text == null ? '' : text);
    const out = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    let n = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last)
            out.push(h('span', { key: keyBase + '-t' + (n++) }, src.slice(last, m.index)));
        if (m[2] !== undefined) {
            out.push(h('img', {
                key: keyBase + '-i' + (n++), src: m[2], alt: m[1] || '配图', loading: 'lazy',
                style: { maxWidth: '100%', maxHeight: 300, display: 'block', margin: '8px 0', borderRadius: 8, border: '1px solid rgba(148,163,184,.25)' },
                onError: (e) => { if (e && e.target)
                    e.target.style.display = 'none'; },
            }));
        }
        else if (m[3] !== undefined) {
            out.push(h('strong', { key: keyBase + '-b' + (n++), style: { fontWeight: 800 } }, m[3]));
        }
        else if (m[4] !== undefined) {
            out.push(h('code', {
                key: keyBase + '-c' + (n++),
                style: { background: 'rgba(99,102,241,.10)', color: '#4f46e5', padding: '1px 5px', borderRadius: 5, fontSize: 12, fontFamily: 'ui-monospace,Consolas,Menlo,monospace' },
            }, m[4]));
        }
        last = m.index + m[0].length;
    }
    if (last < src.length)
        out.push(h('span', { key: keyBase + '-t' + (n++) }, src.slice(last)));
    return out;
}
/** 单块渲染（纯函数，无 hook；供 hs13RenderBlocks 调用） */
function hs13RenderBlock(b, key) {
    if (!b || typeof b !== 'object')
        return null;
    if (b.t === 'h') {
        const lv = hs13Num(b.level) || 1;
        const style: any = {
            fontWeight: 800,
            lineHeight: 1.5,
            margin: lv <= 1 ? '4px 0 12px' : lv === 2 ? '18px 0 9px' : '14px 0 7px',
            fontSize: lv <= 1 ? 19 : lv === 2 ? 16.5 : lv === 3 ? 14.5 : 13.5,
            color: 'var(--text-primary,#0f172a)',
        };
        if (lv === 2) {
            style.paddingLeft = 9;
            style.borderLeft = '3px solid rgba(99,102,241,.55)';
        }
        return h('div', { key, style }, ...hs13Inline(b.text, key));
    }
    if (b.t === 'p') {
        return h('div', { key, style: { fontSize: 13, lineHeight: 1.85, margin: '8px 0', whiteSpace: 'pre-wrap', color: 'var(--text-primary,#0f172a)' } }, ...hs13Inline(b.text, key));
    }
    if (b.t === 'ul' || b.t === 'ol') {
        const items = Array.isArray(b.items) ? b.items : [];
        return h(b.t === 'ol' ? 'ol' : 'ul', { key, style: { margin: '8px 0', paddingLeft: 22, fontSize: 13, lineHeight: 1.85 } }, items.map((it, i) => h('li', { key: key + '-li' + i, style: { marginBottom: 3, whiteSpace: 'pre-wrap' } }, ...hs13Inline(it, key + '-li' + i))));
    }
    if (b.t === 'quote') {
        return h('div', { key, style: { margin: '10px 0', padding: '8px 12px', borderLeft: '3px solid rgba(148,163,184,.6)', background: 'rgba(148,163,184,.09)', borderRadius: '0 8px 8px 0', fontSize: 12.5, lineHeight: 1.8, color: '#475569', whiteSpace: 'pre-wrap' } }, ...hs13Inline(b.text, key));
    }
    if (b.t === 'code') {
        return h('div', { key, style: { margin: '10px 0', background: 'rgba(15,23,42,.05)', borderRadius: 9, padding: '9px 12px', overflowX: 'auto' } }, h('pre', { style: { margin: 0, fontFamily: 'ui-monospace,Consolas,Menlo,monospace', fontSize: 11.5, lineHeight: 1.7, color: '#334155', whiteSpace: 'pre' } }, b.text || ''));
    }
    if (b.t === 'table') {
        const head = Array.isArray(b.head) ? b.head : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const cellStyle = { border: '1px solid rgba(148,163,184,.3)', padding: '5px 9px', fontSize: 12, lineHeight: 1.6, textAlign: 'left', verticalAlign: 'top' };
        return h('div', { key, style: { margin: '10px 0', overflowX: 'auto' } }, h('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 260 } }, head.length ? h('thead', null, h('tr', null, head.map((c, i) => h('th', { key: key + '-th' + i, style: { ...cellStyle, background: 'rgba(99,102,241,.08)', fontWeight: 800, color: '#4338ca', whiteSpace: 'nowrap' } }, ...hs13Inline(c, key + '-th' + i))))) : null, h('tbody', null, rows.map((r, ri) => h('tr', { key: key + '-tr' + ri }, r.map((c, ci) => h('td', { key: key + '-td' + ri + '-' + ci, style: cellStyle }, ...hs13Inline(c, key + '-td' + ri + '-' + ci))))))));
    }
    if (b.t === 'hr') {
        return h('div', { key, style: { height: 1, background: 'rgba(148,163,184,.3)', margin: '14px 0' } });
    }
    return null;
}
/** 块数组 → React 节点数组 */
function hs13RenderBlocks(src, keyBase) {
    const blocks = hs13MarkdownBlocks(src);
    return blocks.map((b, i) => hs13RenderBlock(b, keyBase + '-k' + i)).filter(Boolean);
}
/**
 * catalog → 分组（左栏数据源）。
 * 六模块在前（保持 META 声明顺序 = 学习优先级），随后追加两个跨模块分组：
 * 策略层（strategy）与真题示例（examples）——它们不属于任何单一模块，但必须可见。
 */
/** markdown 渲染组件（零依赖；供文档正文与题干复用） */
export function Hs13Markdown(props) {
    const src = props && props.src != null ? props.src : '';
    if (!String(src).trim())
        return h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '（正文为空）');
    return h('div', { style: { fontSize: props && props.fontSize ? props.fontSize : 13 } }, ...hs13RenderBlocks(src, 'hs13md'));
}
/** 命中高亮片段（检索结果 / 摘要共用） */
export function Hs13Snippet(props) {
    const text = String((props && props.text) || '');
    if (!text)
        return null;
    const parts = hs13HighlightParts(text, props && props.terms);
    return h('div', {
        style: {
            fontSize: 11.5, lineHeight: 1.75, color: '#475569', whiteSpace: 'pre-wrap',
            background: 'rgba(148,163,184,.07)', borderRadius: 8, padding: '6px 9px', marginTop: 5,
        },
    }, parts.map((p, i) => (p.hit
        ? h('mark', { key: 'hs13h' + i, style: { background: HS13_HIT_BG, color: 'inherit', borderRadius: 3, padding: '0 1px' } }, p.v)
        : h('span', { key: 'hs13h' + i }, p.v))));
}
