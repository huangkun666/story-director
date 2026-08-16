// story-director/src/prompts.js
// 纯逻辑：提示词模板与 JSON Schema。零依赖。
import { serializeOutline, normalizeOutline } from './outline-store.js';

export const OUTLINE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['theme', 'tone', 'world', 'timeline', 'arcs', 'foreshadowing', 'acts', 'beats', 'focus'],
    properties: {
        theme: { type: 'string', description: '故事主题' },
        tone: { type: 'string', description: '情绪基调' },
        world: { type: 'string', description: '世界观与冲突根源' },
        mustRead: { type: 'string', description: '必读设定（最高优先级的世界观硬约束，没有则留空）' },
        timeline: {
            type: 'object',
            required: ['start', 'end', 'note'],
            properties: {
                start: { type: 'string', description: '大纲覆盖的故事内开始时间' },
                end: { type: 'string', description: '大纲覆盖的故事内结束时间' },
                note: { type: 'string', description: '时间线补充约束' },
            },
        },
        arcs: {
            type: 'array',
            items: {
                type: 'object',
                required: ['character', 'arc'],
                properties: {
                    character: { type: 'string', description: '角色名' },
                    arc: { type: 'string', description: '角色弧光：从何处到何处、欲望与成长' },
                    status: { type: 'string', enum: ['pending', 'active', 'done'] },
                },
            },
        },
        foreshadowing: {
            type: 'array',
            description: '伏笔列表，每条为对象（兼容字符串形式），beatId 表示在哪一幕/节点回收',
            items: {
                type: 'object',
                required: ['id', 'hint', 'status'],
                properties: {
                    id: { type: 'string' },
                    hint: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'active', 'paid'] },
                    payoff: { type: 'string' },
                    beatId: { type: 'string' },
                },
            },
        },
        acts: {
            type: 'array',
            description: '大纲分幕（起承转合），每幕包含若干 beat id',
            items: {
                type: 'object',
                required: ['id', 'title', 'summary', 'beats'],
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    beats: { type: 'array', items: { type: 'string' } },
                },
            },
        },
        beats: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'title', 'summary', 'status', 'type'],
                properties: {
                    id: { type: 'string' },
                    actId: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    type: { type: 'string', enum: ['setup', 'conflict', 'twist', 'climax', 'resolution'] },
                    status: { type: 'string', enum: ['pending', 'active', 'done'] },
                    cast: { type: 'array', items: { type: 'string' }, description: '本节点参与的角色' },
                },
            },
        },
        focus: {
            type: 'object',
            required: ['currentBeat', 'nextStep', 'activeForeshadow', 'avoidOffTopic'],
            properties: {
                currentBeat: { type: 'string' },
                nextStep: { type: 'string' },
                activeForeshadow: { type: 'array', items: { type: 'string' } },
                avoidOffTopic: { type: 'string' },
            },
        },
    },
};

export const CHECK_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['verdict', 'issues', 'changed', 'changes', 'reason'],
    properties: {
        verdict: { type: 'string', enum: ['sync', 'minor-drift', 'major-drift'] },
        issues: {
            type: 'array',
            items: {
                type: 'object',
                required: ['where', 'what', 'severity'],
                properties: {
                    where: { type: 'string' },
                    what: { type: 'string' },
                    severity: { type: 'string', enum: ['low', 'mid', 'high'] },
                },
            },
        },
        changed: { type: 'boolean' },
        changes: { type: 'string' },
        reason: { type: 'string' },
        updatedOutline: OUTLINE_SCHEMA,
    },
};

// 节点节奏档位：间隔相对大纲总跨度（跨度/节点数为基准），不写绝对时间
const PACING_META = {
    balanced: {
        label: '均衡',
        desc: '相邻节点间隔接近基准（总跨度 ÷ 节点数），避免全部扎堆在一小段时间内，也避免出现异常大跳跃',
    },
    dense: {
        label: '紧凑',
        desc: '节点明显密集于基准间隔，事件在较短时间内连续发生，时间感被压缩',
    },
    sparse: {
        label: '宽松',
        desc: '节点明显稀疏于基准间隔，允许时间跳跃与留白，强调岁月流逝与旅途沉淀',
    },
};

