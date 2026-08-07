"use client";

import type { RecognitionResult, NoteData, MeasureData } from "@/lib/format-converters";

interface JianpuRendererProps {
  result: RecognitionResult;
}

function NoteDisplay({ note }: { note: NoteData }) {
  const isRest = note.pitch === null;

  if (isRest) {
    return (
      <span className="inline-flex flex-col items-center mx-[2px]">
        <span className="text-[#78716C] text-lg font-mono">0</span>
        {note.duration <= 2 && (
          <span className="text-[#78716C] text-[10px] font-mono leading-none">
            {"─".repeat(note.duration === 1 ? 4 : 2)}
          </span>
        )}
      </span>
    );
  }

  const num = note.pitch!;
  const isHigh = note.octave === 1;
  const isLow = note.octave === 2;
  const acc = note.accidental === "sharp" ? "#" : note.accidental === "flat" ? "b" : "";

  // Underlines for short notes (8th = 1, 16th = 2)
  const underlineCount = note.duration === 8 ? 1 : note.duration === 16 ? 2 : 0;

  // Dashes for extended notes (half = 2, whole = 4, dotted quarter = 1)
  const dashCount = note.duration === 2 ? 2 : note.duration === 1 ? 4 : note.dots > 0 ? 1 : 0;

  return (
    <span className="inline-flex flex-col items-center mx-[3px] relative">
      {/* High octave dots */}
      {isHigh && (
        <span className="text-[10px] leading-[8px] text-[#1A1A1A]">&#9679;</span>
      )}
      {!isHigh && !isLow && <span className="h-[8px]" />}

      {/* Note number with accidental and dots */}
      <span className="relative text-xl font-mono font-semibold text-[#1A1A1A] leading-tight">
        {acc && <span className="text-xs absolute -left-3 top-0 text-[#9A3412]">{acc}</span>}
        {num}
        {note.dots > 0 && (
          <span className="absolute -right-1.5 top-0 text-sm text-[#9A3412]">
            {".".repeat(note.dots)}
          </span>
        )}
        {note.tie_start && (
          <span className="absolute -right-3 -top-1 text-[10px] text-[#78716C]">&#8765;</span>
        )}
      </span>

      {/* Underlines for short notes */}
      {underlineCount > 0 && (
        <span className="flex flex-col items-center leading-[2px]">
          {Array.from({ length: underlineCount }).map((_, i) => (
            <span key={i} className="block h-[1.5px] bg-[#1A1A1A]" style={{ minWidth: "14px", width: "14px" }} />
          ))}
        </span>
      )}

      {/* Dashes for extended notes */}
      {dashCount > 0 && underlineCount === 0 && (
        <span className="text-[#78716C] text-[10px] font-mono leading-none">
          {"─".repeat(dashCount)}
        </span>
      )}

      {!isLow && underlineCount === 0 && dashCount === 0 && <span className="h-[6px]" />}

      {/* Low octave dots */}
      {isLow && (
        <span className="text-[10px] leading-[8px] text-[#1A1A1A]">&#9679;</span>
      )}
    </span>
  );
}

function MeasureDisplay({
  measure,
  measureIndex,
  beatsPerMeasure,
}: {
  measure: MeasureData;
  measureIndex: number;
  beatsPerMeasure: number;
}) {
  // Group notes by beats
  const notesPerBeat = Math.max(1, Math.ceil(measure.notes.length / beatsPerMeasure));
  const beatGroups: NoteData[][] = [];
  for (let i = 0; i < measure.notes.length; i += notesPerBeat) {
    beatGroups.push(measure.notes.slice(i, i + notesPerBeat));
  }
  if (beatGroups.length === 0) beatGroups.push([]);

  return (
    <span className="inline-flex items-start relative mr-1">
      {/* Measure number */}
      <span className="absolute -top-4 left-0 text-[9px] text-[#A8A29E] font-mono select-none">
        {measureIndex + 1}
      </span>

      {/* Notes */}
      <span className="flex items-end pt-3 gap-px">
        {beatGroups.map((group, gi) => (
          <span key={gi} className="inline-flex items-end">
            {group.map((note, ni) => (
              <NoteDisplay key={ni} note={note} />
            ))}
            {gi < beatGroups.length - 1 && <span className="w-1" />}
          </span>
        ))}
      </span>

      {/* Bar line */}
      <span
        className={`self-stretch ml-2 min-h-[36px] ${
          measure.repeat_end ? "border-l-2 border-l-[#1A1A1A] border-r-[1.5px] border-r-[#1A1A1A]" : "border-l-[1.5px] border-l-[#1A1A1A]"
        }`}
        style={{ width: measure.repeat_end ? "5px" : "1.5px" }}
      />
    </span>
  );
}

