import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";

const SYSTEM_PROMPT = `你是一位专业的简谱（Numbered Musical Notation / Jianpu）识别专家。请仔细分析上传的简谱图片，识别其中的所有音乐元素。

## 识别要求

### 音符识别
- 音符数字：1(do) 2(re) 3(mi) 4(fa) 5(sol) 6(la) 7(si)
- 休止符：0
- 高八度：音符上方的点 → octave: 1
- 低八度：音符下方的点 → octave: 2
- 中音区（无点）→ octave: 0

### 时值识别
- 全音符（无下划线，后跟增时线）→ duration: 1
- 二分音符（一条下划线或增时线）→ duration: 2
- 四分音符（默认时值，无特殊标记）→ duration: 4
- 八分音符（一条下划线/减时线）→ duration: 8
- 十六分音符（两条下划线/减时线）→ duration: 16
- 附点音符：音符后的点 → dots: 1（或2为复附点）

### 其他元素
- 升记号 # → accidental: "sharp"
- 降记号 b → accidental: "flat"
- 还原记号 → accidental: "natural"
- 连音线（tie）→ tie_start / tie_end
- 圆滑线（slur）→ slur_start / slur_end
- 小节线分隔各小节
- 反复记号 → repeat_start / repeat_end
- 拍号（如 4/4, 3/4, 2/4, 6/8）
- 调号（如 1=C, 1=G, 1=F 等）
- 速度标记（如 ♩=120）
- 歌词标注
- 指法标注

## 输出格式

必须严格输出以下 JSON 格式，不要输出任何其他内容（不要 markdown 代码块标记）：

{
  "title": "曲名",
  "key_signature": "1=C",
  "time_signature": "4/4",
  "tempo": "120",
  "composer": "作曲者",
  "lyricist": "作词者",
  "measures": [
    {
      "notes": [
        {
          "pitch": 1,
          "duration": 4,
          "dots": 0,
          "octave": 0,
          "accidental": null,
          "tie_start": false,
          "tie_end": false,
          "slur_start": false,
          "slur_end": false,
          "lyrics": null,
          "fingering": null
        }
      ],
      "repeat_start": false,
      "repeat_end": false
    }
  ]
}

### 字段说明
- pitch: 1-7 的整数，休止符为 null
- duration: 1(全) / 2(二分) / 4(四分) / 8(八分) / 16(十六分)
- dots: 附点数 0/1/2
- octave: 0=中音, 1=高音, 2=低音
- accidental: "sharp" / "flat" / "natural" / null
- tie_start/tie_end: 连音线起始/结束
- slur_start/slur_end: 圆滑线起始/结束
- lyrics: 对应歌词文字或 null
- fingering: 指法标注或 null
- repeat_start/repeat_end: 反复记号

## 注意事项
1. 按照图片中小节线的分隔，将音符正确分配到各小节
2. 如果无法识别某个元素，使用最合理的默认值
3. 如果图片不是简谱，返回 {"title":"","key_signature":"","time_signature":"","tempo":"","composer":"","lyricist":"","measures":[]}
4. 只输出 JSON，不要包含任何其他文字或 markdown 标记`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64, mimeType } = body as {
      imageBase64: string;
      mimeType: string;
    };

    if (!imageBase64) {
      return NextResponse.json(
        { error: "请提供图片" },
        { status: 400 }
      );
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const dataUri = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    const messages: Message[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请识别这张简谱图片中的所有音乐元素，按照指定的 JSON 格式输出识别结果。",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUri,
              detail: "high",
            },
          },
        ],
      },
    ];

    // Timeout wrapper - 30s max for LLM call
    const llmPromise = client.invoke(messages, {
      model: "doubao-seed-2-0-pro-260215",
      temperature: 0.1,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM_TIMEOUT")), 30000)
    );
    const response = await Promise.race([llmPromise, timeoutPromise]);

    // Parse the JSON response
    let content = response.content.trim();

    // Remove markdown code block wrappers if present
    if (content.startsWith("```json")) {
      content = content.slice(7);
    } else if (content.startsWith("```")) {
      content = content.slice(3);
    }
    if (content.endsWith("```")) {
      content = content.slice(0, -3);
    }
    content = content.trim();

    try {
      const result = JSON.parse(content);
      return NextResponse.json({ success: true, data: result });
    } catch {
      return NextResponse.json(
        {
          error: "识别结果解析失败",
          raw: content,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Recognition error:", error);
    if (error instanceof Error && error.message === "LLM_TIMEOUT") {
      return NextResponse.json(
        { error: "识别超时，请尝试使用更小的图片后重试" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        error: "识别失败，请稍后重试",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