function pacingInfo(key) {
    return PACING_META[key] || PACING_META.balanced;
}

// 前情参考块：旧大纲中已发生或正在进行的节点（status=done/active），
// 作为「既定事实」传给生成 prompt。
// 模型负责判断哪些旧剧情发生在新时间线之前并衔接，哪些旧规划作废。
export function buildHistoryContext(outline) {
    const happened = (outline?.beats || []).filter(b => b.status === 'done' || b.status === 'active');
    if (!happened.length) return '';
    const lines = happened.map(b => {
        const state = b.status === 'active' ? '（进行中）' : '';
        return `- ${state}${b.title || b.id}：${b.summary || '（无概要）'}`;
    });
    return `【已发生的剧情事实（来自旧大纲，时间线调整前的既定历史）】\n${lines.join('\n')}\n`;
}

function cardToText(card) {
    const c = card || {};
    return [
        c.name ? `角色名：${c.name}` : '',
        c.cast ? `角色名录（防止大纲自创冲突角色）：${c.cast}` : '',
        c.description ? `角色描述：${c.description}` : '',
        c.personality ? `性格：${c.personality}` : '',
        c.scenario ? `场景：${c.scenario}` : '',
        c.first_mes ? `开场白：${c.first_mes}` : '',
        c.mes_example ? `示例对话：${c.mes_example}` : '',
        c.system_prompt ? `系统提示：${c.system_prompt}` : '',
        c.depth_prompt ? `深度提示：${c.depth_prompt}` : '',
        c.worldbook ? `世界书：${c.worldbook}` : '',
    ].filter(Boolean).join('\n');
}

// 方向草案 schema：两阶段生成的第一步——先定方向与检索意图，再定向检索，最后正式生成。
// 解决「query 在还没想好写什么时执行」导致的检索不准确问题。
export const DIRECTION_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['direction', 'queries'],
    properties: {
        direction: {
            type: 'string',
            description: '大纲方向：当前剧情位置与接下来要规划的内容，几句话即可',
        },
        queries: {
            type: 'array',
            description: '2-4 条检索词：为写出这个方向需要查证的资料（人名/地名/关键事件/设定术语，越具体越好）',
            items: { type: 'string' },
        },
    },
};

