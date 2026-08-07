import type { Metadata } from "next";
import { Inspector } from "react-dev-inspector";
import "./globals.css";

export const metadata: Metadata = {
  title: "简谱识别工具 - AI 智能识别简谱图片",
  description:
    "上传简谱图片，AI 智能识别音符、节拍、调号等元素，支持导出为 MusicXML、简谱文本、Guitar Pro 等多种格式。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
