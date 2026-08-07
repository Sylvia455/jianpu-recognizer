import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";
import { jsonrepair } from "jsonrepair";

const SYSTEM_PROMPT = `识别图片中的简谱，输出JSON。

字段说明：
- pitch: 1-7(音符), 0(休止符)
- octave: 0(中音), 1(高音), 2(低音)
- duration: 1(全音符), 2(二分), 4(四分), 8(八分), 16(十六分)
- dots: 0/1/2(附点)
- accidental: "sharp"/"flat"/null

JSON格式：
{"title":"","key_signature":"1=C","time_signature":"4/4","measures":[{"notes":[{"pitch":1,"duration":4,"octave":0,"dots":0,"accidental":null}]}]}

只输出JSON。非简谱返回{"measures":[]}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64, mimeType } = body as {
      imageBase64: string;
      mimeType: string;
    };

    if (!imageBase64) {
      return NextResponse.json({ error: "请提供图片" }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const dataUri = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "识别这张简谱，输出JSON。" },
          { type: "image_url", image_url: { url: dataUri, detail: "low" } },
        ],
      },
    ];

    // Use invoke with pro model for speed, but with minimal prompt
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), 60000);
    });

    const invokePromise = client.invoke(messages, {
      model: "doubao-seed-2-0-pro-260215",
      temperature: 0.1,
    });

    const response = await Promise.race([invokePromise, timeoutPromise]);

    const text = response.content;

    if (!text.trim()) {
      return NextResponse.json({ error: "识别结果为空" }, { status: 500 });
    }

    // Extract JSON
    let jsonStr = text.trim();
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

    // Repair common JSON issues from LLM output
    jsonStr = repairJSON(jsonStr);

    try {
      const result = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, data: result });
    } catch (e) {
      // Try jsonrepair as a more powerful fallback
      try {
        const repaired = jsonrepair(jsonStr);
        const result = JSON.parse(repaired);
        console.log("[Recognize] jsonrepair succeeded");
        return NextResponse.json({ success: true, data: result });
      } catch (e2) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const posMatch = errMsg.match(/position (\d+)/);
        const pos = posMatch ? parseInt(posMatch[1]) : 0;
        const contextStart = Math.max(0, pos - 100);
        const contextEnd = Math.min(jsonStr.length, pos + 100);
        console.error("[Recognize] JSON parse error:", errMsg);
        console.error("[Recognize] Context around error:", jsonStr.substring(contextStart, contextEnd));
        console.error("[Recognize] Full length:", jsonStr.length);
        return NextResponse.json(
          { error: "识别结果解析失败" },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "TIMEOUT") {
      return NextResponse.json(
        { error: "识别超时，请稍后重试" },
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

// Repair common JSON issues from LLM output
function repairJSON(str: string): string {
  let result = str;

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, "$1");

  // Fix missing commas between array elements: }{ → },{
  result = result.replace(/\}\s*\{/g, "},{");

  // Fix missing commas between array elements: ][ → ],[
  result = result.replace(/\]\s*\[/g, "],[");

  // Fix missing commas between object properties: "value" "key" → "value", "key"
  result = result.replace(/"\s*"/g, '", "');

  // Close unclosed brackets/braces
  const openBraces = (result.match(/\{/g) || []).length;
  const closeBraces = (result.match(/\}/g) || []).length;
  const openBrackets = (result.match(/\[/g) || []).length;
  const closeBrackets = (result.match(/\]/g) || []).length;

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    result += "]";
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    result += "}";
  }

  return result;
}
