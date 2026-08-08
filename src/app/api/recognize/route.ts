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
            content: `你是一个专业的简谱识别专家。请仔细分析用户上传的简谱图片，识别所有音乐元素并输出结构化 JSON。

## 识别要求
1. 音符：1-7（do re mi fa sol la si），null 表示休止符
2. 高低八度：数字上方的点表示高八度，下方的点表示低八度
3. 时值：
   - 无下划线：四分音符 (duration=4)
   - 一条下划线：八分音符 (duration=8)
   - 两条下划线：十六分音符 (duration=16)
   - 三条下划线：三十二分音符 (duration=32)
   - 数字后跟横线"-"：增时线，每条增加一个四分音符时值
4. 附点：数字后的"."表示附点 (dots=1)
5. 小节线：用"|"分隔
6. 拍号：如 4/4、2/4、3/4、6/8
7. 调号：如 1=C、1=G、1=F
8. 速度标记：如 J=120
9. 歌词、连音线、反复记号等

## 输出 JSON 格式
{
  "title": "曲目标题",
  "key_signature": "1=C",
  "time_signature": "4/4",
  "tempo": "J=120",
  "composer": "作曲者",
  "lyricist": "作词者",
  "measures": [
    {
      "notes": [
        {
          "pitch": 1,
          "octave": 0,
          "duration": 4,
          "dots": 0,
          "accidental": null,
          "tie_start": false,
          "tie_end": false,
          "slur_start": false,
          "slur_end": false,
          "lyrics": null
        }
      ]
    }
  ]
}

## 字段说明
- pitch: 1-7 数字（do re mi fa sol la si），null 表示休止符
- octave: 0=中音，1=高八度，2=高两个八度，-1=低八度，-2=低两个八度
- duration: 1=全音符，2=二分音符，4=四分音符，8=八分音符，16=十六分音符，32=三十二分音符
- dots: 附点数量（0=无附点，1=单附点，2=双附点）
- accidental: null 或 "sharp"(升号) 或 "flat"(降号)
- tie_start/tie_end: 连音线开始/结束
- slur_start/slur_end: 圆滑线开始/结束
- lyrics: 该音符对应的歌词文本，null 表示无歌词

## 重要
- 只输出 JSON，不要其他内容
- 用 \`\`\`json 包裹
- 仔细识别每个音符的时值（下划线数量）和八度（点的位置）
- 休止符的 pitch 设为 null`,
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
      console.error("智谱 API 错误:", errorText);
      return NextResponse.json(
        { success: false, error: `智谱 API 错误：${response.status}` },
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
