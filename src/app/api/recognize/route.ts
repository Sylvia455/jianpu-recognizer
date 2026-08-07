import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";
import {
  RecognitionResult,
  convertToMusicXml,
  convertToJianpu,
  convertToGP,
} from "@/lib/format-converters";

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";
const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

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

    if (!ZHIPU_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "智谱 API Key 未配置，请在 Vercel 环境变量中添加 ZHIPU_API_KEY",
        },
        { status: 500 }
      );
    }

    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    const response = await fetch(ZHIPU_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        model: "glm-4v-flash",
        stream: false,
        messages: [
          {
            role: "system",
            content: `你是一个专业的简谱识别专家。请仔细分析用户上传的简谱图片，识别所有音乐元素并输出结构化JSON。

## 识别要求
1. 音符：1-7（do re mi fa sol la si），0 表示休止符
2. 高低八度：数字上方的点表示高八度，下方的点表示低八度
3. 时值：
   - 无下划线：四分音符
   - 一条下划线：八分音符
   - 两条下划线：十六分音符
   - 三条下划线：三十二分音符
   - 数字后跟横线"-"：增时线，每条增加一个四分音符时值
4. 附点：数字后的"."表示附点
5. 小节线：用"|"分隔
6. 拍号：如 4/4、2/4、3/4、6/8
7. 调号：如 1=C、1=G、1=F
8. 速度标记：如 ♩=120
9. 歌词、连音线、反复记号等

## 输出JSON格式
{
  "title": "曲目标题",
  "key_signature": "1=C",
  "time_signature": "4/4",
  "tempo": "♩=120",
  "composer": "作曲者",
  "lyricist": "作词者",
  "lyrics": "歌词文本",
  "measures": [
    {
      "number": 1,
      "notes": [
        {
          "pitch": "1",
          "octave": 0,
          "duration": "quarter",
          "dotted": false,
          "lyric": ""
        }
      ]
    }
  ]
}

## 字段说明
- pitch: "1"-"7" 或 "0"（休止符）
- octave: 0=中音，1=高八度，2=高两个八度，-1=低八度，-2=低两个八度
- duration: "whole"(全音符), "half"(二分), "quarter"(四分), "eighth"(八分), "sixteenth"(十六分), "thirty-second"(三十二分)
- dotted: 是否有附点
- lyric: 该音符对应的歌词

## 重要
- 只输出JSON，不要其他内容
- 用 \`\`\`json 包裹
- 仔细识别每个音符的时值（下划线数量）和八度（点的位置）`,
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
                text: "请识别这张简谱图片，输出结构化JSON。",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("智谱 API 错误:", errorText);
      return NextResponse.json(
        { success: false, error: `智谱 API 错误: ${response.status}` },
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
        lyrics: "",
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
