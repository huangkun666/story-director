// story-director/src/dialogue-extract.js
// 纯逻辑：从对话中提取正文。
// 背景：记忆插件（yuzuki）的记忆库落后最近约 20 轮，最近剧情只有聊天历史里有；
// 而 RP 正文常包裹在 HTML 标签里（如 <content>…</content>，思考过程在 <think>…</think>），
// 提取正文可在相同预算下覆盖更多轮次。
// 规则两种形态（可混用，标签规则优先）：
//   { tag: 'content' }   → HTML 标签模式：全文提取 <content>…</content>（可带属性、跨行），
//                          <think> 等非正文标签内容自然排除；标签名由用户指定或 AI 分析识别，不硬编码
//   { open, close }      → 字符对模式（兼容旧规则）：按开始/结束符逐行提取，保留说话人前缀
// 无规则 / 全部无匹配 / 提取为空 → 返回原文（即默认提取全文）。

// 容忍用户输入 <content> 或 content，非法标签名（非 HTML 标识符）返回 null
function htmlTagPattern(tag) {
    const t = String(tag || '').replace(/[<>/]/g, '').trim();
    if (!t || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(t)) return null;
    return new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'gi');
}

export function extractDialogueBodies(dialogue, rules) {
    if (typeof dialogue !== 'string' || !dialogue) return dialogue || '';
    const list = (Array.isArray(rules) ? rules : []).filter(r => r && typeof r === 'object');
    const tagRules = list.map(r => htmlTagPattern(r.tag)).filter(Boolean);
    const pairRules = list
        .filter(r => !r.tag && typeof r.open === 'string' && r.open && typeof r.close === 'string' && r.close)
        .map(r => ({ open: r.open, close: r.close }));
    if (!tagRules.length && !pairRules.length) return dialogue;

    // HTML 标签模式（优先）：全文提取所有匹配标签内的内容（跨行、可带属性），
    // 未包裹在正文标签里的思考/动作文本自然被排除
    if (tagRules.length) {
        const parts = [];
        for (const re of tagRules) {
            let m;
            while ((m = re.exec(dialogue)) !== null) {
                const frag = m[1].trim();
                if (frag) parts.push(frag);
            }
        }
        if (!parts.length) return dialogue; // 全部无匹配：回退原文（全文）
        return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // 字符对模式（兼容旧规则）：逐行提取，匹配行保留说话人前缀，无匹配行保留原文
    const lines = dialogue.split('\n');
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

    if (!anyMatched) return dialogue; // 全部无匹配：回退原文
    const text = out.filter(Boolean).join('\n').trim();
    return text || dialogue; // 提取结果为空也回退
}
