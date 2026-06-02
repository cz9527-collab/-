require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");

const { generateStoryboardWithArkDoubao, normalizeStoryboardResult, createMockProject } = require("./server/services/textService");
const { generateFirstFrameImage } = require("./server/services/imageService");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const OUTPUT_DIR = path.join(ROOT_DIR, "outputs");
const IMAGE_DIR = path.join(OUTPUT_DIR, "images");
const EXPORT_DIR = path.join(OUTPUT_DIR, "exports");

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(IMAGE_DIR);
fs.ensureDirSync(EXPORT_DIR);

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/outputs", express.static(OUTPUT_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("只能上传图片文件。"));
    }
    cb(null, true);
  }
});

const referenceUpload = upload.fields([
  { name: "styleReferenceImages", maxCount: 5 },
  { name: "characterReferenceImages", maxCount: 3 },
  { name: "sceneReferenceImages", maxCount: 5 }
]);

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.post("/api/generate-storyboard", (req, res) => {
  referenceUpload(req, res, async (uploadError) => {
    try {
      if (uploadError) throw uploadError;

      validateUploadCounts(req.files || {});
      const input = normalizeInput(req.body || {});
      const referenceImageGroups = await collectReferenceImageGroups(req.files || {});

      let source = hasArkTextConfig() ? "ark" : "mock";
      let message = source === "ark" ? "分镜生成完成。" : "未配置火山方舟 API Key 或豆包文本模型 ID，已返回模拟数据。";
      let project;

      try {
        project = await generateStoryboardWithArkDoubao({
          storyText: input.storyText,
          extraNotes: input.extraNotes,
          totalDuration: input.totalDuration,
          pacing: input.pacing,
          shotCountMode: input.shotCountMode,
          manualShotCount: input.manualShotCount,
          aspectRatio: input.aspectRatio,
          referenceImageGroups
        });
      } catch (arkError) {
        console.error("Ark text generation failed:", arkError);
        source = "mock";
        message = `真实火山方舟文本生成失败，已返回模拟分镜：${arkError.message || "未知错误"}`;
        project = createMockProject({
          totalDuration: input.totalDuration,
          pacing: input.pacing,
          aspectRatio: input.aspectRatio,
          imageError: arkError.message || "真实火山方舟文本生成失败，无法继续生成真实首帧图。"
        });
      }

      const normalized = normalizeStoryboardResult(project, input.totalDuration, input.aspectRatio, input.pacing);

      if (input.generateFirstFrames && source === "ark") {
        for (const shot of normalized.shots) {
          const imageResult = await generateFirstFrameImage({
            imagePrompt: shot.imagePrompt,
            aspectRatio: normalized.aspectRatio,
            shotNumber: shot.shotNumber,
            referenceImages: [
              ...referenceImageGroups.styleReferenceImages,
              ...referenceImageGroups.characterReferenceImages,
              ...referenceImageGroups.sceneReferenceImages
            ]
          });

          shot.provider = "ark";
          if (imageResult.success) {
            shot.imageUrl = imageResult.imageUrl;
            shot.imageError = "";
          } else {
            shot.imageUrl = "";
            shot.imageError = imageResult.message || "首帧图生成失败。";
          }
        }
      }

      res.json({
        source,
        message,
        project: normalized
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "生成分镜失败，请稍后重试。" });
    }
  });
});

app.post("/api/regenerate-first-frame", async (req, res) => {
  try {
    const shotNumber = toInt(req.body?.shotNumber, 1, 999, 1);
    const imagePrompt = text(req.body?.imagePrompt);
    const revisionNotes = text(req.body?.revisionNotes);
    const aspectRatio = normalizeAspectRatio(req.body?.aspectRatio);

    if (!imagePrompt) {
      return res.status(400).json({ success: false, message: "缺少图片提示词。", provider: "ark" });
    }

    const finalImagePrompt = buildRevisedImagePrompt(imagePrompt, revisionNotes);
    const result = await generateFirstFrameImage({ imagePrompt: finalImagePrompt, aspectRatio, shotNumber });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || "重新生成首帧图失败。", provider: "ark" });
  }
});

app.post("/api/export-markdown", (req, res) => {
  try {
    const project = normalizeStoryboardResult(req.body?.project || req.body, Number(req.body?.totalDurationSeconds) || 30);
    const markdown = buildMarkdown(project);
    const fileName = `storyboard-${Date.now()}.md`;
    fs.writeFileSync(path.join(EXPORT_DIR, fileName), markdown, "utf8");
    res.json({ message: "Markdown 导出成功。", fileUrl: `/outputs/exports/${fileName}`, fileName });
  } catch (error) {
    res.status(400).json({ error: error.message || "导出 Markdown 失败。" });
  }
});

app.post("/api/export-json", (req, res) => {
  try {
    const project = normalizeStoryboardResult(req.body?.project || req.body, Number(req.body?.totalDurationSeconds) || 30);
    const fileName = `storyboard-${Date.now()}.json`;
    fs.writeFileSync(path.join(EXPORT_DIR, fileName), JSON.stringify(project, null, 2), "utf8");
    res.json({ message: "JSON 导出成功。", fileUrl: `/outputs/exports/${fileName}`, fileName });
  } catch (error) {
    res.status(400).json({ error: error.message || "导出 JSON 失败。" });
  }
});

