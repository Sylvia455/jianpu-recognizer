import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";

const SYSTEM_PROMPT = `简谱识别专家。输出JSON。

音符pitch: 1-7(do-re), 0=休止。octave: 0=中音, 1=高音, 2=低音。
时值duration: 1=全音符, 2=二分, 4=四分, 8=八分, 16=十六分。
附点dots: 0/1/2。变音accidental: "sharp"/"flat"/null。
连音tie: true/false。

JSON格式（去掉null和false字段以缩短长度）：
{"title":"","key_signature":"1=C","time_signature":"4/4","measures":[{"notes":[{"pitch":1,"duration":4,"octave":0}]}]}

只返回必要字段：pitch, duration, octave, dots, accidental(非null时), tie(非false时)。
非简谱返回{"measures":[]}。`;

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

    // Timeout wrapper - 60s max for LLM call
    const llmPromise = client.invoke(messages, {
      model: "doubao-seed-2-0-mini-260215",
      temperature: 0.1,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM_TIMEOUT")), 60000)
    );
    const response = await Promise.race([llmPromise, timeoutPromise]);

    // Parse the JSON response
    let content = response.content.trim();
    console.log("[Recognize] LLM response length:", content.length, "preview:", content.substring(0, 200));

    // Try to extract JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    } else {
      // Try to find JSON object in the response
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        content = content.substring(jsonStart, jsonEnd + 1);
      }
    }

    try {
      const result = JSON.parse(content);
      return NextResponse.json({ success: true, data: result });
    } catch (parseError) {
      console.error("[Recognize] JSON parse error:", parseError instanceof Error ? parseError.message : parseError);
      
      // Try to fix truncated JSON
      try {
        // Find the last complete object/array boundary
        let fixed = content;
        // Remove trailing incomplete data
        const lastComplete = fixed.lastIndexOf("}");
        const lastArrayEnd = fixed.lastIndexOf("]");
        const lastValid = Math.max(lastComplete, lastArrayEnd);
        if (lastValid > 0) {
          fixed = fixed.substring(0, lastValid + 1);
          // Try to close any open structures
          const openBraces = (fixed.match(/{/g) || []).length;
          const closeBraces = (fixed.match(/}/g) || []).length;
          const openBrackets = (fixed.match(/\[/g) || []).length;
          const closeBrackets = (fixed.match(/\]/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
          const fixedResult = JSON.parse(fixed);
          console.log("[Recognize] Fixed truncated JSON, length:", fixed.length);
          return NextResponse.json({ success: true, data: fixedResult });
        }
      } catch (fixError) {
        console.error("[Recognize] JSON fix failed:", fixError instanceof Error ? fixError.message : fixError);
      }
      
      console.error("[Recognize] Content preview:", content.substring(0, 500));
      return NextResponse.json(
        {
          error: "识别结果解析失败",
          raw: content.substring(0, 1000),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Recognition error:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message === "LLM_TIMEOUT") {
      return NextResponse.json(
        { error: "识别超时，请尝试使用更小的图片后重试" },
        { status: 504 }
      );
    }
    const errMsg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { error: `识别失败: ${errMsg}` },
      { status: 500 }
    );
  }
}
