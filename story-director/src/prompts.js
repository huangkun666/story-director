// story-director/src/prompts.js
// 纯逻辑：提示词模板与 JSON Schema。零依赖。
import { serializeOutline } from './outline-store.js';

export const OUTLINE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['theme', 'tone', 'world', 'timeline', 'arcs', 'foreshadowing', 'acts', 'beats', 'focus'],
    properties: {
        theme: { type: 'string', description: '故事主题' },
        tone: { type: 'string', description: '情绪基调' },
        world: { type: 'string', description: '世界观与冲突根源' },
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

export function buildGeneratePrompt({ characterCard, userRequest = '', detail = 'medium', timeline, memoryContext = '' } = {}) {
    const detailWord = { low: '简洁', medium: '适中', high: '详尽' }[detail] || '适中';
    const t = (timeline && typeof timeline === 'object') ? timeline : {};
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const hasTimeline = !!(t.start || t.end || t.note);
    const timelineBlock = hasTimeline
        ? `【时间线约束（必须遵守）】
- 开始时间：${t.start || '（未指定，请根据故事背景推定）'}
- 结束时间：${t.end || '（未指定，请根据故事背景推定）'}
${t.note ? `- 补充约束：${t.note}` : ''}
- 本大纲只覆盖上述时间线内发生的事，acts 与所有 beats 必须落在该区间内；
- 每幕标题注明该幕覆盖的时间段；每个 beat 的 summary 明确写出大致发生时间；
- 若时间跨度较长（多年），按年代拆分幕，并注意人物年龄、势力与关系随时间的自然变化；
- 超出时间线的事件不要规划，时间线上的关键事件不要遗漏。`
        : `【时间线约束】
用户未指定时间线。请根据角色卡与题材自行推定一个合理的故事时间范围，并在 JSON 的 timeline 字段中填写 start/end/note；所有分幕与节点都必须有明确的时间归属。`;

    const system = '你是一位资深叙事设计师。根据角色卡、时间线约束和用户要求，构建一份完整的故事大纲（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `请为以下角色扮演构建一份${detailWord}的完整故事大纲。

这是一份真正的大纲，而不是零散节点：必须包含分幕结构（起承转合）、每幕下的情节节点、角色弧光与伏笔，覆盖完整故事走向（含高潮与结局方向）。

${timelineBlock}

${memoryBlock}【角色卡】
${cardToText(characterCard)}

【用户要求】
${userRequest || '（未指定，请自行设计一个有深度的完整故事方向）'}

请严格按以下 JSON 结构输出（字段名必须完全一致，不要增删字段，不要用 markdown 代码块包裹）：

{
  "theme": "故事主题",
  "tone": "情绪基调",
  "world": "世界观与冲突根源",
  "timeline": { "start": "大纲开始时间", "end": "大纲结束时间", "note": "时间线说明" },
  "arcs": [
    { "character": "角色名", "arc": "该角色的完整弧光：欲望、缺陷、成长与结局方向", "status": "pending" }
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
    { "id": "beat_1", "actId": "act_1", "title": "节点标题", "summary": "该节点发生什么（写明时间点）", "type": "setup", "status": "pending" },
    { "id": "beat_2", "actId": "act_1", "title": "节点标题", "summary": "该节点发生什么（写明时间点）", "type": "conflict", "status": "pending" }
  ],
  "focus": {
    "currentBeat": "beat_1",
    "nextStep": "当前应当推进的剧情方向",
    "activeForeshadow": ["f1"],
    "avoidOffTopic": "需要避免偏离的内容"
  }
}

要求：acts 按起承转合分 3-4 幕，每幕 title 标注时间跨度；beats 共 6-8 个并全部归属到 act（actId 必须与 acts.beats 对应）；每个 beat 的 summary 写清楚该节点发生什么、人物目标、转折和大致时间，type 只能从 setup/conflict/twist/climax/resolution 中选择；foreshadowing 尽量用对象形式并指定在哪个 beat 回收（beatId 必须真实存在）；arcs.status 表示该角色弧光当前进度（pending/active/done）；第一个 beat 的 status 设为 "active"，其余为 "pending"。`;
    return { system, prompt };
}

export function buildRevisePrompt({ recentDialogue = '', outline, driftTolerance = 'loose', locked = false, memoryContext = '' }) {
    const system = '你是叙事导演。根据最近的对话进展，更新故事大纲（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const driftInstruction = driftTolerance === 'strict'
        ? '若剧情偏离当前方向，请严格拉回：不要为偏离新增节点，优先把 focus.currentBeat / focus.nextStep 调整回既定节点与方向；仅当偏离已成为不可逆事实时，才做最小化吸收并说明理由。'
        : '若剧情偏离当前方向，请宽松吸收：把新走向写进大纲（改写 focus.nextStep 或插入新 beat），而非强行拉回。';
    const lockInstruction = locked
        ? '大纲当前已锁定（用户手动编辑模式）：禁止改写任何现有 act 或 beat 的 title/summary/type，也禁止修改 timeline；只能推进 status、更新 focus 与伏笔状态；确有必要时允许追加新 beat 并同步 acts.beats，但不得修改既有内容。若剧情已越过 timeline.end，把 focus.nextStep 写成“已超出当前时间线，建议生成下一段大纲”。'
        : '';
    const prompt = `【最近对话】
${recentDialogue}

${memoryBlock}【当前大纲】
${serializeOutline(outline)}

请执行：1) 判断当前情节节点是否完成，若完成则推进到下一个节点（将该 beat 的 status 改为 "done"，并把下一个 beat 的 status 改为 "active"）；2) ${driftInstruction}；3) 更新伏笔状态（status/beatId）；4) 根据节点完成情况更新 arcs[].status；5) 若插入或删除 beat，同步维护 acts 里的 beats 列表；6) 检查对话中的时间推进是否仍在 timeline.start 与 timeline.end 之间：若仍在区间内，正常更新；若已不可逆地越过 timeline.end，把 timeline.end 顺延并补一个过渡 beat，不要删除原有大纲。${lockInstruction ? `\n\n${lockInstruction}` : ''}

严格保持【当前大纲】的 JSON 结构不变（字段名完全一致，不要 markdown 代码块），输出更新后的完整大纲。`;
    return { system, prompt };
}

export function buildCheckPrompt({ recentDialogue = '', outline, memoryContext = '' }) {
    const system = '你是叙事导演。对比最近对话与当前大纲（含时间线约束），输出同步性诊断报告（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const memoryText = String(memoryContext || '').trim();
    const memoryBlock = memoryText ? `【长时记忆（来自记忆插件，优先采信）】\n${memoryText}\n` : '';
    const prompt = `【最近对话】
${recentDialogue}

${memoryBlock}【当前大纲】
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

检查要点：1) 对话中体现的剧情时间是否还在 timeline.start 与 timeline.end 之间；2) 时间若已越过 timeline.end，应在 issues 中标注时间线漂移，并在 updatedOutline 中顺延 timeline 或补过渡节点；3) 分幕与节点是否仍然合理。

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