export function buildGeneratePrompt({ characterCard, userRequest = '', detail = 'medium', timeline, mustRead = '', pacing = 'balanced', historyContext = '', ongoingBeatText = '', recentDialogue = '', direction = '', memoryContext = '', vectorContext = '' } = {}) {
    const detailWord = { low: '简洁', medium: '适中', high: '详尽' }[detail] || '适中';
    const t = (timeline && typeof timeline === 'object') ? timeline : {};
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const vectorText = String(vectorContext || '').trim();
    const vectorBlock = vectorText ? `【向量检索到的相关资料（来自记忆插件资料库）】\n${vectorText}\n` : '';
    const historyText = String(historyContext || '').trim();
    const historyBlock = historyText ? `${historyText}

注意：以上旧剧情中，发生在新时间线开始之前的属于既定事实，新大纲必须与之衔接、不得矛盾；发生在新时间线内或之后的旧规划一律作废，按本次要求重新设计；旧大纲中的伏笔若尚未揭晓，可重新设计为新伏笔。\n` : '';
    // 事实边界：当前进行中的节点是不可重规划的既定事实，时间线只能规划它之后
    const ongoingText = String(ongoingBeatText || '').trim();
    const ongoingBlock = ongoingText ? `【事实边界（必须遵守）】
当前剧情正在进行：「${ongoingText}」。该节点及它之前的一切是既定事实，不可重新规划，大纲只能规划它之后（含收束该节点）的未来：
- 若用户指定的时间线开始时间早于该节点所处时间，请自动把 timeline.start 顺延到该节点结束之后，并相应调整整个时间线跨度；
- 新 beats 全部落在顺延后的时间线内，不得与已发生或正在进行的剧情在时间上重叠；
- 第一个新 beat 应衔接该节点的收尾。\n` : '';
    // 近期对话：仅在「从当前位置继续」时携带（首次生成或时间线未修改），
    // 作为当前剧情位置的最新事实，消除新大纲与剧情脱节
    const dialogueText = String(recentDialogue || '').trim();
    const dialogueBlock = dialogueText ? `【近期对话（当前剧情位置的最新事实，必须衔接）】
${dialogueText}

注意：以上对话发生在当前剧情位置，新大纲的开头必须与这些对话自然衔接，不得矛盾、不得重复已发生的事。\n` : '';
    // 方向草案（两阶段生成第一步的产物）：按此展开细化
    const directionText = String(direction || '').trim();
    const directionBlock = directionText ? `【大纲方向（先行草案，请按此展开并细化）】
${directionText}\n` : '';
    const hasTimeline = !!(t.start || t.end || t.note);
    // 必读设定：顶层独立字段优先；兼容旧调用把 mustRead 放在 timeline 对象里
    const mustReadText = String(mustRead || '').trim() || String(t.mustRead || '').trim();
    const mustReadBlock = mustReadPrompt(mustReadText);
    const timelineBlock = (t.start || t.end || t.note)
        ? `【时间线约束（必须遵守）】
- 开始时间：${t.start || '（未指定，请根据故事背景推定）'}
- 结束时间：${t.end || '（未指定，请根据故事背景推定）'}
${t.note ? `- 补充约束：${t.note}` : ''}
- 本大纲只覆盖上述时间线内发生的事，acts 与所有 beats 必须落在该区间内；
- 每幕标题注明该幕覆盖的时间段；每个 beat 的 summary 明确写出大致发生时间；
- 若时间跨度较长，按时间分段拆分幕，并注意人物年龄、势力与关系随时间的自然变化；
- 超出时间线的事件不要规划，时间线上的关键事件不要遗漏。`
        : `【时间线约束】
用户未指定时间线。请根据角色卡与题材自行推定一个合理的故事时间范围，并在 JSON 的 timeline 字段中填写 start/end/note；所有分幕与节点都必须有明确的时间归属。`;

    const pacingMeta = pacingInfo(pacing);
    const pacingBlock = `【节点节奏（档位：${pacingMeta.label}）】
总跨度内共 6-8 个节点，相邻节点间隔以「总跨度 ÷ 节点数」为基准，按「${pacingMeta.label}」档位分布：
- ${pacingMeta.desc}；
- 间隔是相对总跨度的比例：跨度长则间隔长、跨度短则间隔短，不要用绝对时间硬套；
- 每个 beat 的 summary 写清该节点发生时间，时间随节点顺序自然递增，不得回退。`;

    const system = '你是一位擅长群像叙事的小说家，同时接受过严格的剧情架构训练。你先像小说家一样构思各方人物的欲望、对抗与命运，再像架构师一样把构思收敛成严格的 JSON 大纲。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `请为以下角色扮演构建一份${detailWord}的完整故事大纲。题材不限（历史、科幻、奇幻、现代、悬疑等），按角色卡和用户要求来。

这是一份真正的大纲，而不是零散节点。必须避免"主角独角戏"，至少规划四条交织的线：
1) 主角线：主角的欲望、行动与成长；
2) 对抗线：主要对手/反派/阻力的独立动机与行动，不依附主角；
3) 配角线：至少一条重要配角的独立命运，并与主角线交汇；
4) 世界/势力线：背景局势的演变，即使主角不在场也在发生。

${mustReadBlock}${timelineBlock}

${pacingBlock}

${ongoingBlock}${dialogueBlock}${historyBlock}${directionBlock}${memoryBlock}${vectorBlock}【角色卡】
${cardToText(characterCard)}

