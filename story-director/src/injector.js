// story-director/src/injector.js
// 纯逻辑：把大纲渲染成导演指令（导演模式）或世界动态（世界模式）并截断。零依赖。
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

// 世界模式注入：世界动态——进行中的事件、即将触发的事件、背景事件。
// 是「环境」，不是「命令」：告诉模型世界在发生什么，主角行动完全自由。
function renderWorldInstruction(outline, { tokenLimit = 300 } = {}) {
    const events = Array.isArray(outline?.worldEvents) ? outline.worldEvents : [];
    const active = events.filter(e => e.status === 'active');
    const pending = events.filter(e => e.status === 'pending');
    const lines = [];
    for (const e of active) {
        const direct = e.impact === 'direct' ? '（靠近就会遭遇）' : '';
        lines.push(`⚡进行中：${e.title || e.id}${e.time ? `［${e.time}］` : ''}${direct}${e.trigger ? `｜触发：${e.trigger}` : ''}${e.actors?.length ? `（${e.actors.join('、')}）` : ''}`);
    }
    for (const e of pending.slice(0, 3)) {
        lines.push(`⏳待触发：${e.title || e.id}${e.trigger ? `｜${e.trigger}` : ''}`);
    }
    const ambient = events.filter(e => e.status === 'pending' && e.impact === 'ambient').slice(0, 2);
    for (const e of ambient) {
        lines.push(`🌫背景：${e.title || e.id}${e.time ? `［${e.time}］` : ''}`);
    }
    const nextStep = String(outline?.focus?.nextStep || '').trim();
    if (nextStep) lines.push(`📌世界动态：${nextStep}`);
    if (!lines.length) return '';
    return `【世界动态（环境，非主角指令——主角行动完全自由）】\n${lines.join('\n')}`;
}

export function renderInstruction(outline, { strength = 'strong', tokenLimit = 300, mode = 'director' } = {}) {
    if (mode === 'world') {
        return truncateByApproxTokens(renderWorldInstruction(outline, { tokenLimit }), tokenLimit);
    }
    const f = outline?.focus;
    const hasContent = f && (f.currentBeat || f.nextStep || (f.activeForeshadow && f.activeForeshadow.length) || f.avoidOffTopic);
    if (!hasContent) return '';
    const full = buildDirectorInstruction(outline, strength);
    return truncateByApproxTokens(full, tokenLimit);
}
