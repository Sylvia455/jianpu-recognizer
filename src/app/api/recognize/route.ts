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

## 重要要求
- **必须识别图片中的所有行**，从上到下逐行分析，不要遗漏任何一行
- **按从左到右、从上到下的顺序识别音符**，保持原始顺序
- 逐音符识别，仔细分析每个音符的时值和八度
- 如果有歌词，也要识别出来

## 识别要求（非常重要，请仔细识别）

### 音符识别
1. **音高**：数字 1-7 对应 do re mi fa sol la si
2. **休止符**：数字 0 表示休止符，pitch 设为 null
3. **八度**：
   - 数字上方有一个点：octave=1（高八度）
   - 数字上方有两个点：octave=2（高两个八度）
   - 数字下方有一个点：octave=-1（低八度）
   - 数字下方有两个点：octave=-2（低两个八度）
   - 无点：octave=0（中音区）

### 时值识别（最关键！）
- **四分音符**：数字无下划线，duration=4
- **八分音符**：数字下方有一条下划线，duration=8
- **十六分音符**：数字下方有两条下划线，duration=16
- **三十二分音符**：数字下方有三条下划线，duration=32
- **二分音符**：数字右侧有一条短横线"-"，duration=2
- **全音符**：数字右侧有三条短横线"---"，duration=1
- **附点音符**：数字右侧有小圆点"."，dots=1（时值增加一半）

### 其他标记
- **小节线**：竖线"|"分隔小节
- **拍号**：如 4/4、2/4、3/4、6/8（位于谱表开头）
- **调号**：如 1=C、1=G、1=F（位于谱表开头）
- **速度**：如 J=120 或 ♩=120
- **连音线**：连接两个相同音高的弧线，tie_start/tie_end=true
- **圆滑线**：连接不同音高的弧线，slur_start/slur_end=true
- **歌词**：音符下方的文字

## 输出 JSON 格式示例

例如简谱：| 1  5  3  5 | 6.  5  4  3 | 2  3  2  1 | 1 - - - |
对应 JSON：
{
  "title": "",
  "key_signature": "1=C",
  "time_signature": "4/4",
  "tempo": "",
  "composer": "",
  "lyricist": "",
  "measures": [
    {
      "notes": [
        {"pitch": 1, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 5, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 3, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 5, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null}
      ]
    },
    {
      "notes": [
        {"pitch": 6, "octave": 0, "duration": 4, "dots": 1, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 5, "octave": 0, "duration": 8, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 4, "octave": 0, "duration": 8, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 3, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null}
      ]
    },
    {
      "notes": [
        {"pitch": 2, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 3, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 2, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null},
        {"pitch": 1, "octave": 0, "duration": 4, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null}
      ]
    },
    {
      "notes": [
        {"pitch": 1, "octave": 0, "duration": 1, "dots": 0, "accidental": null, "tie_start": false, "tie_end": false, "slur_start": false, "slur_end": false, "lyrics": null}
      ]
    }
  ]
}

注意：
- 6. 表示附点四分音符（duration=4, dots=1）
- 5 和 4 下方有下划线，是八分音符（duration=8）
- 1 - - - 表示全音符（duration=1）

## 字段详细说明
- **pitch**: 1-7 数字（do re mi fa sol la si），休止符设为 null
- **octave**: 0=中音，1=高八度（数字上方一个点），2=高两个八度，-1=低八度（数字下方一个点），-2=低两个八度
- **duration**: 音符时值 - 1=全音符，2=二分音符，4=四分音符，8=八分音符，16=十六分音符，32=三十二分音符
- **dots**: 附点数量 - 0=无附点，1=单附点（时值×1.5），2=双附点（时值×1.75）
- **accidental**: 变音记号 - null=无，"sharp"=升号#，"flat"=降号b
- **tie_start/tie_end**: 连音线（连接相同音高）的开始/结束
- **slur_start/slur_end**: 圆滑线（连接不同音高）的开始/结束
- **lyrics**: 该音符下方的歌词文字，无歌词则为 null

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
