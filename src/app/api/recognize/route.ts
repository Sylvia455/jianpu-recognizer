import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";

const SYSTEM_PROMPT = `你是简谱识别专家。分析图片中的简谱，输出JSON。

规则：
- pitch: 1-7(音符), 0(休止符)
- octave: 0(中音), 1(高音,数字上方有点), 2(低音,数字下方有点)
- duration: 1(全音符), 2(二分), 4(四分), 8(八分,数字下1条线), 16(十六分,数字下2条线)
- dots: 附点数量 0/1/2
- accidental: "sharp"(#)/"flat"(b)/null

JSON格式：
{"title":"","key_signature":"1=C","time_signature":"4/4","measures":[{"notes":[{"pitch":1,"duration":4,"octave":0,"dots":0,"accidental":null}]}]}

只输出JSON，不要其他文字。非简谱返回{"measures":[]}。`;

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
            text: "识别这张简谱图片，输出JSON。",
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

    // Use streaming to collect full response (avoid truncation)
    const stream = client.stream(messages, {
      model: "doubao-seed-2-0-lite-260215",
      temperature: 0.1,
    });

    let fullContent = "";
    const timeout = setTimeout(() => {
      throw new Error("LLM_TIMEOUT");
    }, 90000);

    try {
      for await (const chunk of stream) {
        const text = chunk.content;
        if (typeof text === "string") {
          fullContent += text;
        } else if (Array.isArray(text)) {
          for (const part of text) {
            if (part.type === "text" && typeof part.text === "string") {
              fullContent += part.text;
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!fullContent.trim()) {
      return NextResponse.json(
        { error: "识别结果为空" },
        { status: 500 }
      );
    }

    console.log("[Recognize] Full response length:", fullContent.length);

    // Extract JSON
    let jsonStr = fullContent.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        jsonStr = jsonStr.substring(start, end + 1);
      }
    }

    try {
      const result = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, data: result });
    } catch (parseError) {
      console.error("[Recognize] JSON parse error:", parseError instanceof Error ? parseError.message : parseError);
      console.error("[Recognize] Content (first 500):", jsonStr.substring(0, 500));
      return NextResponse.json(
        { error: "识别结果解析失败", raw: jsonStr.substring(0, 500) },
        { status: 500 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "LLM_TIMEOUT") {
      return NextResponse.json(
        { error: "识别超时，请尝试使用更小的图片后重试" },
        { status: 504 }
      );
    }
    console.error("[Recognize] Error:", error);
    return NextResponse.json(
      { error: "识别失败，请稍后重试" },
      { status: 500 }
    );
  }
}