【新人物许可（允许但须交代）】
剧情需要时允许引入新人物（新对手、新势力、关键配角等），但：
- 不得与角色名录中的既有角色重名或冲突，也不得凭空改写既有角色的身份；
- 新人物的身份、动机与作用必须在 arcs 或 beats 中交代清楚；
- 新人物应服务于故事需要，而非凑数。

【用户要求】
${userRequest || '（未指定，请自行设计一个有深度的完整故事方向）'}

请严格按以下 JSON 结构输出（字段名必须完全一致，不要增删字段，不要用 markdown 代码块包裹）：

{
  "theme": "故事主题",
  "tone": "情绪基调",
  "world": "世界观与冲突根源",
  "mustRead": "必读设定（没有则留空）",
  "timeline": { "start": "大纲开始时间", "end": "大纲结束时间", "note": "时间线说明" },
  "arcs": [
    { "character": "主角", "arc": "完整弧光：欲望、缺陷、成长与结局方向", "status": "active" },
    { "character": "主要对手/反派", "arc": "其独立动机、行动与结局方向", "status": "pending" },
    { "character": "重要配角", "arc": "其独立命运与主角线交汇点", "status": "pending" }
  ],
  "foreshadowing": [
    { "id": "f1", "hint": "伏笔一句话描述", "status": "pending", "payoff": "回收方式", "beatId": "beat_5" }
  ],
  "acts": [
    { "id": "act_1", "title": "第一幕：开端（时间：起止时间）", "summary": "本幕讲什么", "beats": ["beat_1", "beat_2"] },
    { "id": "act_2", "title": "第二幕：发展（时间：起止时间）", "summary": "本幕讲什么", "beats": ["beat_3", "beat_4"] },
    { "id": "act_3", "title": "第三幕：高潮（时间：起止时间）", "summary": "本幕讲什么", "beats": ["beat_5", "beat_6"] },
    { "id": "act_4", "title": "第四幕：结局（时间：起止时间）", "summary": "本幕讲什么", "beats": ["beat_7", "beat_8"] }
  ],
  "beats": [
    { "id": "beat_1", "actId": "act_1", "title": "节点标题", "summary": "该节点发生什么（写明时间点）", "type": "setup", "status": "pending", "cast": ["主角", "配角"] },
    { "id": "beat_2", "actId": "act_1", "title": "节点标题", "summary": "该节点发生什么（写明时间点）", "type": "conflict", "status": "pending", "cast": ["主角", "对手"] }
  ],
  "focus": {
    "currentBeat": "beat_1",
    "nextStep": "当前应当推进的剧情方向",
    "activeForeshadow": ["f1"],
    "avoidOffTopic": "需要避免偏离的内容"
  }
}

要求：acts 按起承转合分 3-4 幕，每幕 title 标注时间跨度；beats 共 6-8 个并全部归属到 act（actId 必须与 acts.beats 对应）；每个 beat 必须写 cast（本节点实际出场的角色），避免独角戏；每个 beat 的 summary 写清楚该节点发生什么、各方人物目标、转折和大致时间，type 只能从 setup/conflict/twist/climax/resolution 中选择；foreshadowing 尽量用对象形式并指定在哪个 beat 回收（beatId 必须真实存在）；arcs.status 表示该角色弧光当前进度（pending/active/done）；第一个 beat 的 status 设为 "active"，其余为 "pending"。`;
    return { system, prompt };
}

// 修订输入压缩：已完成节点只保留骨架（id/title/status/actId），省略 summary/cast 等细节。
// 修订时这些节点的细节对「判断下一步」没有信息量，却能占掉大纲 token 的大头。
// 注意：tracker.applyRevision 会在合并后从旧大纲恢复这些细节（见 tracker.js）。
export function compactOutlineForRevision(outline) {
    const o = normalizeOutline(outline);
    return {
        ...o,
        beats: o.beats.map(b => (b.status === 'done'
            ? { id: b.id, title: b.title, status: b.status, actId: b.actId }
            : b)),
    };
}

// 两阶段生成第一步：方向草案。输入与正式生成相同的上下文（不含向量结果），
// 让模型先「想清楚怎么写」并输出精准检索词，再执行第二轮检索，最后正式生成。
// 解决「query 在还没想好写什么时执行」导致的检索不准确问题。
export function buildDirectionPrompt({ characterCard, userRequest = '', timeline, mustRead = '', pacing = 'balanced', historyContext = '', ongoingBeatText = '', recentDialogue = '' } = {}) {
    const t = (timeline && typeof timeline === 'object') ? timeline : {};
    const mustReadText = String(mustRead || '').trim() || String(t.mustRead || '').trim();
    const historyText = String(historyContext || '').trim();
    const historyBlock = historyText ? `【已发生的剧情事实（来自旧大纲，时间线调整前的既定历史）】\n${historyText}\n` : '';
    const ongoingText = String(ongoingBeatText || '').trim();
    const ongoingBlock = ongoingText ? `【事实边界（必须遵守）】
