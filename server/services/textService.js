const DEFAULT_MOCK_ERROR = "未配置火山方舟 API Key 或豆包文本模型 ID，无法生成真实分镜和首帧图。";

async function generateStoryboardWithArkDoubao(input) {
  const { storyText, extraNotes, totalDuration, pacing, shotCountMode, manualShotCount, aspectRatio, referenceImageGroups } = input;
  if (!process.env.ARK_API_KEY || !process.env.ARK_TEXT_MODEL) {
    return createMockProject({ totalDuration, pacing, aspectRatio });
  }

  const baseUrl = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const payload = {
    model: process.env.ARK_TEXT_MODEL,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserContent({ storyText, extraNotes, totalDuration, pacing, shotCountMode, manualShotCount, aspectRatio, referenceImageGroups }) }
    ],
    temperature: 0.7,
    response_format: { type: "json_object" }
  };

  let response = await callArkChat(`${baseUrl}/chat/completions`, payload);
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    const retryPayload = { ...payload };
    delete retryPayload.response_format;
    response = await callArkChat(`${baseUrl}/chat/completions`, retryPayload);
  }

  const body = await readJsonOrText(response);
  if (!response.ok) throw new Error(extractErrorMessage(body) || "调用火山方舟豆包模型失败。");
  const content = body?.choices?.[0]?.message?.content;
  return normalizeStoryboardResult(parseJsonContent(content), totalDuration, aspectRatio, pacing);
}

function buildUserContent(input) {
  const groups = input.referenceImageGroups || {};
  const content = [{ type: "text", text: [
    `用户故事：${input.storyText}`,
    `补充说明：${input.extraNotes || "无"}`,
    `总视频时长：${input.totalDuration} 秒`,
    `节奏类型：${input.pacing}`,
    `分镜数量模式：${input.shotCountMode}`,
    `手动分镜数量：${input.shotCountMode === "手动指定" ? input.manualShotCount : "无"}`,
    `画幅比例：${input.aspectRatio}`,
    "请严格返回 JSON。"
  ].join("\n") }];
  appendImageGroup(content, "以下是视频风格参考图", groups.styleReferenceImages);
  appendImageGroup(content, "以下是主角参考图", groups.characterReferenceImages);
  appendImageGroup(content, "以下是场景参考图", groups.sceneReferenceImages);
  return content;
}

function appendImageGroup(content, title, images = []) {
  content.push({ type: "text", text: `${title}（${images.length} 张）` });
  for (const image of images) content.push({ type: "image_url", image_url: { url: image.dataUrl } });
}

function buildSystemPrompt() {
  return [
    "你是专业导演、编剧、分镜师、视觉开发师和 AI 视频提示词工程师。",
    "任务：分析故事和三类参考图，自动判断分镜数量、分配每镜时长，生成分镜脚本、首帧图片提示词和 Seedance 2.0 图生视频提示词。",
    "所有输出必须是中文，只返回严格 JSON，不要 Markdown，不要解释文字。",
    "必须严格参考上传的视频风格图、主角图和场景图，禁止忽略参考图，禁止只根据故事文字生成。",
    "所有分镜 durationSeconds 总和必须等于 totalDuration，每个分镜只表现一个剧情节点。",
    "imagePrompt 必须包含：【画幅比例】【当前剧情节点】【首帧定格画面】【参考图继承要求】【主体】【主体动作】【场景】【构图】【镜头】【光线】【色彩】【风格】【画面细节】【一致性要求】【负面提示词】。首帧定格画面必须写清主角位置、姿态、视线、手部动作、关键道具和前中后景关系。",
    "videoPrompt 必须包含：【参考图说明】【当前剧情节点】【主体动作】【动作过程】【镜头运动】【场景变化】【光影氛围】【风格质感】【时长与节奏】【结束画面】【与前后镜头衔接】【一致性要求】【避免事项】。动作过程必须按时间顺序写清完整动作。",
    "返回结构字段：projectTitle,totalDurationSeconds,pacing,aspectRatio,autoShotCountReason,referenceAnalysis,storyAnalysis,shots。每个 shot 包含 shotNumber,title,storyBeat,durationSeconds,duration,visualDescription,characterAction,cameraMovement,dialogueOrNarration,transition,imagePrompt,videoPrompt,negativePrompt,imageUrl,imageError,provider。"
  ].join("\n");
}

