import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";

const SYSTEM_PROMPT = `你是简谱识别专家。分析图片中的简谱，输出JSON。

音符: 1-7(do-re), 0=休止符。octave: 0=中音, 1=高音(上方点), 2=低音(下方点)。
时值duration: 1=全音符, 2=二分, 4=四分, 8=八分(一条下划线), 16=十六分(两条下划线)。
附点dots: 0/1/2。变音accidental: "sharp"/"flat"/"natural"/null。
连音线tie_start/tie_end, 圆滑线slur_start/slur_end, 反复repeat_start/repeat_end。
歌词lyrics, 指法fingering, 拍号time_signature(如4/4), 调号key_signature(如1=C)。

严格输出JSON，不要markdown标记：
{"title":"","key_signature":"","time_signature":"","tempo":"","composer":"","lyricist":"","measures":[{"notes":[{"pitch":1,"duration":4,"dots":0,"octave":0,"accidental":null,"tie_start":false,"tie_end":false,"slur_start":false,"slur_end":false,"lyrics":null,"fingering":null}],"repeat_start":false,"repeat_end":false}]}

非简谱图片返回空measures。按小节线分隔音符到各小节。`;

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
              detail: "low",
            },
          },
        ],
      },
    ];

    // Timeout wrapper - 45s max for LLM call
    const llmPromise = client.invoke(messages, {
      model: "doubao-seed-2-0-mini-260215",
      temperature: 0.1,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM_TIMEOUT")), 45000)
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
