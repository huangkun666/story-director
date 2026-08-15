// story-director/src/director.js
// 纯编排逻辑：生成/修订/体检/注入。所有酒馆能力经 deps 注入。
import { normalizeOutline, createEmptyOutline } from './outline-store.js';
import { buildGeneratePrompt, buildRevisePrompt, buildRevisePatchPrompt, buildCheckPrompt, OUTLINE_SCHEMA, CHECK_SCHEMA } from './prompts.js';
import { makeStructuredGenerator } from './llm-client.js';
import { applyRevision, applyPatch } from './tracker.js';
import { applyCheckResult } from './checker.js';
import { renderInstruction } from './injector.js';

export function createDirector(deps) {
    let running = false;

    const gen = makeStructuredGenerator(deps.generateRaw, OUTLINE_SCHEMA);
    const genCheck = makeStructuredGenerator(deps.generateRaw, CHECK_SCHEMA);

    function recordHistory(reason) {
        try {
            deps.recordHistory?.(deps.getOutline(), reason);
        } catch (err) {
            console.warn('[story-director] failed to record history snapshot:', err);
        }
    }

    function refreshInjection() {
        const settings = deps.getSettings();
        if (!settings.enabled) {
            deps.setInjectedInstruction('');
            return;
        }
        const outline = deps.getOutline();
        const text = renderInstruction(outline, {
            strength: settings.controlStrength,
            tokenLimit: settings.injectTokenLimit,
        });
        deps.setInjectedInstruction(text);
    }

    async function generate({ userRequest = '', timeline } = {}) {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const card = deps.getCharacterCard();
            const storedTimeline = deps.getOutline().timeline || {};
            const requestedTimeline = (timeline && typeof timeline === 'object') ? timeline : storedTimeline;

            // 生成大纲的记忆模式：auto = 摘要+向量；summary = 只读记忆表；vector = 只检索资料；none = 只看角色卡和用户要求
            const memoryMode = settings.generateMemoryMode || 'auto';
            const useSummary = memoryMode === 'auto' || memoryMode === 'summary';
            const useVector = memoryMode === 'auto' || memoryMode === 'vector';

            const vectorQueries = [
                [userRequest, requestedTimeline?.start, requestedTimeline?.end, requestedTimeline?.note, requestedTimeline?.mustRead].filter(Boolean).join(' '),
                card.cast ? `角色与关系：${card.cast}` : '',
                deps.getOutline().focus?.nextStep || deps.getOutline().theme || '',
            ].filter(q => String(q || '').trim());
            let vectorContext = '';
            let vectorHits = [];
            if (useVector) {
                const retrieval = await deps.getVectorMemory?.(vectorQueries) || null;
                if (retrieval) {
                    vectorContext = retrieval.text || '';
                    vectorHits = Array.isArray(retrieval.hits) ? retrieval.hits : [];
                } else {
                    // 兼容旧 deps：只有 getVectorMemoryContext 的宿主
                    vectorContext = await deps.getVectorMemoryContext?.(vectorQueries) || '';
                }
            }
            deps.setRetrievalHits?.(vectorHits);

            const bundle = buildGeneratePrompt({
                characterCard: card,
                userRequest,
                detail: settings.outlineDetail || 'medium',
                timeline: requestedTimeline,
                memoryContext: useSummary ? deps.getMemoryContext?.() : '',
                vectorContext,
            });
            const result = await gen(bundle);
            if (result) {
                const next = normalizeOutline(result);
                // 用户显式指定过时间线时，以用户输入为准（模型输出只补漏）
                const hasRequestedTimeline = !!(requestedTimeline?.start || requestedTimeline?.end || requestedTimeline?.note || requestedTimeline?.mustRead);
                if (hasRequestedTimeline) {
                    next.timeline = {
                        start: requestedTimeline.start || next.timeline.start,
                        end: requestedTimeline.end || next.timeline.end,
                        note: requestedTimeline.note || next.timeline.note,
                        mustRead: requestedTimeline.mustRead || next.timeline.mustRead,
                    };
                }
                recordHistory('generate');
                deps.setOutline(next);
                deps.renderOutline();
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    async function revise() {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const dialogue = deps.getRecentDialogue(settings.recentTurns ?? 5);
            const outline = deps.getOutline();
            const activeForeshadow = (outline.foreshadowing || [])
                .filter(f => f.status !== 'paid')
                .map(f => f.hint || f.id)
                .join(' ');
            const vectorQueries = [
                [dialogue.slice(0, 600), outline.focus?.nextStep, outline.focus?.currentBeat].filter(Boolean).join(' '),
                [outline.timeline?.start, outline.timeline?.end, outline.timeline?.note].filter(Boolean).join(' '),
                activeForeshadow,
            ].filter(q => String(q || '').trim());
            const retrieval = await deps.getVectorMemory?.(vectorQueries) || null;
            const vectorContext = retrieval ? (retrieval.text || '') : (await deps.getVectorMemoryContext?.(vectorQueries) || '');
            deps.setRetrievalHits?.(retrieval ? (Array.isArray(retrieval.hits) ? retrieval.hits : []) : []);
            const locked = settings.lockOutline === true;
            const bundle = locked
                ? buildRevisePatchPrompt({
                    recentDialogue: dialogue,
                    outline,
                    driftTolerance: settings.driftTolerance || 'loose',
                    memoryContext: deps.getMemoryContext?.(),
                    vectorContext,
                })
                : buildRevisePrompt({
                    recentDialogue: dialogue,
                    outline,
                    driftTolerance: settings.driftTolerance || 'loose',
                    locked: false,
                    memoryContext: deps.getMemoryContext?.(),
                    vectorContext,
                });
            const result = await gen(bundle);
            if (result) {
                recordHistory('revise');
                // 锁定模式：模型只输出变更补丁，字段级合并，省掉全量大纲往返；
                // 非锁定模式：全量输出后合并（含已完成节点细节恢复）。
                deps.setOutline(locked ? applyPatch(outline, result) : applyRevision(outline, result));
                deps.renderOutline();
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    async function check() {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const dialogue = deps.getRecentDialogue(settings.recentTurns ?? 5);
            const outline = deps.getOutline();
            const activeForeshadow = (outline.foreshadowing || [])
                .filter(f => f.status !== 'paid')
                .map(f => f.hint || f.id)
                .join(' ');
            const vectorQueries = [
                [dialogue.slice(0, 600), outline.focus?.nextStep, outline.focus?.currentBeat].filter(Boolean).join(' '),
                [outline.timeline?.start, outline.timeline?.end, outline.timeline?.note].filter(Boolean).join(' '),
                activeForeshadow,
            ].filter(q => String(q || '').trim());
            const retrieval = await deps.getVectorMemory?.(vectorQueries) || null;
            const vectorContext = retrieval ? (retrieval.text || '') : (await deps.getVectorMemoryContext?.(vectorQueries) || '');
            deps.setRetrievalHits?.(retrieval ? (Array.isArray(retrieval.hits) ? retrieval.hits : []) : []);
            const bundle = buildCheckPrompt({
                recentDialogue: dialogue,
                outline,
                memoryContext: deps.getMemoryContext?.(),
                vectorContext,
            });
            const report = await genCheck(bundle);
            if (!report) {
                refreshInjection();
                return null; // LLM 调用失败，信号与 generate/revise 一致
            }
            const { outline: updated, report: normalizedReport } = applyCheckResult(outline, report, { lockOutline: settings.lockOutline === true });
            // 体检历史留痕：{at, verdict}，新到旧最多 10 条，供 UI 展示同步性趋势
            const history = Array.isArray(updated.meta?.checkHistory) ? updated.meta.checkHistory : [];
            history.unshift({ at: new Date().toISOString(), verdict: normalizedReport.verdict });
            updated.meta.checkHistory = history.slice(0, 10);
            if (normalizedReport.changed) {
                recordHistory('check');
            }
            deps.setOutline(updated);
            deps.renderOutline();
            refreshInjection();
            return normalizedReport;
        } finally {
            running = false;
        }
    }

    return { generate, revise, check, refreshInjection, isRunning: () => running };
}