当前剧情正在进行：「${ongoingText}」。该节点及它之前的一切是既定事实，不可重新规划，大纲只能规划它之后。\n` : '';
    const dialogueText = String(recentDialogue || '').trim();
    const dialogueBlock = dialogueText ? `【近期对话（当前剧情位置的最新事实）】
${dialogueText}\n` : '';
    const timelineBlock = (t.start || t.end || t.note)
        ? `【时间线约束】
- 开始时间：${t.start || '（未指定）'}，结束时间：${t.end || '（未指定）'}
${t.note ? `- 补充约束：${t.note}` : ''}\n`
        : '【时间线约束】用户未指定时间线，请自行推定。\n';
    const pacingMeta = pacingInfo(pacing);
    const system = '你是叙事导演。先想清楚新大纲的方向，再列出为写出这个方向需要查证哪些资料（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `请为以下角色扮演规划新大纲的方向。方向由故事逻辑与上下文决定，不要只围绕已有资料写。

${mustReadPrompt(mustReadText)}${timelineBlock}【节点节奏（档位：${pacingMeta.label}）】
${pacingMeta.desc}。

${ongoingBlock}${dialogueBlock}${historyBlock}【角色卡】
${cardToText(characterCard)}

【用户要求】
${userRequest || '（未指定，请自行设计一个有深度的完整故事方向）'}

请按以下 JSON 结构输出（字段名完全一致，不要 markdown 代码块）：

{
  "direction": "大纲方向：当前剧情位置 + 接下来要规划的内容（几句话，具体到人物、事件、冲突）",
  "queries": ["检索词1", "检索词2", "检索词3"]
}

要求：
1) direction 要具体：新时间线内会发生什么、谁与谁冲突、关键转折；
2) queries 是 2-4 条检索词，用于查证方向中不确定的资料（人名/地名/关键事件/设定术语，越具体越好，如「曹操的皮甲」「沁水渠」）；
3) 检索词不要是「角色扮演」「故事大纲」这类泛词。`;
    return { system, prompt };
}

function mustReadPrompt(text) {
    const t = String(text || '').trim();
    return t ? `【必读设定（最高优先级，与任何其他设定冲突时以此为准）】\n${t}\n` : '';
}

export function buildRevisePrompt({ recentDialogue = '', outline, driftTolerance = 'loose', locked = false, pacing = 'balanced', memoryContext = '', vectorContext = '' }) {
    const system = '你是叙事导演。根据最近的对话进展，更新故事大纲（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const vectorText = String(vectorContext || '').trim();
    const vectorBlock = vectorText ? `【向量检索到的相关资料（来自记忆插件资料库）】\n${vectorText}\n` : '';
    const driftInstruction = driftTolerance === 'strict'
        ? '若剧情偏离当前方向，请严格拉回：不要为偏离新增节点，优先把 focus.currentBeat / focus.nextStep 调整回既定节点与方向；仅当偏离已成为不可逆事实时，才做最小化吸收并说明理由。'
        : '若剧情偏离当前方向，请宽松吸收：把新走向写进大纲（改写 focus.nextStep 或插入新 beat），而非强行拉回。';
    const lockInstruction = locked
        ? '大纲当前已锁定（用户手动编辑模式）：禁止改写任何现有 act 或 beat 的 title/summary/type，也禁止修改 timeline；只能推进 status、更新 focus 与伏笔状态；确有必要时允许追加新 beat 并同步 acts.beats，但不得修改既有内容。若剧情已越过 timeline.end，把 focus.nextStep 写成“已超出当前时间线，建议生成下一段大纲”。'
        : '';
    const prompt = `【最近对话】
