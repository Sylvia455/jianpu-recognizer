"use client";

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload,
  ImageIcon,
  Copy,
  Download,
  FileText,
  Music,
  Loader2,
  X,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  type RecognitionResult,
  convertToMusicXml,
  convertToJianpu,
  convertToGP,
  formatResultAsText,
  downloadFile,
} from "@/lib/format-converters";
import JianpuRenderer from "@/components/jianpu-renderer";

type ExportFormat = "musicxml" | "jianpu" | "gp";

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("musicxml");
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|jpg|webp)$/)) {
      setError("请上传 JPG 或 PNG 格式的图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("图片大小不能超过 10MB");
      return;
    }
    setError(null);
    setResult(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Compress image before sending to API
  const compressImage = useCallback(
    (dataUrl: string, maxSize = 2048, quality = 0.92): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            } else {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl.split(",")[1]);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed.split(",")[1]);
        };
        img.src = dataUrl;
      });
    },
    []
  );

  const handleRecognize = useCallback(async () => {
    if (!imagePreview) return;
    setIsRecognizing(true);
    setError(null);
    setResult(null);

    try {
      const mimeType = imagePreview.split(";")[0].split(":")[1];
      const base64 = await compressImage(imagePreview);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const res = await fetch("/api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await res.text();
      let json: { success?: boolean; data?: RecognitionResult; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`服务器返回异常 (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(json.error || "识别失败");
      }

      if (!json.success || !json.data) {
        throw new Error(json.error || "识别结果异常");
      }

      setResult(json.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("识别超时，请尝试使用更清晰的图片后重试");
      } else {
        setError(err instanceof Error ? err.message : "识别失败，请稍后重试");
      }
    } finally {
      setIsRecognizing(false);
    }
  }, [imagePreview, compressImage]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const text = formatResultAsText(result);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const baseName = result.title || "简谱";

    switch (exportFormat) {
      case "musicxml": {
        const content = convertToMusicXml(result);
        downloadFile(content, `${baseName}.musicxml`, "application/xml");
        break;
      }
      case "jianpu": {
        const content = convertToJianpu(result);
        downloadFile(content, `${baseName}.jianpu.txt`, "text/plain");
        break;
      }
      case "gp": {
        const content = convertToGP(result);
        downloadFile(content, `${baseName}.gp.txt`, "text/plain");
        break;
      }
    }
  }, [result, exportFormat]);

  const handleReset = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const resultText = result ? formatResultAsText(result) : "";
  const jianpuText = result ? convertToJianpu(result) : "";

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#E7E5E4]">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9A3412]">
              <Music className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#1A1A1A]">
                简谱识别工具
              </h1>
              <p className="text-xs text-[#78716C]">
                上传简谱图片，AI 智能识别并导出为多种格式
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left Column - Input */}
          <div className="space-y-6">
            {/* Upload Area */}
            <Card className="border-[#E7E5E4] shadow-none">
              <CardContent className="p-6">
                <h2 className="mb-4 text-sm font-medium text-[#1A1A1A]">
                  上传图片
                </h2>

                {!imagePreview ? (
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors ${
                      isDragging
                        ? "border-[#9A3412] bg-[#FAFAF9]"
                        : "border-[#E7E5E4] hover:border-[#78716C] hover:bg-[#FAFAF9]"
                    }`}
                  >
                    <Upload
                      className={`mb-3 h-10 w-10 ${isDragging ? "text-[#9A3412]" : "text-[#78716C]"}`}
                    />
                    <p className="mb-1 text-sm font-medium text-[#1A1A1A]">
                      拖拽图片到此处，或点击选择
                    </p>
                    <p className="text-xs text-[#78716C]">
                      支持 JPG / PNG 格式，最大 10MB
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/jpg,image/webp"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative overflow-hidden rounded-lg border border-[#E7E5E4]">
                      <img
                        src={imagePreview}
                        alt="简谱预览"
                        className="max-h-80 w-full object-contain bg-[#FAFAF9]"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReset();
                        }}
                        className="absolute right-2 top-2 rounded-full bg-white/80 p-1.5 text-[#78716C] shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-[#1A1A1A]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs text-white backdrop-blur-sm">
                        {imageFile?.name}
                      </div>
                    </div>

                    <Button
                      onClick={handleRecognize}
                      disabled={isRecognizing}
                      className="w-full bg-[#9A3412] text-white hover:bg-[#7C2D12]"
                    >
                      {isRecognizing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          识别中...
                        </>
                      ) : (
                        <>
                          <ImageIcon className="mr-2 h-4 w-4" />
                          开始识别
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Error Display */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Loading State */}
            {isRecognizing && (
              <Card className="border-[#E7E5E4] shadow-none">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-[#78716C]">
                      <Loader2 className="h-4 w-4 animate-spin text-[#9A3412]" />
                      AI 正在分析简谱图片...
                    </div>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Output */}
          <div className="space-y-6">
            {/* Results */}
            <Card className="border-[#E7E5E4] shadow-none">
              <CardContent className="p-6">
                <h2 className="mb-4 text-sm font-medium text-[#1A1A1A]">
                  识别结果
                </h2>

                {!result && !isRecognizing ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="mb-3 h-10 w-10 text-[#E7E5E4]" />
                    <p className="text-sm text-[#78716C]">
                      上传简谱图片并点击&quot;开始识别&quot;
                    </p>
                    <p className="mt-1 text-xs text-[#78716C]">
                      识别结果将在此处显示
                    </p>
                  </div>
                ) : result ? (
                  <div className="space-y-4">
                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-3 rounded-lg bg-[#FAFAF9] p-4">
                      {result.title && (
                        <div>
                          <span className="text-xs text-[#78716C]">曲名</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.title}
                          </p>
                        </div>
                      )}
                      {result.key_signature && (
                        <div>
                          <span className="text-xs text-[#78716C]">调号</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.key_signature}
                          </p>
                        </div>
                      )}
                      {result.time_signature && (
                        <div>
                          <span className="text-xs text-[#78716C]">拍号</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.time_signature}
                          </p>
                        </div>
                      )}
                      {result.tempo && (
                        <div>
                          <span className="text-xs text-[#78716C]">速度</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.tempo}
                          </p>
                        </div>
                      )}
                      {result.composer && (
                        <div>
                          <span className="text-xs text-[#78716C]">作曲</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.composer}
                          </p>
                        </div>
                      )}
                      {result.lyricist && (
                        <div>
                          <span className="text-xs text-[#78716C]">作词</span>
                          <p className="text-sm font-medium text-[#1A1A1A]">
                            {result.lyricist}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Tabs for different views */}
                    <Tabs defaultValue="preview">
                      <TabsList className="bg-[#FAFAF9]">
                        <TabsTrigger value="preview" className="text-xs">
                          效果预览
                        </TabsTrigger>
                        <TabsTrigger value="structured" className="text-xs">
                          结构化视图
                        </TabsTrigger>
                        <TabsTrigger value="notation" className="text-xs">
                          简谱文本
                        </TabsTrigger>
                        <TabsTrigger value="raw" className="text-xs">
                          详细信息
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="preview" className="mt-3">
                        <JianpuRenderer result={result} />
                      </TabsContent>

                      <TabsContent value="structured" className="mt-3">
                        <div className="max-h-64 overflow-auto rounded-lg border border-[#E7E5E4] bg-white p-3">
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#1A1A1A]">
                            {resultText}
                          </pre>
                        </div>
                      </TabsContent>

                      <TabsContent value="notation" className="mt-3">
                        <div className="max-h-64 overflow-auto rounded-lg border border-[#E7E5E4] bg-white p-3">
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#1A1A1A]">
                            {jianpuText}
                          </pre>
                        </div>
                      </TabsContent>

                      <TabsContent value="raw" className="mt-3">
                        <div className="max-h-64 overflow-auto rounded-lg border border-[#E7E5E4] bg-white p-3">
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#1A1A1A]">
                            {JSON.stringify(result, null, 2)}
                          </pre>
                        </div>
                      </TabsContent>
                    </Tabs>

                    {/* Copy button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopy}
                      className="w-full border-[#E7E5E4] text-[#78716C] hover:bg-[#FAFAF9] hover:text-[#1A1A1A]"
                    >
                      {copied ? (
                        <>
                          <Check className="mr-2 h-3.5 w-3.5 text-green-600" />
                          已复制到剪贴板
                        </>
                      ) : (
                        <>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          复制文本
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Export Section */}
            {result && (
              <Card className="border-[#E7E5E4] shadow-none">
                <CardContent className="p-6">
                  <h2 className="mb-4 text-sm font-medium text-[#1A1A1A]">
                    导出文件
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs text-[#78716C]">
                        选择导出格式
                      </label>
                      <Select
                        value={exportFormat}
                        onValueChange={(v) =>
                          setExportFormat(v as ExportFormat)
                        }
                      >
                        <SelectTrigger className="border-[#E7E5E4]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="musicxml">
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5" />
                              <div>
                                <div className="text-sm">MusicXML</div>
                                <div className="text-xs text-[#78716C]">
                                  标准乐谱交换格式
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                          <SelectItem value="jianpu">
                            <div className="flex items-center gap-2">
                              <Music className="h-3.5 w-3.5" />
                              <div>
                                <div className="text-sm">简谱文本</div>
                                <div className="text-xs text-[#78716C]">
                                  纯文本简谱格式
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                          <SelectItem value="gp">
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5" />
                              <div>
                                <div className="text-sm">Guitar Pro</div>
                                <div className="text-xs text-[#78716C]">
                                  Guitar Pro 文本格式
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleDownload}
                      variant="outline"
                      className="w-full border-[#E7E5E4] hover:bg-[#FAFAF9]"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      下载 {exportFormat === "musicxml" ? "MusicXML" : exportFormat === "jianpu" ? "简谱文本" : "Guitar Pro"} 文件
                    </Button>

                    <p className="text-xs text-[#78716C]">
                      {exportFormat === "musicxml" &&
                        "MusicXML 是国际通用的乐谱交换格式，可被大多数制谱软件导入"}
                      {exportFormat === "jianpu" &&
                        "简谱文本格式使用数字标记音符，适合文本编辑器查看和分享"}
                      {exportFormat === "gp" &&
                        "Guitar Pro 格式可被 Guitar Pro 等吉他谱软件读取"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E7E5E4] py-6">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs text-[#78716C]">
            简谱识别工具 — AI 驱动的简谱图片识别与格式转换
          </p>
        </div>
      </footer>
    </div>
  );
}
