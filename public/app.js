const form = document.querySelector("#storyboardForm");
const cardsEl = document.querySelector("#storyboardCards");
const projectSummaryEl = document.querySelector("#projectSummary");
const toastEl = document.querySelector("#toast");
const statusPill = document.querySelector("#statusPill");
const resultHint = document.querySelector("#resultHint");
const generateBtn = document.querySelector("#generateBtn");
const shotCountModeEl = document.querySelector("#shotCountMode");
const manualShotField = document.querySelector("#manualShotField");

const uploadState = { styleReferenceImages: [], characterReferenceImages: [], sceneReferenceImages: [] };
const uploadLimits = { styleReferenceImages: 5, characterReferenceImages: 3, sceneReferenceImages: 5 };
let project = null;

["styleReferenceImages", "characterReferenceImages", "sceneReferenceImages"].forEach(setupUpload);
shotCountModeEl.addEventListener("change", () => manualShotField.hidden = shotCountModeEl.value !== "手动指定");
manualShotField.hidden = true;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = getFormPayload();
  if (!payload) return;
  setBusy(generateBtn, true, "生成中...");
  statusPill.textContent = "正在生成";
  cardsEl.innerHTML = "";
  projectSummaryEl.innerHTML = "";
  resultHint.textContent = "正在上传参考图并调用模型，请稍等。";
  try {
    const data = await postForm("/api/generate-storyboard", payload);
    project = data.project;
    renderProject();
    statusPill.textContent = data.source === "mock" ? "模拟数据" : "方舟生成";
    showToast(data.message || "分镜生成完成。");
  } catch (error) {
    statusPill.textContent = "生成失败";
    showToast(error.message || "生成分镜失败。");
  } finally {
    setBusy(generateBtn, false, "分析参考图并生成分镜");
  }
});

document.querySelector("#copyAllImageBtn").onclick = () => copyAll("imagePrompt", "已复制全部图片提示词。");
document.querySelector("#copyAllVideoBtn").onclick = () => copyAll("videoPrompt", "已复制全部视频提示词。");
document.querySelector("#exportMarkdownBtn").onclick = () => exportFile("/api/export-markdown");
document.querySelector("#exportJsonBtn").onclick = () => exportFile("/api/export-json");
document.querySelector("#clearAllBtn").onclick = clearAll;

function setupUpload(fieldName) {
  const input = document.querySelector(`#${fieldName}`);
  input.addEventListener("change", () => {
    const merged = uploadState[fieldName].concat(Array.from(input.files || []));
    if (merged.length > uploadLimits[fieldName]) {
      showToast(`最多只能上传 ${uploadLimits[fieldName]} 张图片。`);
      input.value = "";
      return;
    }
    uploadState[fieldName] = merged;
    input.value = "";
    renderThumbs(fieldName);
  });
}

function renderThumbs(fieldName) {
  const wrap = document.querySelector(`#${fieldName}Preview`);
  wrap.innerHTML = "";
  uploadState[fieldName].forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "thumb";
    item.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="参考图 ${index + 1}"><button type="button">×</button>`;
    item.querySelector("button").onclick = () => { uploadState[fieldName].splice(index, 1); renderThumbs(fieldName); };
    wrap.appendChild(item);
  });
}

function getFormPayload() {
  const storyText = document.querySelector("#storyText").value.trim();
  if (!storyText) return showToast("请先填写故事梗概。"), null;
  const data = new FormData();
  ["extraNotes", "totalDuration", "pacing", "shotCountMode", "manualShotCount", "aspectRatio"].forEach((id) => data.append(id, document.querySelector(`#${id}`).value || ""));
  data.append("storyText", storyText);
  data.append("generateFirstFrames", document.querySelector("#generateFirstFrames").checked ? "true" : "false");
  Object.entries(uploadState).forEach(([name, files]) => files.forEach((file) => data.append(name, file)));
  return data;
}

async function postForm(url, body) {
  const res = await fetch(url, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "请求失败。");
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "请求失败。");
  return data;
}

function renderProject() {
  if (!project?.shots?.length) return;
  const total = project.shots.reduce((sum, shot) => sum + Number(shot.durationSeconds || 0), 0);
  resultHint.textContent = `已生成 ${project.shots.length} 个分镜，总时长 ${total} 秒。`;
  projectSummaryEl.innerHTML = `<div class="panel summary-panel"><div class="summary-head"><div><p class="eyebrow">Project Analysis</p><h2>${escapeHtml(project.projectTitle || "短视频分镜方案")}</h2></div><div class="summary-stats"><span>${project.totalDurationSeconds} 秒</span><span>${escapeHtml(project.pacing)}</span><span>${escapeHtml(project.aspectRatio)}</span><span>${project.shots.length} 镜</span></div></div><div class="reason-box"><strong>自动分镜原因</strong><p>${escapeHtml(project.autoShotCountReason || "")}</p></div></div>`;
  cardsEl.innerHTML = "";
  project.shots.forEach(renderShotCard);
}