${recentDialogue}

${memoryBlock}${vectorBlock}【当前大纲】
${serializeOutline(compactOutlineForRevision(outline))}

（注：大纲中标记为 "done" 的已完成节点已省略细节，仅保留标题。输出时请原样保留这些节点及其全部字段——它们已经发生，不要改写或补写它们的 summary/cast/type。）

请执行：1) 判断当前情节节点是否真正到达终点（目标达成、冲突收场或场景明确结束）。大纲不是剧情日志：常规对话轮次不要推进节点状态、不要新建节点，只需微调 focus；只有里程碑式的完成才把该 beat 的 status 改为 "done" 并推进下一个为 "active"；2) ${driftInstruction}；3) 更新伏笔状态（status/beatId）；4) 根据节点完成情况更新 arcs[].status；5) 若插入或删除 beat，同步维护 acts 里的 beats 列表；6) 检查对话中的时间推进是否仍在 timeline.start 与 timeline.end 之间：若仍在区间内，正常更新；若已不可逆地越过 timeline.end，把 timeline.end 顺延并补一个过渡 beat，不要删除原有大纲。7) 新增节点的时间点遵循当前节点节奏档位（${pacingInfo(pacing).label}）：间隔相对总跨度合理分布，不要与既有节点全部扎堆在同一时刻。8) 对话中出现的名录外新角色（新对手/新势力等）：允许将其纳入 arcs 或后续节点，但须简要交代其身份与动机；不得与既有角色重名冲突。${lockInstruction ? `\n\n${lockInstruction}` : ''}

严格保持【当前大纲】的 JSON 结构不变（字段名完全一致，不要 markdown 代码块），输出更新后的完整大纲。`;
    return { system, prompt };
}

// 锁定模式的增量补丁修订：模型只输出「变化的部分」而不是完整大纲。
// 输出 token 从全量大纲（数百上千）降到几十；tracker.applyPatch 负责字段级合并。
export function buildRevisePatchPrompt({ recentDialogue = '', outline, driftTolerance = 'loose', memoryContext = '', vectorContext = '' }) {
    const system = '你是叙事导演。大纲已锁定（用户手动编辑），只能推进状态与焦点。根据最近对话输出最小变更补丁（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const vectorText = String(vectorContext || '').trim();
    const vectorBlock = vectorText ? `【向量检索到的相关资料（来自记忆插件资料库）】\n${vectorText}\n` : '';
    const driftInstruction = driftTolerance === 'strict'
        ? '若剧情偏离当前方向，请严格拉回：不新增节点，只把 focus.currentBeat / focus.nextStep 调整回既定方向；仅当偏离已成不可逆事实时才最小化吸收。'
        : '若剧情偏离当前方向，请宽松吸收：把新走向写进 focus.nextStep；确有必要时用 newBeats 追加一个节点。';
    const prompt = `【最近对话】
${recentDialogue}

${memoryBlock}${vectorBlock}【当前大纲（已锁定，禁止改动任何现有内容）】
${serializeOutline(compactOutlineForRevision(outline))}

（注：大纲中标记为 "done" 的已完成节点已省略细节，仅保留标题，无需处理它们。）

${driftInstruction} 若剧情已越过 timeline.end，把 focus.nextStep 写成“已超出当前时间线，建议生成下一段大纲”。

请只输出变更补丁，严格按以下 JSON 结构（字段名完全一致，不要 markdown 代码块；没有变化的字段省略，不要输出完整大纲）：