export function JianpuRenderer({ result }: JianpuRendererProps) {
  if (!result.measures || result.measures.length === 0) {
    return (
      <div className="text-[#78716C] text-sm py-12 text-center border border-dashed border-[#E7E5E4] rounded-lg">
        未识别到简谱内容，请上传清晰的简谱图片重试
      </div>
    );
  }

  // Parse time signature string like "4/4"
  const timeSigParts = (result.time_signature || "4/4").split("/");
  const numerator = parseInt(timeSigParts[0]) || 4;
  const denominator = parseInt(timeSigParts[1]) || 4;

  // Group measures into lines (4 measures per line)
  const measuresPerLine = 4;
  const lines: typeof result.measures[] = [];
  for (let i = 0; i < result.measures.length; i += measuresPerLine) {
    lines.push(result.measures.slice(i, i + measuresPerLine));
  }

  return (
    <div className="bg-white border border-[#E7E5E4] rounded-lg p-6 overflow-x-auto">
      {/* Title */}
      {result.title && (
        <div className="text-center mb-3">
          <h2 className="text-xl font-bold text-[#1A1A1A]">{result.title}</h2>
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-5 text-sm text-[#78716C] justify-center border-b border-[#E7E5E4] pb-4">
        {result.key_signature && (
          <span>
            调号: <span className="text-[#1A1A1A] font-medium">{result.key_signature}</span>
          </span>
        )}
        <span>
          拍号: <span className="text-[#1A1A1A] font-medium">{numerator}/{denominator}</span>
        </span>
        {result.tempo && (
          <span>
            速度: <span className="text-[#1A1A1A] font-medium">{result.tempo}</span>
          </span>
        )}
        {result.composer && (
          <span>
            作曲: <span className="text-[#1A1A1A] font-medium">{result.composer}</span>
          </span>
        )}
        {result.lyricist && (
          <span>
            作词: <span className="text-[#1A1A1A] font-medium">{result.lyricist}</span>
          </span>
        )}
      </div>

      {/* Notation lines */}
      <div className="space-y-10 font-mono">
        {lines.map((line, lineIdx) => (
          <div key={lineIdx} className="flex items-start">
            {/* Beginning double bar for first line */}
            {lineIdx === 0 && (
              <span className="border-l-[1.5px] border-r-[1.5px] border-[#1A1A1A] self-stretch mr-2 min-h-[36px]" style={{ width: "5px" }} />
            )}

            {/* Measures */}
            <div className="flex flex-wrap items-start">
              {line.map((measure, mIdx) => (
                <MeasureDisplay
                  key={mIdx}
                  measure={measure}
                  measureIndex={lineIdx * measuresPerLine + mIdx}
                  beatsPerMeasure={numerator}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Lyrics row */}
      {result.measures.some((m) => m.notes.some((n) => n.lyrics)) && (
        <div className="mt-6 pt-4 border-t border-[#E7E5E4]">
          <div className="text-xs text-[#78716C] mb-2">歌词:</div>
          <div className="flex flex-wrap gap-4 text-sm text-[#1A1A1A] font-mono">
            {result.measures.map((m, mi) => (
              <span key={mi} className="flex gap-1">
                {m.notes
                  .filter((n) => n.lyrics)
                  .map((n, ni) => (
                    <span key={ni} className="px-1">
                      {n.lyrics}
                    </span>
                  ))}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
