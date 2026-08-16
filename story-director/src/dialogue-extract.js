// story-director/src/dialogue-extract.js
// 纯逻辑：按用户确认的标签规则从对话中提取正文。
// 背景：记忆插件（yuzuki）的记忆库落后最近约 20 轮，最近剧情只有聊天历史里有；
// 而 RP 正文通常包裹在标签里（如 【】、* *），直接提取正文可在相同预算下
// 覆盖更多轮次（20 轮正文 ≈ 原文 5-8 轮的 token）。
// 规则：{ open, close }。无规则 / 全部无匹配 / 提取为空 → 原样返回（回退）。

export function extractDialogueBodies(dialogue, rules) {
    if (typeof dialogue !== 'string' || !dialogue) return dialogue || '';
    const list = (Array.isArray(rules) ? rules : [])
        .filter(r => r && typeof r.open === 'string' && r.open && typeof r.close === 'string' && r.close)
        .map(r => ({ open: r.open, close: r.close }));
    if (!list.length) return dialogue;

    const lines = dialogue.split('\n');
    let anyMatched = false;
    const out = lines.map((line) => {
        const sep = line.indexOf(':');
        const speaker = sep >= 0 ? line.slice(0, sep + 1) : '';
        const body = sep >= 0 ? line.slice(sep + 1) : line;
        const parts = [];
        for (const rule of list) {
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