{
  "statusChanges": [ { "beatId": "beat_1", "status": "done" }, { "beatId": "beat_2", "status": "active" } ],
  "focus": { "currentBeat": "beat_2", "nextStep": "下一步应当发生什么", "activeForeshadow": ["f1"], "avoidOffTopic": "需要避免偏离的内容" },
  "foreshadowing": [ { "id": "f1", "status": "active" } ],
  "arcs": [ { "char": "主角", "status": "active" } ],
  "newBeats": [ { "title": "新增节点标题", "summary": "该节点发生什么", "type": "conflict", "status": "pending", "cast": ["主角"] } ],
  "newBeatActId": "act_2"
}

规则：
1) statusChanges：仅当节点真正到达终点（目标达成/冲突收场/场景明确结束）才置 "done" 并推进下一个为 "active"；大纲不是剧情日志，常规对话轮次不要推进节点、不要新增节点，只更新 focus 即可；没有状态变化就省略；
2) focus 建议总是输出（这是导演指令的核心）；
3) foreshadowing/arcs：只列出状态发生变化的条目；
4) newBeats：仅在剧情确实需要新节点时使用（真正的里程碑/新情节线），数量越少越好，并给出 newBeatActId 归属幕（必须是现有 act id）；
5) 禁止任何字段修改现有 beat/act/timeline 的标题、概要、类型与时间线。`;
    return { system, prompt };
}

// 单个节点的 AI 生成：基于当前大纲 + 用户一句话提示，输出一个新 beat 的 JSON。
// 用于节点编辑器的「AI 生成」入口（生成后填入表单，由用户确认再保存）。
// 对话正文标签分析：让 AI 扫描最近对话，识别正文的包裹标签样式，
// 返回规则建议供用户检查确认（不做自动生效）。
// 支持三种规则形态：
//   白名单 HTML 标签：正文包裹标签，如 <content>…</content>——{ type: 'html_tag', tag, exclude: false }
//   黑名单 HTML 标签：无用信息标签，如 <think>…</think>——{ type: 'html_tag', tag, exclude: true }
//   字符对：如 【…】、*…*——{ type: 'pair', open, close }
// 思考/推理过程（如 <think>、<reasoning>）不属于正文：有正文标签时建议白名单，
// 正文没标签包裹时建议把 think 等列为黑名单（排除后保留其余全文）。
export function buildDialogueAnalyzePrompt({ dialogue = '' } = {}) {
    const system = '你是叙事导演。分析角色扮演对话中「正文」的包裹标签样式，输出 JSON。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `【最近对话】
${String(dialogue || '').slice(0, 8000)}

请分析这段对话中正文（角色实际说出/做出的内容，区别于思考过程、动作旁白、系统提示、括号内注释等）的包裹标签样式，按以下 JSON 结构输出（字段名完全一致，不要 markdown 代码块）：

{
  "patterns": [
    { "type": "html_tag", "tag": "content", "exclude": false, "label": "正文", "sample": "从对话中摘一句真实提取结果示例" }
  ],
  "note": "一句话说明这些规则如何工作（可选）"
}

要求：
1. 若正文包裹在 HTML 标签中（如 <content>…</content>、<speech>…</speech> 等），输出 type 为 "html_tag"、exclude 为 false，tag 为标签名（不含尖括号，按对话中真实出现的标签）；
2. 若对话中存在明显的非正文标签（如 <think>、<reasoning>、<thought> 等思考/推理内容），也输出为 html_tag 规则且 exclude 为 true（黑名单：提取时删除这些标签块，保留其余全文）——尤其是正文没有标签包裹时，黑名单是唯一可用的清理方式；
3. 若正文用字符对包裹（如【…】、*…*），输出 type 为 "pair"，open/close 为真实开始/结束符；
4. 只输出对话中真实出现的样式（1-4 条，白名单与黑名单都算）；若对话中既没有正文标签也没有可排除的标签，patterns 输出空数组；不要臆造不存在的标签。`;
    return { system, prompt };
}

export function buildBeatPrompt({ outline, userHint = '' } = {}) {
    const system = '你是叙事导演。根据当前大纲与用户提示，设计一个新情节节点（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `【当前大纲】