function renderShotCard(shot, index) {
  const card = document.createElement("article");
  card.className = "shot-card";
  card.innerHTML = `<div class="shot-main"><div class="shot-title"><h3>分镜 ${shot.shotNumber} · ${escapeHtml(shot.title)}</h3><span class="duration">${escapeHtml(shot.duration || `${shot.durationSeconds}秒`)}</span></div><div class="beat-box"><strong>当前剧情节点</strong><p>${escapeHtml(shot.storyBeat)}</p></div><div class="meta-grid">${infoBox("分镜脚本", shot.visualDescription)}${infoBox("主体动作", shot.characterAction)}${infoBox("镜头运动", shot.cameraMovement)}${infoBox("转场衔接", shot.transition)}${infoBox("分镜时长", `${shot.durationSeconds} 秒`)}</div><div class="prompt-stack"><div class="prompt-block"><strong>图片提示词</strong><pre>${escapeHtml(shot.imagePrompt)}</pre></div><div class="prompt-block"><strong>Seedance 视频提示词</strong><pre>${escapeHtml(shot.videoPrompt)}</pre></div></div></div><aside class="preview"><div class="image-box" id="imageBox-${index}">${renderImageContent(shot)}</div><div class="provider">${shot.provider === "ark" ? "首帧图来源：火山方舟 Seedream" : "首帧图未生成"}</div><label class="revision-box"><span>首帧修改意见</span><textarea data-role="revision-notes" rows="4" placeholder="例如：人物脸部更像参考图；手不要变形；镜头拉远一点；保留场景结构但光线更暗。">${escapeHtml(shot.revisionNotes || "")}</textarea></label><div class="card-actions"><button data-action="copy-image">复制图片提示词</button><button data-action="copy-video">复制视频提示词</button><button data-action="copy-shot">复制当前分镜全部内容</button><button class="primary" data-action="regenerate-frame">按修改意见重生成首帧</button><button data-action="download-image">下载首帧图</button></div></aside>`;
  card.addEventListener("click", (event) => handleCardAction(event, index));
  cardsEl.appendChild(card);
}

function renderImageContent(shot) {
  if (shot.imageUrl) return `<img src="${escapeHtml(shot.imageUrl)}" alt="分镜 ${shot.shotNumber} 首帧图">`;
  if (shot.imageError) return `<div class="image-error">${escapeHtml(shot.imageError)}</div>`;
  return `<div class="image-empty">未生成首帧图</div>`;
}

async function handleCardAction(event, index) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const shot = project.shots[index];
  if (button.dataset.action === "copy-image") return copyText(shot.imagePrompt, "已复制图片提示词。");
  if (button.dataset.action === "copy-video") return copyText(shot.videoPrompt, "已复制视频提示词。");
  if (button.dataset.action === "copy-shot") return copyText(JSON.stringify(shot, null, 2), "已复制当前分镜全部内容。");
  if (button.dataset.action === "download-image") return downloadImage(shot);
  const revisionNotes = button.closest(".shot-card").querySelector('[data-role="revision-notes"]').value.trim();
  shot.revisionNotes = revisionNotes;
  setBusy(button, true, "生成中...");
  try {
    const result = await postJson("/api/regenerate-first-frame", { shotNumber: shot.shotNumber, imagePrompt: shot.imagePrompt, revisionNotes, aspectRatio: project.aspectRatio });
    shot.provider = result.provider || "ark";
    shot.imageUrl = result.success ? result.imageUrl : "";
    shot.imageError = result.success ? "" : (result.message || "首帧图生成失败。");
    document.querySelector(`#imageBox-${index}`).innerHTML = renderImageContent(shot);
    showToast(result.success ? "首帧图已重新生成。" : shot.imageError);
  } finally {
    setBusy(button, false, "按修改意见重生成首帧");
  }
}

function infoBox(label, value) { return `<div class="info-box"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value || "")}</p></div>`; }
function copyAll(field, msg) { if (!project?.shots?.length) return showToast("暂无可复制内容。"); copyText(project.shots.map((s) => `分镜 ${s.shotNumber}：\n${s[field] || ""}`).join("\n\n"), msg); }
async function copyText(value, msg) { await navigator.clipboard.writeText(value || ""); showToast(msg); }
async function exportFile(url) { if (!project) return showToast("请先生成分镜。"); const data = await postJson(url, { project }); showToast(data.message || "导出成功。"); if (data.fileUrl) window.open(data.fileUrl, "_blank"); }
function downloadImage(shot) { if (!shot.imageUrl) return showToast("当前分镜没有首帧图。"); const a = document.createElement("a"); a.href = shot.imageUrl; a.download = `shot-${shot.shotNumber}.png`; a.click(); }
function clearAll() { form.reset(); Object.keys(uploadState).forEach((k) => { uploadState[k] = []; renderThumbs(k); }); project = null; cardsEl.innerHTML = ""; projectSummaryEl.innerHTML = ""; statusPill.textContent = "未生成"; }
function setBusy(button, busy, text) { button.disabled = busy; button.textContent = text; }
function showToast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toastEl.classList.remove("show"), 3000); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
