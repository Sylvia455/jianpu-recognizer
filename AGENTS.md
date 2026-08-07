# 简谱识别工具 - 项目规范

## 项目概览
AI 驱动的简谱图片识别 Web 工具。用户上传简谱图片，后端调用多模态大模型识别，输出结构化简谱数据，支持导出为 MusicXML、简谱文本、Guitar Pro 格式。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **AI**: coze-coding-dev-sdk (多模态 LLM, doubao-seed-2-0-pro-260215)

## 目录结构
```
src/
├── app/
│   ├── api/recognize/route.ts   # 简谱识别 API (POST, 接收 base64 图片)
│   ├── layout.tsx               # 根布局
│   ├── page.tsx                 # 主页面 (上传/预览/结果/导出)
│   └── globals.css              # 全局样式
├── components/ui/               # shadcn/ui 组件
└── lib/
    ├── format-converters.ts     # 格式转换 (MusicXML/Jianpu/GP)
    └── utils.ts                 # 工具函数
```

## 核心流程
1. 前端上传图片 → 转 base64
2. POST /api/recognize → 调用 LLM 多模态识别
3. LLM 返回结构化 JSON (RecognitionResult)
4. 前端展示结果 + 支持格式转换导出

## API 接口
- `POST /api/recognize` - 识别简谱图片
  - 请求: `{ imageBase64: string, mimeType: string }`
  - 响应: `{ success: true, data: RecognitionResult }`

## 开发命令
- `pnpm dev` - 启动开发服务器
- `pnpm build` - 构建生产版本
- `pnpm start` - 启动生产服务器
