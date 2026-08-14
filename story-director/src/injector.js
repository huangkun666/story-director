// story-director/src/injector.js
// 纯逻辑：把大纲 focus 渲染成导演指令并截断。零依赖。
import { buildDirectorInstruction } from './prompts.js';

export function truncateByApproxTokens(text, limit) {
    if (typeof text !== 'string') return '';
    if (limit <= 0) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    // 中文按字符近似，英文按空格分词近似
    const hasCJK = /[\u4e00-\u9fff]/.test(trimmed);
    if (hasCJK) {
        if (trimmed.length <= limit) return trimmed;
        return trimmed.slice(0, limit) + '…';
    }
    const words = trimmed.split(/\s+/);
    if (words.length <= limit) return trimmed;
    return words.slice(0, limit).join(' ') + ' …';
}

export function renderInstruction(outline, { strength = 'strong', tokenLimit = 300 } = {}) {
    const f = outline?.focus;
    const hasContent = f && (f.currentBeat || f.nextStep || (f.activeForeshadow && f.activeForeshadow.length) || f.avoidOffTopic);
    if (!hasContent) return '';
    const full = buildDirectorInstruction(outline, strength);
    return truncateByApproxTokens(full, tokenLimit);
}
