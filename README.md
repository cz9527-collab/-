# 火山方舟分镜与首帧参考图生成器

这个项目基于 Node.js + Express，不使用 OpenAI 或 DeepSeek 生成内容。

当前项目使用：

- 火山方舟豆包模型生成故事分析、参考图分析、自动分镜、图片提示词和 Seedance 2.0 视频提示词。
- 火山方舟 Seedream 模型生成每个分镜的首帧参考图。
- 前端通过 `multipart/form-data` 上传视频风格参考图、主角参考图和场景参考图。

## 环境变量

复制 `.env.example` 为 `.env`，并填写你的火山方舟 API Key。

```env
ARK_API_KEY=你的火山方舟APIKey
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_TEXT_MODEL=doubao-seed-2-0-code-preview-260215
ARK_IMAGE_MODEL=doubao-seedream-5-0-260128
TEXT_PROVIDER=ark
IMAGE_PROVIDER=ark
ARK_TEXT_TIMEOUT_MS=20000
ARK_IMAGE_TIMEOUT_MS=180000
PORT=3000
```

不要把真实 API Key 写进代码，只从 `.env` 读取。

## 启动

```bash
npm install
npm start
```

浏览器打开：

```text
http://localhost:3000
```

## 接口

- `GET /`：返回首页。
- `POST /api/generate-storyboard`：接收故事、参数和三类参考图，生成完整分镜 JSON。
- `POST /api/regenerate-first-frame`：根据某个分镜的 `imagePrompt` 和修改意见重新生成首帧图。
- `POST /api/export-markdown`：导出 Markdown。
- `POST /api/export-json`：导出 JSON。
- `/outputs/images/xxx.png`：访问生成的首帧图片。

如果没有配置 `ARK_API_KEY` 或 `ARK_TEXT_MODEL`，后端会返回模拟分镜数据，不调用豆包或 Seedream，项目仍可正常运行。