app.use((error, req, res, next) => {
  res.status(400).json({ error: error.message || "请求处理失败。" });
});

app.use((req, res) => {
  res.status(404).json({ error: "没有找到对应的页面或接口。" });
});

app.listen(PORT, () => {
  console.log(`Storyboard Seedance Node 已启动：http://localhost:${PORT}`);
});

function hasArkTextConfig() {
  return Boolean(process.env.ARK_API_KEY && process.env.ARK_TEXT_MODEL);
}

function validateUploadCounts(files) {
  if ((files.styleReferenceImages || []).length > 5) throw new Error("视频风格参考图最多上传 5 张。");
  if ((files.characterReferenceImages || []).length > 3) throw new Error("主角参考图最多上传 3 张。");
  if ((files.sceneReferenceImages || []).length > 5) throw new Error("场景参考图最多上传 5 张。");
}

async function collectReferenceImageGroups(files) {
  return {
    styleReferenceImages: await filesToReferenceItems(files.styleReferenceImages || []),
    characterReferenceImages: await filesToReferenceItems(files.characterReferenceImages || []),
    sceneReferenceImages: await filesToReferenceItems(files.sceneReferenceImages || [])
  };
}

async function filesToReferenceItems(files) {
  return Promise.all(files.map(async (file) => ({
    originalName: file.originalname,
    path: file.path,
    mimeType: file.mimetype,
    dataUrl: `data:${file.mimetype};base64,${(await fs.readFile(file.path)).toString("base64")}`
  })));
}

function normalizeInput(body) {
  const storyText = text(body.storyText);
  if (!storyText) throw new Error("请先填写故事梗概。");

  return {
    storyText,
    extraNotes: text(body.extraNotes),
    totalDuration: toInt(body.totalDuration, 1, 600, 30),
    pacing: ["快节奏", "标准", "慢节奏"].includes(text(body.pacing)) ? text(body.pacing) : "标准",
    shotCountMode: ["自动分析", "手动指定"].includes(text(body.shotCountMode)) ? text(body.shotCountMode) : "自动分析",
    manualShotCount: toInt(body.manualShotCount, 1, 60, 6),
    aspectRatio: normalizeAspectRatio(body.aspectRatio),
    generateFirstFrames: ["true", "1", "on", true].includes(body.generateFirstFrames)
  };
}

function normalizeAspectRatio(value) {
  const ratio = text(value);
  return ["9:16", "16:9", "1:1", "4:3", "3:4"].includes(ratio) ? ratio : "9:16";
}

function toInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildRevisedImagePrompt(imagePrompt, revisionNotes) {
  if (!revisionNotes) return imagePrompt;
  return [
    imagePrompt,
    "",
    "【本次重生成修改意见】",
    revisionNotes,
    "",
    "【修改执行要求】在严格保留原分镜剧情节点、主角身份、参考图风格、场景结构和画幅比例的前提下，优先执行本次修改意见；只调整用户指出的问题，不要改写成新的分镜，不要提前表现后续剧情。"
  ].join("\n");
}

function buildMarkdown(project) {
  const lines = [
    `# ${project.projectTitle || "短视频分镜方案"}`,
    "",
    `- 总时长：${project.totalDurationSeconds} 秒`,
    `- 节奏：${project.pacing || ""}`,
    `- 画幅：${project.aspectRatio || ""}`,
    "",
    "## 自动分镜原因",
    project.autoShotCountReason || "",
    "",
    "## 参考图分析",
    objectToMarkdown(project.referenceAnalysis),
    "",
    "## 故事分析",
    objectToMarkdown(project.storyAnalysis),
    "",
    "## 分镜"
  ];

  for (const shot of project.shots || []) {
    lines.push(
      "",
      `### 分镜 ${shot.shotNumber}：${shot.title || ""}`,
      "",
      `- 时长：${shot.durationSeconds} 秒`,
      `- 剧情节点：${shot.storyBeat || ""}`,
      `- 画面描述：${shot.visualDescription || ""}`,
      `- 主体动作：${shot.characterAction || ""}`,
      `- 镜头运动：${shot.cameraMovement || ""}`,
      `- 台词/旁白：${shot.dialogueOrNarration || ""}`,
      `- 转场：${shot.transition || ""}`,
      `- 首帧图：${shot.imageUrl || shot.imageError || "未生成"}`,
      "",
      "#### 图片提示词",
      "",
      shot.imagePrompt || "",
      "",
      "#### Seedance 视频提示词",
      "",
      shot.videoPrompt || "",
      ""
    );
  }

  return lines.join("\n");
}

function objectToMarkdown(value, level = 0) {
  if (!value || typeof value !== "object") return String(value || "");
  return Object.entries(value).map(([key, item]) => {
    if (item && typeof item === "object") {
      return `${"  ".repeat(level)}- ${key}\n${objectToMarkdown(item, level + 1)}`;
    }
    return `${"  ".repeat(level)}- ${key}：${item || ""}`;
  }).join("\n");
}
