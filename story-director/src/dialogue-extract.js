// story-director/src/dialogue-extract.js
// 纯逻辑：从对话中提取正文。
// 背景：记忆插件（yuzuki）的记忆库落后最近约 20 轮，最近剧情只有聊天历史里有；
// 而 RP 正文常包裹在 HTML 标签里（如 <content>…</content>，思考过程在 <think>…</think>），
// 提取正文可在相同预算下覆盖更多轮次。
// 规则两种形态（可混用，先黑名单清理、再白名单提取）：
//   白名单 { tag: 'content' }            → 只提取 <content>…</content>（可带属性、跨行）
//   黑名单 { tag: 'think', exclude: true } → 删除 <think>…</think> 块，保留其余全文
//                                          （正文没标签包裹时的兜底：去掉无用信息即可）
//   字符对 { open, close }               → 兼容旧规则：按开始/结束符逐行提取，保留说话人前缀
// 无规则 / 白名单无匹配 → 返回黑名单清理后的全文（默认提取全文）；提取为空也回退。

// 容忍用户输入 <content> 或 content，非法标签名（非 HTML 标识符）返回 null
function htmlTagPattern(tag) {
    const t = String(tag || '').replace(/[<>/]/g, '').trim();
    if (!t || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(t)) return null;
    return new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'gi');
}

// 黑名单：删除标签块本身及其内容（返回删除后的文本与是否命中）
function stripExcludedTags(text, tagPatterns) {
    let cleaned = text;
    let hit = false;
    for (const re of tagPatterns) {
        const next = cleaned.replace(re, (m) => { hit = true; return ''; });
        cleaned = next;
    }
    if (hit) cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return { cleaned, hit };
}

export function extractDialogueBodies(dialogue, rules) {
    if (typeof dialogue !== 'string' || !dialogue) return dialogue || '';
    const list = (Array.isArray(rules) ? rules : []).filter(r => r && typeof r === 'object');
    // 白名单 = 非 exclude 的 tag 规则；黑名单 = exclude: true 的 tag 规则
    const whitelist = list
        .filter(r => r.exclude !== true)
        .map(r => htmlTagPattern(r.tag))
        .filter(Boolean);
    const blacklist = list
        .filter(r => r.exclude === true)
        .map(r => htmlTagPattern(r.tag))
        .filter(Boolean);
    const pairRules = list
        .filter(r => !r.tag && typeof r.open === 'string' && r.open && typeof r.close === 'string' && r.close)
        .map(r => ({ open: r.open, close: r.close }));
    if (!whitelist.length && !blacklist.length && !pairRules.length) return dialogue;

    // 第一步：黑名单清理（删除 <think> 等无用标签块，正文无标签包裹时其余全文保留）
    const { cleaned, hit: blackHit } = stripExcludedTags(dialogue, blacklist);
    const source = blackHit ? cleaned : dialogue;

    // 第二步：白名单提取（在清理后的文本上取正文标签内容）
    if (whitelist.length) {
        const parts = [];
        for (const re of whitelist) {
            let m;
            while ((m = re.exec(source)) !== null) {
                const frag = m[1].trim();
                if (frag) parts.push(frag);
            }
        }
        if (parts.length) {
            return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        }
        return source; // 白名单无匹配：回退黑名单清理后的全文
    }

    // 只有黑名单：直接返回清理后的全文
    if (blacklist.length) return source;

    // 字符对模式（兼容旧规则）：逐行提取，匹配行保留说话人前缀，无匹配行保留原文
    const lines = source.split('\n');
    let anyMatched = false;
    const out = lines.map((line) => {
        const sep = line.indexOf(':');
        const speaker = sep >= 0 ? line.slice(0, sep + 1) : '';
        const body = sep >= 0 ? line.slice(sep + 1) : line;
        const parts = [];
        for (const rule of pairRules) {
            let idx = 0;
            while (idx < body.length) {
                const s = body.indexOf(rule.open, idx);
                if (s < 0) break;
                const e = body.indexOf(rule.close, s + rule.open.length);
                if (e < 0) break;
                const frag = body.slice(s + rule.open.length, e).trim();
                if (frag) parts.push(frag);
                idx = e + rule.close.length;
            }
        }
        if (!parts.length) return line; // 该行无匹配标签：保留原文
        anyMatched = true;
        return speaker ? `${speaker} ${parts.join('；')}` : parts.join('；');
    });

    if (!anyMatched) return source; // 全部无匹配：回退清理后的全文
    const text = out.filter(Boolean).join('\n').trim();
    return text || source; // 提取结果为空也回退
}
