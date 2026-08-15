// story-director/src/prompts.js
// 纯逻辑：提示词模板与 JSON Schema。零依赖。
import { serializeOutline } from './outline-store.js';

export const OUTLINE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['theme', 'tone', 'world', 'arcs', 'foreshadowing', 'beats', 'focus'],
    properties: {
        theme: { type: 'string', description: '故事主题' },
        tone: { type: 'string', description: '情绪基调' },
        world: { type: 'string', description: '世界观与冲突根源' },
        arcs: {
            type: 'array',
            items: {
                type: 'object',
                required: ['character', 'arc'],
                properties: {
                    character: { type: 'string', description: '角色名' },
                    arc: { type: 'string', description: '角色弧光：从何处到何处、欲望与成长' },
                },
            },
        },
        foreshadowing: {
            type: 'array',
            description: '伏笔列表，每条为一个字符串（一句话描述伏笔及其回收方式）',
            items: {
                type: 'string',
            },
        },
        beats: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'title', 'summary', 'status'],
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
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

export function buildGeneratePrompt({ characterCard, userRequest = '', detail = 'medium' }) {
    const detailWord = { low: '简洁', medium: '适中', high: '详尽' }[detail] || '适中';
    const system = '你是一位资深叙事设计师。根据角色卡和用户要求，构建一份结构化的故事大纲（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `请为以下角色扮演构建一份${detailWord}的完整故事大纲。

【角色卡】
${cardToText(characterCard)}

【用户要求】
${userRequest || '（未指定，请自行设计一个有深度的故事方向）'}

请严格按以下 JSON 结构输出（字段名必须完全一致，不要增删字段，不要用 markdown 代码块包裹）：

{
  "theme": "故事主题",
  "tone": "情绪基调",
  "world": "世界观与冲突根源",
  "arcs": [
    { "character": "角色名", "arc": "该角色的弧光：欲望、缺陷、成长方向" }
  ],
  "foreshadowing": [
    "伏笔一句话描述（含后续回收方式）"
  ],
  "beats": [
    { "id": "beat_1", "title": "节点标题", "summary": "该节点发生什么", "status": "pending" },
    { "id": "beat_2", "title": "节点标题", "summary": "该节点发生什么", "status": "pending" },
    { "id": "beat_3", "title": "节点标题", "summary": "该节点发生什么", "status": "pending" }
  ],
  "focus": {
    "currentBeat": "beat_1",
    "nextStep": "当前应当推进的剧情方向",
    "activeForeshadow": ["伏笔1"],
    "avoidOffTopic": "需要避免偏离的内容"
  }
}

beats 至少 3 个，按起承转合排列；第一个 beat 的 status 设为 "active"，其余为 "pending"。`;
    return { system, prompt };
}

export function buildRevisePrompt({ recentDialogue = '', outline, driftTolerance = 'loose' }) {
    const system = '你是叙事导演。根据最近的对话进展，更新故事大纲（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const driftInstruction = driftTolerance === 'strict'
        ? '若剧情偏离当前方向，请严格拉回：不要为偏离新增节点，优先把 focus.currentBeat / focus.nextStep 调整回既定节点与方向；仅当偏离已成为不可逆事实时，才做最小化吸收并说明理由。'
        : '若剧情偏离当前方向，请宽松吸收：把新走向写入大纲（改写 focus.nextStep 或插入新 beat），而非强行拉回。';
    const prompt = `【最近对话】
${recentDialogue}

【当前大纲】
${serializeOutline(outline)}

请执行：1) 判断当前情节节点是否完成，若完成则推进到下一个节点（将该 beat 的 status 改为 "done"，并把下一个 beat 的 status 改为 "active"）；2) ${driftInstruction}；3) 更新伏笔状态。

严格保持【当前大纲】的 JSON 结构不变（字段名完全一致，不要 markdown 代码块），输出更新后的完整大纲。`;
    return { system, prompt };
}

export function buildCheckPrompt({ recentDialogue = '', outline }) {
    const system = '你是叙事导演。对比最近对话与当前大纲，输出同步性诊断报告（JSON）。只输出 JSON，不要 markdown 代码块，不要任何解释文字。';
    const prompt = `【最近对话】
${recentDialogue}

【当前大纲】
${serializeOutline(outline)}

请判断大纲是否仍与剧情同步，并按以下 JSON 结构输出（字段名完全一致，不要 markdown 代码块）：

{
  "verdict": "sync 或 minor-drift 或 major-drift",
  "issues": [ { "where": "位置", "what": "问题", "severity": "low/mid/high" } ],
  "changed": true,
  "changes": "修改内容摘要",
  "reason": "判断依据",
  "updatedOutline": { ...完整大纲，结构与当前大纲一致... }
}

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
    if (Array.isArray(f.activeForeshadow) && f.activeForeshadow.length) {
        lines.push(`- 活跃伏笔：${f.activeForeshadow.join('、')}`);
    }
    if (f.avoidOffTopic) lines.push(`- 避免偏离：${f.avoidOffTopic}`);
    return lines.join('\n');
}
