import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    hasApiKey: !!process.env.QWEN_API_KEY,
    apiKeyPrefix: process.env.QWEN_API_KEY ? process.env.QWEN_API_KEY.substring(0, 10) + "..." : "not set",
  });
}
