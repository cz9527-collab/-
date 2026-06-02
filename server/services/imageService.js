const path = require("path");
const fs = require("fs-extra");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const IMAGE_DIR = path.join(ROOT_DIR, "outputs", "images");

async function generateFirstFrameImage({ imagePrompt, aspectRatio, shotNumber, referenceImages = [] }) {
  if (!process.env.ARK_API_KEY || !process.env.ARK_IMAGE_MODEL) {
    return {
      success: false,
      imageUrl: "",
      provider: "ark",
      message: "未配置火山方舟 API Key 或 Seedream 图像模型 ID，无法生成首帧图。"
    };
  }

  try {
    fs.ensureDirSync(IMAGE_DIR);
    const baseUrl = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
    const url = `${baseUrl}/images/generations`;
    const size = mapSize(aspectRatio);

    let response = await callArkImage(url, {
      model: process.env.ARK_IMAGE_MODEL,
      prompt: imagePrompt,
      size,
      response_format: "b64_json",
      watermark: false
    });

    let body = await readJsonOrText(response);

    if (!response.ok || !extractB64(body)) {
      response = await callArkImage(url, {
        model: process.env.ARK_IMAGE_MODEL,
        prompt: imagePrompt,
        size,
        response_format: "url",
        watermark: false
      });
      body = await readJsonOrText(response);
    }

    if (!response.ok) {
      const message = extractErrorMessage(body) || "调用火山方舟 Seedream 生成首帧图失败。";
      console.error("Ark Seedream generation failed:", message);
      return {
        success: false,
        imageUrl: "",
        provider: "ark",
        message
      };
    }

    const fileName = `shot-${Number(shotNumber) || 1}-${Date.now()}.png`;
    const filePath = path.join(IMAGE_DIR, fileName);
    const b64 = extractB64(body);

    if (b64) {
      await fs.writeFile(filePath, Buffer.from(b64, "base64"));
    } else {
      const remoteUrl = extractUrl(body);
      if (!remoteUrl) throw new Error("Seedream 未返回图片数据。");
      const imageResponse = await fetch(remoteUrl);
      if (!imageResponse.ok) throw new Error("下载 Seedream 返回图片失败。");
      await fs.writeFile(filePath, Buffer.from(await imageResponse.arrayBuffer()));
    }

    return {
      success: true,
      imageUrl: `/outputs/images/${fileName}`,
      provider: "ark"
    };
  } catch (error) {
    console.error("Ark Seedream generation error:", error);
    return {
      success: false,
      imageUrl: "",
      provider: "ark",
      message: error.message || "首帧图生成失败。"
    };
  }
}

function callArkImage(url, payload) {
  const timeoutMs = Number(process.env.ARK_IMAGE_TIMEOUT_MS) || 180000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") {
      throw new Error(`调用火山方舟 Seedream 超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络、模型 ID 或稍后重试。`);
    }
    throw error;
  }).finally(() => clearTimeout(timer));
}

async function readJsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function mapSize(aspectRatio) {
  const sizes = {
    "9:16": "1440x2560",
    "16:9": "2560x1440",
    "1:1": "1920x1920",
    "4:3": "2304x1728",
    "3:4": "1728x2304"
  };
  return sizes[aspectRatio] || sizes["9:16"];
}

function extractB64(body) {
  return body?.data?.[0]?.b64_json || body?.data?.[0]?.b64 || body?.b64_json || "";
}

function extractUrl(body) {
  return body?.data?.[0]?.url || body?.url || "";
}

function extractErrorMessage(body) {
  if (typeof body === "string") return body;
  return body?.error?.message || body?.message || body?.error || "";
}

module.exports = {
  generateFirstFrameImage
};
