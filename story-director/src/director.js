// story-director/src/director.js
// 纯编排逻辑：生成/修订/体检/注入。所有酒馆能力经 deps 注入。
import { normalizeOutline, createEmptyOutline, mergeHistoryIntoOutline, replaceActBeats } from './outline-store.js';
import { buildGeneratePrompt, buildRevisePrompt, buildRevisePatchPrompt, buildBeatPrompt, buildReplanActPrompt, buildCheckPrompt, buildHistoryContext, buildDialogueAnalyzePrompt, buildDirectionPrompt, OUTLINE_SCHEMA, CHECK_SCHEMA, DIRECTION_SCHEMA } from './prompts.js';
import { makeStructuredGenerator } from './llm-client.js';
import { applyRevision, applyPatch } from './tracker.js';
import { applyCheckResult } from './checker.js';
import { renderInstruction } from './injector.js';
import { log } from './logger.js';

export function createDirector(deps) {
    let running = false;

    const gen = makeStructuredGenerator(deps.generateRaw, OUTLINE_SCHEMA);
    const genCheck = makeStructuredGenerator(deps.generateRaw, CHECK_SCHEMA);
    const genDirection = makeStructuredGenerator(deps.generateRaw, DIRECTION_SCHEMA);

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

    async function generate({ userRequest = '', timeline, mustRead } = {}) {
        if (running) {
            log('debug', 'llm', '生成被跳过：已有任务运行（并发守卫）');
            return null;
        }
        running = true;
        const t0 = Date.now();
        try {
            const settings = deps.getSettings();
            const card = deps.getCharacterCard();
            const currentOutline = deps.getOutline();
            const storedTimeline = currentOutline.timeline || {};
            const requestedTimeline = (timeline && typeof timeline === 'object') ? timeline : storedTimeline;
            // 必读设定是顶层独立字段：显式传入（UI 输入）优先，否则沿用大纲已有值
            const requestedMustRead = typeof mustRead === 'string' ? mustRead : (currentOutline.mustRead || '');

            // 生成大纲的记忆模式：auto = 摘要+向量；summary = 只读记忆表；vector = 只检索资料；none = 只看角色卡和用户要求
            const memoryMode = settings.generateMemoryMode || 'auto';
            const useSummary = memoryMode === 'auto' || memoryMode === 'summary';
            const useVector = memoryMode === 'auto' || memoryMode === 'vector';

            // 保留已发生剧情：旧大纲的 done 节点作为前情参考传入（prompt），
            // 生成后由 mergeHistoryIntoOutline 收进「前情·已完成」幕。
            // 进行中节点是事实边界：时间线只能规划它之后（prompt 硬约束 + 合并兜底）。
            // 时间线只是生成约束（故事跨度），不触发部分重规划——
            // 局部重做统一走「修改这一幕」（replanAct，幕级结构化边界）。
            const preserveHistory = String(settings.preserveHistory) !== 'false';
            const historyContext = preserveHistory ? buildHistoryContext(currentOutline) : '';
            const ongoingBeat = preserveHistory ? currentOutline.beats.find(b => b.status === 'active') : null;
            const ongoingBeatText = ongoingBeat
                ? `${ongoingBeat.title || ongoingBeat.id}（${ongoingBeat.summary || '进行中'}）`
                : '';
            // 用户显式指定时间线时以用户输入为准（模型输出只补漏）
            const hasRequestedTimeline = !!(requestedTimeline?.start || requestedTimeline?.end || requestedTimeline?.note);

            // 近期对话始终携带：记忆插件的记忆库落后最近约 20 轮，最近剧情只有
            // 聊天历史里有——无论首次生成、继续当前还是跳时间线重规划都要带，
            // 它是「当前剧情位置」的事实来源。轮数与预算由 recentTurns /
            // dialogueContextLimit 控制（adapter.getRecentDialogue）。
            const recentDialogue = deps.getRecentDialogue?.(settings.recentTurns ?? 5) || '';

            // 两阶段检索（advancedRetrieval，默认开）：
            // 第一步先让模型「想清楚怎么写」——输出方向草案与精准检索词（草案看过
            // 全部上下文但没看过资料）；第二步用这些检索词定向检索，而不是在还没
            // 想好写什么时就拿泛 query 去检索。草案失败时降级为保底查询（单轮行为）。
            const advancedRetrieval = String(settings.advancedRetrieval) !== 'false' && useVector;
            log('info', 'llm', `生成大纲${advancedRetrieval ? '（两阶段检索）' : ''}`, `记忆模式 ${memoryMode}；保留前情 ${preserveHistory ? '开' : '关'}；用户要求：${String(userRequest || '（未指定）').slice(0, 120)}`);
            let direction = '';
            let modelQueries = [];
            if (advancedRetrieval) {
                try {
                    const dirBundle = buildDirectionPrompt({
                        characterCard: card,
                        userRequest,
                        timeline: requestedTimeline,
                        mustRead: requestedMustRead,
                        pacing: settings.beatPacing || 'balanced',
                        historyContext,
                        ongoingBeatText,
                        recentDialogue,
                    });
                    const dirResult = await genDirection(dirBundle);
                    if (dirResult && typeof dirResult === 'object') {
                        direction = String(dirResult.direction || '').trim();
                        modelQueries = Array.isArray(dirResult.queries)
                            ? dirResult.queries.map(q => String(q || '').trim().slice(0, 2000)).filter(Boolean).slice(0, 3)
                            : [];
                        log('debug', 'retrieval', '方向草案成功', `模型定向查询 ${modelQueries.length} 条：${modelQueries.join('；') || '（无）'}`);
                    } else {
                        log('warn', 'retrieval', '方向草案输出无效，使用保底查询', '模型未返回 direction/queries');
                    }
                } catch (err) {
                    console.warn('[story-director] direction draft failed, falling back:', err);
                    log('warn', 'retrieval', '方向草案失败，降级保底查询', String(err?.message || err));
                }
            }

            // 向量检索：模型定向查询 + 保底查询（时间线/角色/焦点）**分两批调用**——
            // 各自打点（终端可见「模型定向」「保底」两次搜索），批次间按文本去重。
            const baseQueries = [
                [userRequest, requestedTimeline?.start, requestedTimeline?.end, requestedTimeline?.note, requestedMustRead].filter(Boolean).join(' '),
                // 角色查询词精简：全量名录会让 query 过长过泛，只取前 5 个主要角色
                card.cast ? `角色与关系：${String(card.cast).split('；').slice(0, 5).join('；')}` : '',
                currentOutline.focus?.nextStep || currentOutline.theme || '',
            ].filter(q => String(q || '').trim());
            let vectorContext = '';
            if (useVector) {
                const groups = [];
                if (modelQueries.length) groups.push(['模型定向', modelQueries]);
                if (baseQueries.length) groups.push(['保底', baseQueries]);
                const textLimit = Math.max(1000, Number(settings.vectorMemoryLimit) || 6000);
                const mergedTexts = [];
                for (const [label, queries] of groups) {
                    const retrieval = await deps.getVectorMemory?.(queries) || null;
                    if (retrieval && retrieval.text) {
                        mergedTexts.push(retrieval.text);
                    } else {
                        // 兼容旧 deps：只有 getVectorMemoryContext 的宿主
                        const t = await deps.getVectorMemoryContext?.(queries) || '';
                        if (t) mergedTexts.push(t);
                    }
                }
                vectorContext = mergedTexts.join('\n').slice(0, textLimit);
            }

            const bundle = buildGeneratePrompt({
                characterCard: card,
                userRequest,
                detail: settings.outlineDetail || 'medium',
                timeline: requestedTimeline,
                mustRead: requestedMustRead,
                pacing: settings.beatPacing || 'balanced',
                historyContext,
                ongoingBeatText,
                recentDialogue,
                direction,
                memoryContext: useSummary ? deps.getMemoryContext?.() : '',
                vectorContext,
            });
            const result = await gen(bundle);
            if (result) {
                let next = normalizeOutline(result);
                log('info', 'llm', '生成完成', `耗时 ${Date.now() - t0}ms；${next.beats.length} 节点 / ${next.acts.length} 幕 / ${next.arcs.length} 弧光`);
                // 用户显式指定过时间线时，以用户输入为准（模型输出只补漏）
                if (hasRequestedTimeline) {
                    next.timeline = {
                        start: requestedTimeline.start || next.timeline.start,
                        end: requestedTimeline.end || next.timeline.end,
                        note: requestedTimeline.note || next.timeline.note,
                    };
                }
                // 必读设定同样以用户输入为准（模型输出只补漏）
                if (requestedMustRead) {
                    next.mustRead = requestedMustRead;
                }
                if (preserveHistory) {
                    // 完整重新生成：旧 done/active 全部收进前情幕（历史不可重规划）
                    next = mergeHistoryIntoOutline(next, currentOutline);
                }
                recordHistory('generate');
                deps.setOutline(next);
                deps.renderOutline();
            } else {
                log('warn', 'llm', '生成失败，沿用旧大纲', `耗时 ${Date.now() - t0}ms；LLM 未返回有效 JSON`);
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    // 对话正文标签分析：扫描最近对话，让 AI 识别正文的包裹标签样式，
    // 返回规则建议（不自动生效，由用户检查确认后写入设置）。
    // 支持 HTML 标签规则（{ tag }，如 content/speech）与字符对规则（{ open, close }）两种形态。
    async function analyzeDialogueTags({ turns = 10 } = {}) {
        if (running) return null;
        running = true;
        try {
            const dialogue = deps.getRecentDialogue?.(turns) || '';
            const bundle = buildDialogueAnalyzePrompt({ dialogue });
            const result = await gen(bundle);
            if (!result || typeof result !== 'object') {
                log('warn', 'llm', '对话标签分析失败', 'LLM 未返回有效 JSON');
                return null;
            }
            const patterns = Array.isArray(result.patterns) ? result.patterns : [];
            const rules = [];
            for (const p of patterns) {
                if (!p || typeof p !== 'object') continue;
                const label = String(p.label || '正文').trim();
                const sample = String(p.sample || '').trim();
                // HTML 标签规则：兼容 tag / html_tag / tagName 字段名，容忍 <content> 写法
                const rawTag = String(p.tag ?? p.html_tag ?? p.tagName ?? '').replace(/[<>/]/g, '').trim();
                let tag = /^[A-Za-z][A-Za-z0-9_-]*$/.test(rawTag) ? rawTag : '';
                // 模型可能没给 tag 只给了示例（如 <content>正文</content>）：从 sample 兜底解析
                if (!tag && sample) {
                    const m = sample.match(/<([A-Za-z][A-Za-z0-9_-]*)\b[^>]*>/);
                    if (m) tag = m[1];
                }
                if (tag) {
                    rules.push({ tag, exclude: p.exclude === true, label, sample });
                    continue;
                }
                // 字符对规则（兼容旧模型输出）
                if (typeof p.open === 'string' && p.open && typeof p.close === 'string' && p.close) {
                    rules.push({ open: String(p.open).trim(), close: String(p.close).trim(), label, sample });
                }
            }
            return { rules: rules.slice(0, 5), note: String(result.note || '').trim() };
        } finally {
            running = false;
        }
    }

    // AI 生成单个节点：基于当前大纲 + 用户一句话提示，返回建议 beat（不写入大纲）。
    // 供节点编辑器「AI 生成」入口使用，生成后填入表单由用户确认再保存。
    async function suggestBeat({ userHint = '' } = {}) {
        if (running) return null;
        running = true;
        try {
            const bundle = buildBeatPrompt({ outline: deps.getOutline(), userHint });
            const result = await gen(bundle);
            if (!result || typeof result !== 'object') {
                log('warn', 'llm', 'AI 节点生成失败', 'LLM 未返回有效 JSON');
                return null;
            }
            log('debug', 'llm', 'AI 节点建议', `提示：${String(userHint || '（自动）').slice(0, 80)}`);
            return {
                title: String(result.title || '').trim(),
                summary: String(result.summary || '').trim(),
                type: ['setup', 'conflict', 'twist', 'climax', 'resolution'].includes(result.type) ? result.type : 'setup',
                cast: Array.isArray(result.cast) ? result.cast.map(x => String(x).trim()).filter(Boolean) : [],
                actId: String(result.actId || '').trim(),
            };
        } finally {
            running = false;
        }
    }

    // 幕级重规划：只重新设计指定的一幕（用户从总览页「修改这一幕」进入）。
    // 幕是结构化边界——prompt 给目标幕 + 前后幕衔接约束，合并层 replaceActBeats
    // 只替换该幕节点、生成新 id，其他幕代码级不动；旧节点删除后的悬空引用
    // （伏笔回收点 / focus）由 normalize 自愈。入撤销栈 + 留快照。
    async function replanAct(actId, { userHint = '' } = {}) {
        if (running) {
            log('debug', 'llm', '幕重规划被跳过：已有任务运行（并发守卫）');
            return null;
        }
        running = true;
        const t0 = Date.now();
        try {
            const settings = deps.getSettings();
            const card = deps.getCharacterCard();
            const outline = deps.getOutline();
            const actIndex = outline.acts.findIndex(a => a.id === actId);
            if (actIndex < 0) return null;
            const act = outline.acts[actIndex];
            const prevAct = outline.acts[actIndex - 1];
            const nextAct = outline.acts[actIndex + 1];
            // 衔接锚点：前一幕最后一个非 done 节点（否则最后一个节点）；后一幕第一个节点
            const prevBeats = prevAct ? outline.beats.filter(b => b.actId === prevAct.id) : [];
            const prevBeat = prevBeats.filter(b => b.status !== 'done').pop() || prevBeats[prevBeats.length - 1] || null;
            const nextBeat = nextAct ? outline.beats.find(b => b.actId === nextAct.id) || null : null;
            const actBeats = outline.beats.filter(b => b.actId === actId);
            // 当前剧情位置：进行中节点（含时间点）+ 下一步——新设计必须与之对齐
            const currentBeat = outline.beats.find(b => b.status === 'active') || null;
            // 近期对话：幕重规划也携带（active 节点久未推进时信息不滞后）
            const recentDialogue = deps.getRecentDialogue?.(settings.recentTurns ?? 5) || '';

            const bundle = buildReplanActPrompt({
                characterCard: card,
                act: { id: act.id, title: act.title, summary: act.summary, beats: actBeats },
                prevBeat,
                nextBeat,
                currentBeat,
                nextStep: outline.focus?.nextStep || '',
                recentDialogue,
                pacing: settings.beatPacing || 'balanced',
                userHint,
                mustRead: outline.mustRead || '',
                timeline: outline.timeline || {},
            });
            const result = await gen(bundle);
            if (!result || typeof result !== 'object') {
                log('warn', 'llm', '幕重规划失败', `「${act.title || act.id}」；耗时 ${Date.now() - t0}ms；LLM 未返回有效 JSON`);
                return null;
            }
            const next = replaceActBeats(outline, actId, Array.isArray(result.beats) ? result.beats : [], {
                title: String(result.title || '').trim(),
                summary: String(result.summary || '').trim(),
            });
            deps.pushUndo?.(`重规划幕：${act.title || act.id}`);
            recordHistory('replan-act');
            deps.setOutline(next);
            deps.renderOutline();
            log('info', 'llm', '幕重规划完成',
                `「${act.title || act.id}」→ ${(Array.isArray(result.beats) ? result.beats.length : 0)} 个新节点；耗时 ${Date.now() - t0}ms`);
            return { actId, count: Array.isArray(result.beats) ? result.beats.length : 0 };
        } finally {
            running = false;
        }
    }

    async function revise() {
        if (running) {
            log('debug', 'llm', '修订被跳过：已有任务运行（并发守卫）');
            return null;
        }
        running = true;
        const t0 = Date.now();
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
            const locked = settings.lockOutline === true;
            // 统一增量补丁修订：只推进状态/焦点/伏笔/弧光，不改写任何现有内容
            // （手动编辑永远安全）；全量重写只留给「生成大纲」入口。
            // 锁定 = 连追加节点都禁止（纯状态推进）。
            const bundle = buildRevisePatchPrompt({
                recentDialogue: dialogue,
                outline,
                driftTolerance: settings.driftTolerance || 'loose',
                memoryContext: deps.getMemoryContext?.(),
                vectorContext,
                allowNewBeats: !locked,
            });
            const result = await gen(bundle);
            if (result) {
                recordHistory('revise');
                deps.setOutline(applyPatch(outline, result, { allowNewBeats: !locked }));
                deps.renderOutline();
                log('info', 'llm', `修订完成${locked ? '（锁定·不追加节点）' : ''}`, `耗时 ${Date.now() - t0}ms`);
            } else {
                log('warn', 'llm', '修订失败，沿用旧大纲', `耗时 ${Date.now() - t0}ms；LLM 未返回有效结果`);
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    async function check() {
        if (running) {
            log('debug', 'llm', '体检被跳过：已有任务运行（并发守卫）');
            return null;
        }
        running = true;
        const t0 = Date.now();
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
            const bundle = buildCheckPrompt({
                recentDialogue: dialogue,
                outline,
                pacing: settings.beatPacing || 'balanced',
                memoryContext: deps.getMemoryContext?.(),
                vectorContext,
            });
            const report = await genCheck(bundle);
            if (!report) {
                log('warn', 'llm', '体检调用失败', `耗时 ${Date.now() - t0}ms；LLM 未返回有效报告`);
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
            log('info', 'llm', '体检完成', `耗时 ${Date.now() - t0}ms；verdict=${normalizedReport.verdict}，issues ${normalizedReport.issues.length} 条${normalizedReport.changed ? '，已应用修正' : '，未修改大纲'}`);
            return normalizedReport;
        } finally {
            running = false;
        }
    }

    return { generate, revise, check, suggestBeat, replanAct, analyzeDialogueTags, refreshInjection, isRunning: () => running };
}
