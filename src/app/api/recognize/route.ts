import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, type Message } from "coze-coding-dev-sdk";
import { jsonrepair } from "jsonrepair";

const SYSTEM_PROMPT = [
  "你是专业的简谱识别专家。请仔细识别图片中的简谱，输出完整的 JSON。",
  "",
  "## 识别规则",
  "- 音符：1-7（do re mi fa sol la si），0 表示休止符",
  "- 八度：octave=0（中音），octave=1（高音，数字上方有点），octave=2（低音，数字下方有点）",
  "- 时值：duration=1（全音符），2（二分），4（四分），8（八分，下方一条线），16（十六分，下方两条线）",
  "- 附点：dots=0/1/2（数字右侧的点）",
  "- 变音号：accidental=\"sharp\"（#升号）/\"flat\"（b降号）/null",
  "- 连音线：tie_start=true（连线开始）/tie_end=true（连线结束）",
  "- 小节线：每个 measure 是一个小节",
  "",
  "## 输出格式",
  '{"title":"","key_signature":"1=C","time_signature":"4/4","measures":[{"notes":[{"pitch":1,"duration":4,"octave":0,"dots":0,"accidental":null,"tie_start":false,"tie_end":false}]}]}',
  "",
  "## 重要",
  "- 必须输出完整 JSON，不要截断",
  "- 非简谱图片返回 {\"measures\":[]}",
  "- 只输出 JSON，不要其他文字",
].join("\n");

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
          { type: "text", text: "请识别这张简谱图片，输出完整的 JSON。" },
          { type: "image_url", image_url: { url: dataUri, detail: "high" } },
        ],
      },
    ];

    // 使用流式输出确保完整收集响应
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), 120000);
    });

    const streamPromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of client.stream(messages, {
        model: "doubao-seed-2-0-pro-260215",
        temperature: 0.1,
      })) {
        if (chunk.content) {
          if (typeof chunk.content === "string") {
            chunks.push(chunk.content);
          } else {
            for (const part of chunk.content) {
              if (part.type === "text") {
                chunks.push(String(part.text));
              }
            }
          }
        }
      }
      return chunks.join("");
    })();

    const text = await Promise.race([streamPromise, timeoutPromise]);

    if (!text || !text.trim()) {
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

    // 三层 JSON 解析策略
    // 1. 直接解析
    try {
      const result = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, data: result });
    } catch {}

    // 2. repairJSON 修复
    const repaired1 = repairJSON(jsonStr);
    try {
      const result = JSON.parse(repaired1);
      return NextResponse.json({ success: true, data: result });
    } catch {}

    // 3. jsonrepair 库修复
    try {
      const repaired2 = jsonrepair(repaired1);
      const result = JSON.parse(repaired2);
      return NextResponse.json({ success: true, data: result });
    } catch {}

    return NextResponse.json(
      { error: "识别结果解析失败，请尝试更清晰的图片" },
      { status: 500 }
    );
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

function repairJSON(str: string): string {
  let result = str;
  // 去除尾逗号
  result = result.replace(/,\s*([}\]])/g, "$1");
  // 补全缺失逗号
  result = result.replace(/}\s*{/g, "},{");
  result = result.replace(/\]\s*\[/g, "],[");
  result = result.replace(/"\s*{/g, '",{');
  result = result.replace(/}\s*"/g, '},"');
  // 关闭未闭合的括号
  const opens = (result.match(/{/g) || []).length;
  const closes = (result.match(/}/g) || []).length;
  for (let i = 0; i < opens - closes; i++) result += "}";
  const arrOpens = (result.match(/\[/g) || []).length;
  const arrCloses = (result.match(/\]/g) || []).length;
  for (let i = 0; i < arrOpens - arrCloses; i++) result += "]";
  return result;
}
