"use client";

import type { RecognitionResult } from "@/lib/format-converters";

type NoteData = RecognitionResult["measures"][number]["notes"][number];
type MeasureData = RecognitionResult["measures"][number];

interface JianpuRendererProps {
  result: RecognitionResult;
}

function NoteDisplay({ note }: { note: NoteData }) {
  const isRest = note.pitch === null;

  // Determine accidental prefix
  const accidentalPrefix =
    note.accidental === "sharp"
      ? "#"
      : note.accidental === "flat"
        ? "b"
        : "";

  // Octave dots
  const highDot = note.octave === 1;
  const lowDot = note.octave === 2;

  // Duration underlines
  const showUnderline = note.duration >= 8;
  const doubleUnderline = note.duration >= 16;

  return (
    <span className="inline-flex flex-col items-center mx-[2px] relative">
      {/* High octave dot */}
      <span className="h-3 flex items-center justify-center">
        {highDot && (
          <span className="w-1.5 h-1.5 rounded-full bg-stone-800" />
        )}
      </span>

      {/* Note content */}
      <span className="relative">
        {note.tie_end && (
          <span className="absolute -left-1 top-0 w-1 h-full border-l-2 border-stone-400 rounded-full" />
        )}
        <span className="text-xl font-semibold text-stone-800">
          {isRest ? "0" : `${accidentalPrefix}${String(note.pitch)}`}
        </span>
        {note.dots > 0 && (
          <span className="absolute -right-1 top-0 text-xs text-stone-600">
            {".".repeat(note.dots)}
          </span>
        )}
        {note.tie_start && (
          <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-stone-400 text-sm">
            ⌒
          </span>
        )}
      </span>

      {/* Low octave dot */}
      <span className="h-3 flex items-center justify-center">
        {lowDot && (
          <span className="w-1.5 h-1.5 rounded-full bg-stone-800" />
        )}
      </span>

      {/* Underlines for short notes */}
      {showUnderline && (
        <span className="absolute bottom-2 left-0 right-0 flex flex-col items-center gap-[1px]">
          <span className="w-full h-[1.5px] bg-stone-700" />
          {doubleUnderline && (
            <span className="w-full h-[1.5px] bg-stone-700" />
          )}
        </span>
      )}

      {/* Lyrics */}
      {note.lyrics && (
        <span className="text-[10px] text-stone-500 mt-0.5 whitespace-nowrap">
          {note.lyrics}
        </span>
      )}
    </span>
  );
}

function MeasureDisplay({
  measure,
  index,
}: {
  measure: MeasureData;
  index: number;
}) {
  return (
    <span className="inline-flex items-start">
      {measure.repeat_start && (
        <span className="flex flex-col items-center mx-0.5 text-stone-500 self-center">
          <span className="w-[2px] h-6 bg-stone-400" />
          <span className="w-[1px] h-6 bg-stone-400 ml-[2px]" />
        </span>
      )}
      <span className="inline-flex items-start">
        {measure.notes.map((note, nIdx) => (
          <NoteDisplay key={nIdx} note={note} />
        ))}
      </span>
      <span className="self-stretch w-[1px] bg-stone-300 mx-1 min-h-[40px]" />
      {measure.repeat_end && (
        <span className="flex flex-col items-center mx-0.5 text-stone-500 self-center">
          <span className="w-[1px] h-6 bg-stone-400 mr-[2px]" />
          <span className="w-[2px] h-6 bg-stone-400" />
        </span>
      )}
    </span>
  );
}

export default function JianpuRenderer({ result }: JianpuRendererProps) {
  if (!result || !result.measures || result.measures.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-stone-400 text-sm">
        暂无识别结果
      </div>
    );
  }

  // Group measures into rows (4 measures per row)
  const rows: MeasureData[][] = [];
  for (let i = 0; i < result.measures.length; i += 4) {
    rows.push(result.measures.slice(i, i + 4));
  }

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-600 border-b border-stone-200 pb-3">
        {result.title && (
          <span className="font-semibold text-stone-800 text-base">
            {result.title}
          </span>
        )}
        {result.key_signature && <span>调号：{result.key_signature}</span>}
        {result.time_signature && <span>拍号：{result.time_signature}</span>}
        {result.tempo && <span>速度：♩={result.tempo}</span>}
        {result.composer && <span>作曲：{result.composer}</span>}
        {result.lyricist && <span>作词：{result.lyricist}</span>}
      </div>

      {/* Notation rows */}
      <div className="space-y-3">
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-start flex-wrap gap-y-1 bg-stone-50/50 rounded-lg px-3 py-2"
          >
            {/* Measure numbers */}
            <span className="text-[10px] text-stone-400 mr-2 mt-1 min-w-[16px]">
              {rowIdx * 4 + 1}
            </span>
            <span className="flex flex-wrap items-start gap-x-0">
              {row.map((measure, mIdx) => (
                <MeasureDisplay
                  key={mIdx}
                  measure={measure}
                  index={rowIdx * 4 + mIdx}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
