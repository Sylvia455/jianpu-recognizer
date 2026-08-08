import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";
import {
  RecognitionResult,
  convertToMusicXml,
  convertToJianpu,
  convertToGP,
} from "@/lib/format-converters";

const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/**
 * 从 LLM 响应中提取 JSON
 */
function extractJSON(text: string): string {
  // 尝试提取 ```json ... ``` 块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // 尝试找到 { 开头到 } 结尾
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
  }

  return text;
}

/**
 * 修复不完整的 JSON
 */
function repairJSON(jsonStr: string): string {
  try {
    return jsonrepair(jsonStr);
  } catch {
    // 如果 jsonrepair 失败，尝试手动修复
    let fixed = jsonStr;

    // 移除尾逗号
    fixed = fixed.replace(/,\s*([}\]])/g, "$1");

    // 确保括号闭合
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixed += "}";
    }

    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixed += "]";
    }

    return fixed;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, error: "请提供图片" },
        { status: 400 }
      );
    }

    if (!QWEN_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "通义千问 API Key 未配置，请在 Vercel 环境变量中添加 QWEN_API_KEY",
        },
        { status: 500 }
      );
    }

    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    const response = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: "qwen-vl-max",
        stream: false,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
              {
                type: "text",
                text: "请识别这张简谱图片，输出结构化 JSON。",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("通义千问 API 错误:", errorText);
      return NextResponse.json(
        { success: false, error: `通义千问 API 错误：${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    if (!content) {
      return NextResponse.json(
        { success: false, error: "模型未返回内容" },
        { status: 500 }
      );
    }

    // 提取并修复 JSON
    const jsonStr = extractJSON(content);
    const repairedJson = repairJSON(jsonStr);

    let result: RecognitionResult;
    try {
      result = JSON.parse(repairedJson);
    } catch {
      console.error("JSON 解析失败，原始内容:", content);
      return NextResponse.json(
        {
          success: false,
          error: "JSON 解析失败",
          rawContent: content.substring(0, 500),
        },
        { status: 500 }
      );
    }

    // 确保 measures 存在
    if (!result.measures) {
      result = {
        title: "",
        key_signature: "1=C",
        time_signature: "4/4",
        tempo: "",
        composer: "",
        lyricist: "",
        measures: [],
      };
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("识别错误:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 }
    );
  }
}