${serializeOutline(compactOutlineForRevision(outline))}

【用户提示】
${userHint || '（未指定，请根据大纲当前焦点与未完成节点，设计一个自然的推进节点）'}

请设计一个新情节节点，严格按以下 JSON 结构输出（字段名完全一致，不要 markdown 代码块）：

{
  "title": "节点标题",
  "summary": "该节点发生什么（写明大致时间点，与既有节点时间线自然衔接，遵循大纲的节点节奏）",
  "type": "setup 或 conflict 或 twist 或 climax 或 resolution",
  "status": "pending",
  "cast": ["参与角色1", "参与角色2"],
  "actId": "建议归属的幕 id（必须是当前大纲中真实存在的 act id；不确定时用当前焦点所在幕）"
}

要求：不要与大纲中已有的节点重复；情节符合大纲的时间线、必读设定与当前焦点；参与角色优先从大纲已有角色中选择，确有必要引入新角色时须简要交代其身份；summary 的时间与既有节点自然衔接、不回退。`;
    return { system, prompt };
}

export function buildCheckPrompt({ recentDialogue = '', outline, pacing = 'balanced', memoryContext = '', vectorContext = '' }) {
    const system = '你是叙事导演。对比最近对话与当前大纲（含时间线约束），输出同步性诊断报告（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const vectorText = String(vectorContext || '').trim();
    const vectorBlock = vectorText ? `【向量检索到的相关资料（来自记忆插件资料库）】\n${vectorText}\n` : '';
    const prompt = `【最近对话】
${recentDialogue}

${memoryBlock}${vectorBlock}【当前大纲】
${serializeOutline(outline)}

请判断大纲（timeline 时间线、分幕结构、情节节点、伏笔与焦点）是否仍与剧情同步，并按以下 JSON 结构输出（字段名完全一致，不要 markdown 代码块）：

{
  "verdict": "sync 或 minor-drift 或 major-drift",
  "issues": [ { "where": "位置", "what": "问题", "severity": "low/mid/high" } ],
  "changed": true,
  "changes": "修改内容摘要",
  "reason": "判断依据",
  "updatedOutline": { ...完整大纲，结构与当前大纲一致... }
}

检查要点：1) 对话中体现的剧情时间是否还在 timeline.start 与 timeline.end 之间；2) 时间若已越过 timeline.end，应在 issues 中标注时间线漂移，并在 updatedOutline 中顺延 timeline 或补过渡节点；3) 分幕与节点是否仍然合理；4) 节点时间分布是否与总跨度匹配（当前节奏档位：${pacingInfo(pacing).label}）：是否存在全部节点扎堆在同一时间段、或相邻节点出现异常大的时间跳跃；若有，在 issues 中标明。

若需要修改，changed=true 且 updatedOutline 输出修改后的完整大纲；若无需修改，changed=false，省略 updatedOutline。`;
    return { system, prompt };
}

export function buildDirectorInstruction(outline, strength = 'strong') {
    const f = outline?.focus || {};
    const lines = [];
    lines.push('【叙事导演指令】');
    if (strength === 'strong') {
        lines.push('你必须严格遵循以下剧情方向推进，不得偏离：');
    } else {
        lines.push('请参考以下剧情方向，尽量朝此推进：');
    }
    if (f.currentBeat) lines.push(`- 当前情节节点：${f.currentBeat}`);
    if (f.nextStep) lines.push(`- 下一步应当发生：${f.nextStep}`);
    const timeline = outline?.timeline;
    if (timeline?.start || timeline?.end) {
        lines.push(`- 当前时间线：${timeline.start || '?'} 至 ${timeline.end || '?'}`);
    }
    if (Array.isArray(f.activeForeshadow) && f.activeForeshadow.length) {
        lines.push(`- 活跃伏笔：${f.activeForeshadow.join('、')}`);
    }
    if (f.avoidOffTopic) lines.push(`- 避免偏离：${f.avoidOffTopic}`);
    return lines.join('\n');
}
