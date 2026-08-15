// story-director/src/director.js
// 纯编排逻辑：生成/修订/体检/注入。所有酒馆能力经 deps 注入。
import { normalizeOutline, createEmptyOutline } from './outline-store.js';
import { buildGeneratePrompt, buildRevisePrompt, buildCheckPrompt, OUTLINE_SCHEMA, CHECK_SCHEMA } from './prompts.js';
import { makeStructuredGenerator } from './llm-client.js';
import { applyRevision } from './tracker.js';
import { applyCheckResult } from './checker.js';
import { renderInstruction } from './injector.js';

export function createDirector(deps) {
    let running = false;

    const gen = makeStructuredGenerator(deps.generateRaw, OUTLINE_SCHEMA);
    const genCheck = makeStructuredGenerator(deps.generateRaw, CHECK_SCHEMA);

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

    async function generate({ userRequest = '' } = {}) {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const card = deps.getCharacterCard();
            const bundle = buildGeneratePrompt({ characterCard: card, userRequest, detail: settings.outlineDetail || 'medium' });
            const result = await gen(bundle);
            if (result) {
                deps.setOutline(normalizeOutline(result));
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
            const bundle = buildRevisePrompt({
                recentDialogue: dialogue,
                outline,
                driftTolerance: settings.driftTolerance || 'loose',
            });
            const result = await gen(bundle);
            if (result) {
                deps.setOutline(applyRevision(outline, result));
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
            const bundle = buildCheckPrompt({ recentDialogue: dialogue, outline });
            const report = await genCheck(bundle);
            if (!report) {
                refreshInjection();
                return null; // LLM 调用失败，信号与 generate/revise 一致
            }
            const { outline: updated, report: normalizedReport } = applyCheckResult(outline, report);
            if (normalizedReport.changed) {
                deps.setOutline(updated);
                deps.renderOutline();
            }
            refreshInjection();
            return normalizedReport;
        } finally {
            running = false;
        }
    }

    return { generate, revise, check, refreshInjection };
}