function callArkChat(url, payload) {
  const timeoutMs = Number(process.env.ARK_TEXT_TIMEOUT_MS) || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") throw new Error(`调用火山方舟豆包模型超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络、模型 ID 或稍后重试。`);
    throw error;
  }).finally(() => clearTimeout(timer));
}

async function readJsonOrText(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

function extractErrorMessage(body) {
  if (typeof body === "string") return body;
  return body?.error?.message || body?.message || body?.error || "";
}

function parseJsonContent(content) {
  if (!content) throw new Error("豆包模型返回为空。");
  if (typeof content === "object") return content;
  const raw = String(content).trim();
  try { return JSON.parse(raw); } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("豆包模型没有返回可解析的 JSON。");
  }
}

function normalizeStoryboardResult(project, totalDuration = 30, aspectRatio = "9:16", pacing = "标准") {
  const expectedDuration = Math.max(1, Number.parseInt(totalDuration, 10) || 30);
  const normalized = project && typeof project === "object" ? project : createMockProject({ totalDuration: expectedDuration, aspectRatio, pacing });
  normalized.projectTitle = text(normalized.projectTitle) || "短视频分镜方案";
  normalized.totalDurationSeconds = expectedDuration;
  normalized.pacing = text(normalized.pacing) || pacing || "标准";
  normalized.aspectRatio = text(normalized.aspectRatio) || aspectRatio || "9:16";
  normalized.autoShotCountReason = text(normalized.autoShotCountReason) || "根据剧情节奏、动作节点和总时长自动分配分镜。";
  normalized.referenceAnalysis = normalized.referenceAnalysis || {};
  normalized.storyAnalysis = normalized.storyAnalysis || {};
  const sourceShots = Array.isArray(normalized.shots) && normalized.shots.length ? normalized.shots : createMockProject({ totalDuration: expectedDuration, aspectRatio, pacing }).shots;
  normalized.shots = sourceShots.map((shot, index) => normalizeShot(shot, index, normalized.aspectRatio));
  fixDurations(normalized.shots, expectedDuration);
  return normalized;
}

function normalizeShot(shot, index, aspectRatio) {
  const item = shot && typeof shot === "object" ? shot : {};
  const durationSeconds = Math.max(1, Number.parseInt(item.durationSeconds, 10) || 1);
  const storyBeat = text(item.storyBeat) || `分镜 ${index + 1}`;
  return {
    shotNumber: Number.parseInt(item.shotNumber, 10) || index + 1,
    title: text(item.title) || storyBeat,
    storyBeat,
    durationSeconds,
    duration: `${durationSeconds}秒`,
    visualDescription: text(item.visualDescription),
    characterAction: text(item.characterAction),
    cameraMovement: text(item.cameraMovement),
    dialogueOrNarration: text(item.dialogueOrNarration),
    transition: text(item.transition),
    imagePrompt: text(item.imagePrompt) || buildFallbackImagePrompt(index + 1, aspectRatio, storyBeat),
    videoPrompt: text(item.videoPrompt) || buildFallbackVideoPrompt(index + 1, durationSeconds, storyBeat),
    negativePrompt: text(item.negativePrompt),
    imageUrl: text(item.imageUrl),
    imageError: text(item.imageError),
    provider: text(item.provider)
  };
}

function fixDurations(shots, totalDuration) {
  if (!shots.length) return;
  let sum = shots.reduce((acc, shot) => acc + shot.durationSeconds, 0);
  shots[shots.length - 1].durationSeconds = Math.max(1, shots[shots.length - 1].durationSeconds + totalDuration - sum);
  for (const shot of shots) shot.duration = `${shot.durationSeconds}秒`;
}

