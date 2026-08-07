import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";
import {
  RecognitionResult,
  convertToMusicXml,
  convertToJianpu,
  convertToGP,
} from "@/lib/format-converters";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = `你是简谱识别专家。分析图片中的简谱，返回 JSON。

规则：
- 音符：1-7，休止符：0
- octave：中音=0，低音=-1，高音=1
- duration：4=四分，8=八分，16=十六分，2=二分，1=全音符
- accidental：null/#/b

JSON 格式：
{"key_signature":"1=C","time_signature":"4/4","measures":[{"notes":[{"pitch":1,"duration":4,"octave":0,"dots":0,"accidental":null}]}]}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "请提供图片" }, { status: 400 });
    }

    if (!DEEPSEEK_API_KEY) {
      return NextResponse.json(
        { error: "DeepSeek API Key 未配置，请在 Vercel 环境变量中添加 DEEPSEEK_API_KEY" },
        { status: 500 }
      );
    }

    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "请识别这张简谱图片，返回 JSON。" },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ];

    // 使用流式输出收集完整响应
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Recognize] DeepSeek API error:", response.status, errorText);
      return NextResponse.json(
        { error: `DeepSeek API 错误: ${response.status}` },
        { status: 502 }
      );
    }

    // 收集流式响应
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    }

    console.log(`[Recognize] Full response length: ${fullContent.length}`);

    if (!fullContent) {
      return NextResponse.json(
        { error: "LLM 未返回内容" },
        { status: 500 }
      );
    }

    // 提取 JSON
    let jsonStr = fullContent;
    const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    // 尝试解析 JSON
    let result: RecognitionResult;
    try {
      result = JSON.parse(jsonStr);
    } catch (e) {
      console.log(`[Recognize] JSON parse error: ${(e as Error).message}`);
      // 尝试修复
      try {
        const repaired = jsonrepair(jsonStr);
        result = JSON.parse(repaired);
        console.log("[Recognize] JSON repaired successfully");
      } catch {
        console.log("[Recognize] Content (first 500):", fullContent.substring(0, 500));
        return NextResponse.json(
          { error: "识别结果解析失败" },
          { status: 500 }
        );
      }
    }

    // 确保 measures 存在
    if (!result.measures) {
      result = { title: "", key_signature: "1=C", time_signature: "4/4", tempo: "", composer: "", lyricist: "", measures: [] };
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[Recognize] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 }
    );
  }
}