function createMockProject({ totalDuration = 30, pacing = "标准", aspectRatio = "9:16", imageError = DEFAULT_MOCK_ERROR } = {}) {
  const beats = ["潜入地下密室", "发现神秘补剂货架", "察觉门口异动", "打手涌入", "拔刀格挡爆出火花", "夺取样品准备突围"];
  const durations = distributeDurations(Number.parseInt(totalDuration, 10) || 30, beats.length);
  return {
    projectTitle: "地下密室夺取样品",
    totalDurationSeconds: Number.parseInt(totalDuration, 10) || 30,
    pacing,
    aspectRatio,
    autoShotCountReason: "模拟数据按照短视频动作节奏拆成 6 个关键剧情节点。",
    referenceAnalysis: {
      styleReferenceAnalysis: { visualStyle: "待配置火山方舟后由豆包分析参考图。" },
      characterReferenceAnalysis: { visibleCharacterDescription: "待配置火山方舟后根据主角参考图锁定。" },
      sceneReferenceAnalysis: { spaceStructure: "地下密室、狭长通道、补剂货架。" }
    },
    storyAnalysis: { beginning: "主角潜入地下密室。", mainAction: "夺取神秘样品。", conflict: "守卫闯入。", climax: "拔刀格挡。", endingOrHook: "带着样品突围。" },
    shots: beats.map((beat, index) => ({
      shotNumber: index + 1,
      title: beat,
      storyBeat: beat,
      durationSeconds: durations[index],
      duration: `${durations[index]}秒`,
      visualDescription: `主角推进到“${beat}”这一剧情节点。`,
      characterAction: `主角围绕“${beat}”完成当前镜头内的具体动作。`,
      cameraMovement: "电影感跟拍，主体清晰，保留空间纵深。",
      dialogueOrNarration: "",
      transition: index === 0 ? "从黑场淡入" : "动作接动作剪切",
      imagePrompt: buildFallbackImagePrompt(index + 1, aspectRatio, beat),
      videoPrompt: buildFallbackVideoPrompt(index + 1, durations[index], beat),
      negativePrompt: "不要改变主角长相、发型、服装、体态；不要改变场景结构；不要偏离参考图风格。",
      imageUrl: "",
      imageError,
      provider: "ark"
    }))
  };
}

function distributeDurations(totalDuration, count) {
  const base = Math.floor(totalDuration / count);
  const durations = Array.from({ length: count }, () => Math.max(1, base));
  let rest = totalDuration - durations.reduce((sum, item) => sum + item, 0);
  let index = 0;
  while (rest !== 0) {
    const delta = rest > 0 ? 1 : -1;
    if (durations[index] + delta >= 1) { durations[index] += delta; rest -= delta; }
    index = (index + 1) % count;
  }
  return durations;
}

function buildFallbackImagePrompt(shotNumber, aspectRatio, beat) {
  return `【画幅比例】${aspectRatio}\n【当前剧情节点】${beat}\n【首帧定格画面】第一帧定格在“${beat}”刚开始发生的瞬间，主角处在当前剧情核心位置，身体姿态、视线方向和手部动作都必须清楚。\n【参考图继承要求】严格继承视频风格参考图、主角参考图和场景参考图。\n【主体】主角是唯一核心主体，外貌、发型、服装、体态、气质必须与主角参考图一致。\n【主体动作】只表现当前分镜第一帧的明确姿态，不提前表现后续剧情。\n【场景】保持参考场景结构，关键道具和空间关系清楚可见。\n【构图】前景、中景、后景层次清晰，主体位于视觉焦点。\n【镜头】真实电影镜头语言，浅景深，主体清晰。\n【光线】写实光影，主光来源、明暗落点和反射关系明确。\n【色彩】延续参考图主色和对比关系。\n【风格】高质感电影画面。\n【画面细节】道具、服装、材质、表情和手部姿态清晰。\n【一致性要求】不要改变主角和场景结构，不要表现后续分镜动作。\n【负面提示词】畸形、错脸、错发型、错服装、低清晰度、多个主体动作、重复画面、手部错误、脸部崩坏。`;
}

function buildFallbackVideoPrompt(shotNumber, durationSeconds, beat) {
  return `【参考图说明】以当前分镜生成的首帧参考图作为视频起始帧，严格参考上传的视频风格图、主角图和场景图。\n【当前剧情节点】${beat}\n【主体动作】主角只完成“${beat}”这一镜内的具体动作。\n【动作过程】从首帧开始，角色先做出明确起始反应，再完成一个连续动作变化，最后停在能衔接下一镜的位置。\n【镜头运动】镜头自然跟随主体动作，保持电影感和空间纵深。\n【场景变化】场景结构保持一致，只出现当前分镜需要的局部变化。\n【光影氛围】延续首帧中的明暗方向、反射关系和环境色。\n【风格质感】保持参考图的画面风格、色彩、镜头质感。\n【时长与节奏】${durationSeconds} 秒，只完成当前动作。\n【结束画面】停在当前动作完成后的瞬间，为下一镜保留方向。\n【与前后镜头衔接】动作接动作剪切。\n【一致性要求】保持主角和场景一致。\n【避免事项】不要提前演出后续剧情，不要改变主角长相、服装、体态或场景结构。`;
}

function text(value) { return typeof value === "string" ? value.trim() : ""; }

module.exports = { generateStoryboardWithArkDoubao, normalizeStoryboardResult, createMockProject };
