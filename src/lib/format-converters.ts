// ============================================================
// 简谱识别结果类型定义
// ============================================================

export interface NoteData {
  pitch: number | null; // 1-7, null = rest
  duration: number; // 1=whole, 2=half, 4=quarter, 8=eighth, 16=sixteenth
  dots: number; // 附点数量 0-2
  octave: number; // 0=中音, 1=高音, 2=低音
  accidental: "sharp" | "flat" | "natural" | null;
  tie_start: boolean;
  tie_end: boolean;
  slur_start: boolean;
  slur_end: boolean;
  lyrics: string | null;
  fingering: string | null;
}

export interface MeasureData {
  notes: NoteData[];
  repeat_start?: boolean;
  repeat_end?: boolean;
  ending?: number;
}

export interface RecognitionResult {
  title: string;
  key_signature: string;
  time_signature: string;
  tempo: string;
  composer: string;
  lyricist: string;
  measures: MeasureData[];
}

// ============================================================
// MusicXML 转换
// ============================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const PITCH_TO_STEP: Record<number, string> = {
  1: "C",
  2: "D",
  3: "E",
  4: "F",
  5: "G",
  6: "A",
  7: "B",
};

function noteToMusicXmlPitch(
  note: NoteData
): { step: string; octave: number; alter?: number } {
  if (note.pitch === null) {
    return { step: "C", octave: 4 };
  }
  const step = PITCH_TO_STEP[note.pitch] || "C";
  // Base octave: jianpu middle octave (1=C) maps to C4
  let octave = 4;
  if (note.octave === 1) octave = 5; // 高音
  if (note.octave === 2) octave = 3; // 低音

  let alter: number | undefined;
  if (note.accidental === "sharp") alter = 1;
  else if (note.accidental === "flat") alter = -1;
  else if (note.accidental === "natural") alter = 0;

  return { step, octave, alter };
}

function durationToTicks(duration: number, divisions: number): number {
  // divisions = ticks per quarter note
  const quarterRatio = 4 / duration;
  return Math.round(divisions * quarterRatio);
}

function dotsToDurationAddition(
  dots: number,
  baseTicks: number
): number {
  let addition = 0;
  let value = baseTicks;
  for (let i = 0; i < dots; i++) {
    value = value / 2;
    addition += value;
  }
  return Math.round(addition);
}

export function convertToMusicXml(data: RecognitionResult): string {
  const divisions = 4; // ticks per quarter note
  const timeParts = data.time_signature.split("/");
  const beats = parseInt(timeParts[0]) || 4;
  const beatType = parseInt(timeParts[1]) || 4;

  // Parse key signature
  const keyFifths = keySignatureToFifths(data.key_signature);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${escapeXml(data.title)}</work-title>
  </work>
  <identification>
    <creator type="composer">${escapeXml(data.composer)}</creator>
    <creator type="lyricist">${escapeXml(data.lyricist)}</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>简谱</part-name>
    </score-part>
  </part-list>
  <part id="P1">
`;

  data.measures.forEach((measure, mIdx) => {
    xml += `    <measure number="${mIdx + 1}">\n`;

    // Add attributes to first measure or when key/time changes
    if (mIdx === 0) {
      xml += `      <attributes>
        <divisions>${divisions}</divisions>
        <key>
          <fifths>${keyFifths}</fifths>
        </key>
        <time>
          <beats>${beats}</beats>
          <beat-type>${beatType}</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>\n`;

      if (data.tempo) {
        const tempoNum = parseInt(data.tempo) || 120;
        xml += `      <direction>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>${tempoNum}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${tempoNum}"/>
      </direction>\n`;
      }
    }

    // Barline for repeat
    if (measure.repeat_start) {
      xml += `      <barline location="left">
        <bar-style>heavy-light</bar-style>
        <repeat direction="forward"/>
      </barline>\n`;
    }

    // Notes
    measure.notes.forEach((note) => {
      if (note.pitch === null) {
        // Rest
        const ticks = durationToTicks(note.duration, divisions);
        const dotAdd = dotsToDurationAddition(note.dots, ticks);
        xml += `      <note>
        <rest/>
        <duration>${ticks + dotAdd}</duration>
        <type>${durationToType(note.duration)}</type>
`;
        for (let i = 0; i < note.dots; i++) {
          xml += `        <dot/>\n`;
        }
        xml += `      </note>\n`;
      } else {
        const pitchInfo = noteToMusicXmlPitch(note);
        const ticks = durationToTicks(note.duration, divisions);
        const dotAdd = dotsToDurationAddition(note.dots, ticks);

        xml += `      <note>
        <pitch>
          <step>${pitchInfo.step}</step>
          <octave>${pitchInfo.octave}</octave>`;
        if (pitchInfo.alter !== undefined) {
          xml += `
          <alter>${pitchInfo.alter}</alter>`;
        }
        xml += `
        </pitch>
        <duration>${ticks + dotAdd}</duration>
        <type>${durationToType(note.duration)}</type>
`;
        for (let i = 0; i < note.dots; i++) {
          xml += `        <dot/>\n`;
        }
        if (note.accidental) {
          xml += `        <accidental>${note.accidental}</accidental>\n`;
        }
        if (note.tie_start) {
          xml += `        <tie type="start"/>\n`;
        }
        if (note.tie_end) {
          xml += `        <tie type="stop"/>\n`;
        }
        if (note.slur_start) {
          xml += `        <notations><slur type="start"/></notations>\n`;
        }
        if (note.slur_end) {
          xml += `        <notations><slur type="stop"/></notations>\n`;
        }
        if (note.lyrics) {
          xml += `        <lyric>
          <syllabic>single</syllabic>
          <text>${escapeXml(note.lyrics)}</text>
        </lyric>\n`;
        }
        xml += `      </note>\n`;
      }
    });

    if (measure.repeat_end) {
      xml += `      <barline location="right">
        <bar-style>light-heavy</bar-style>
        <repeat direction="backward"/>
      </barline>\n`;
    }

    xml += `    </measure>\n`;
  });

  xml += `  </part>
</score-partwise>`;

  return xml;
}

function durationToType(duration: number): string {
  switch (duration) {
    case 1:
      return "whole";
    case 2:
      return "half";
    case 4:
      return "quarter";
    case 8:
      return "eighth";
    case 16:
      return "16th";
    case 32:
      return "32nd";
    default:
      return "quarter";
  }
}

function keySignatureToFifths(key: string): number {
  const keyMap: Record<string, number> = {
    C: 0,
    Am: 0,
    G: 1,
    Em: 1,
    D: 2,
    Bm: 2,
    A: 3,
    "F#m": 3,
    E: 4,
    "C#m": 4,
    B: 5,
    "G#m": 5,
    "F#": 6,
    "D#m": 6,
    "C#": 7,
    "A#m": 7,
    F: -1,
    Dm: -1,
    Bb: -2,
    Gm: -2,
    Eb: -3,
    Cm: -3,
    Ab: -4,
    Fm: -4,
    Db: -5,
    Bbm: -5,
    Gb: -6,
    Ebm: -6,
    Cb: -7,
    Abm: -7,
  };
  // Try to match Chinese key names
  const chineseKeyMap: Record<string, string> = {
    "1=C": "C",
    "1=G": "G",
    "1=D": "D",
    "1=A": "A",
    "1=E": "E",
    "1=B": "B",
    "1=F": "F",
    "1=bB": "Bb",
    "1=bE": "Eb",
    "1=bA": "Ab",
    "1=bD": "Db",
    "1=bG": "Gb",
    "1=bC": "Cb",
    "1=#F": "F#",
    "1=#C": "C#",
    "1=#G": "G#",
    "1=#D": "D#",
    "1=#A": "A#",
  };

  const mapped = chineseKeyMap[key] || key;
  return keyMap[mapped] ?? 0;
}

// ============================================================
// 简谱文本格式 (Jianpu Notation Text)
// ============================================================

const DURATION_UNDERLINES: Record<number, number> = {
  1: 0, // 全音符: 无下划线
  2: 0, // 二分音符: 无下划线
  4: 0, // 四分音符: 无下划线
  8: 1, // 八分音符: 1条下划线
  16: 2, // 十六分音符: 2条下划线
  32: 3,
};

export function convertToJianpu(data: RecognitionResult): string {
  const lines: string[] = [];

  // Header
  if (data.title) lines.push(`标题: ${data.title}`);
  if (data.key_signature) lines.push(`调号: ${data.key_signature}`);
  if (data.time_signature) lines.push(`拍号: ${data.time_signature}`);
  if (data.tempo) lines.push(`速度: ${data.tempo}`);
  if (data.composer) lines.push(`作曲: ${data.composer}`);
  if (data.lyricist) lines.push(`作词: ${data.lyricist}`);
  lines.push("");

  // Notation
  data.measures.forEach((measure, mIdx) => {
    const measureParts: string[] = [];

    if (measure.repeat_start) measureParts.push("|:");

    measure.notes.forEach((note) => {
      let noteStr = "";

      if (note.pitch === null) {
        noteStr = "0";
      } else {
        noteStr = note.pitch.toString();
      }

      // Accidentals
      if (note.accidental === "sharp") noteStr = `#${noteStr}`;
      else if (note.accidental === "flat") noteStr = `b${noteStr}`;

      // Octave dots
      if (note.octave === 1) {
        // High octave - dots above (represented with unicode combining dot above)
        noteStr = `${noteStr}\u0307`; // combining dot above
      } else if (note.octave === 2) {
        // Low octave - dots below
        noteStr = `${noteStr}\u0323`; // combining dot below
      }

      // Dots (augmentation dots)
      if (note.dots > 0) {
        noteStr += ".".repeat(note.dots);
      }

      // Duration underlines
      const underlines = DURATION_UNDERLINES[note.duration] || 0;
      if (underlines > 0) {
        noteStr += "_".repeat(underlines);
      }

      // Tie
      if (note.tie_start) noteStr += "⁀";

      // Lyrics
      if (note.lyrics) {
        noteStr += `(${note.lyrics})`;
      }

      // Fingering
      if (note.fingering) {
        noteStr += `[${note.fingering}]`;
      }

      measureParts.push(noteStr);
    });

    if (measure.repeat_end) measureParts.push(":|");

    lines.push(`[${String(mIdx + 1).padStart(3, " ")}] ${measureParts.join(" ")}`);
  });

  return lines.join("\n");
}

// ============================================================
// Guitar Pro 文本格式 (GP Text)
// ============================================================

const GP_DURATION_MAP: Record<number, string> = {
  1: "W", // Whole
  2: "H", // Half
  4: "Q", // Quarter
  8: "E", // Eighth
  16: "S", // Sixteenth
  32: "T", // Thirty-second
};

const GP_PITCH_MAP: Record<number, string> = {
  1: "C",
  2: "D",
  3: "E",
  4: "F",
  5: "G",
  6: "A",
  7: "B",
};

export function convertToGP(data: RecognitionResult): string {
  const lines: string[] = [];

  lines.push(`Title: ${data.title || "Untitled"}`);
  lines.push(`Artist: ${data.composer || "Unknown"}`);
  lines.push(`Key: ${data.key_signature || "C"}`);
  lines.push(`Time: ${data.time_signature || "4/4"}`);
  if (data.tempo) lines.push(`Tempo: ${data.tempo}`);
  lines.push("");
  lines.push("--- Notation ---");
  lines.push("");

  data.measures.forEach((measure, mIdx) => {
    const parts: string[] = [];
    parts.push(`| M${mIdx + 1} `);

    if (measure.repeat_start) parts.push("[ ");

    measure.notes.forEach((note) => {
      const dur = GP_DURATION_MAP[note.duration] || "Q";

      if (note.pitch === null) {
        parts.push(`R${dur} `);
      } else {
        let pitchStr = GP_PITCH_MAP[note.pitch] || "C";
        if (note.accidental === "sharp") pitchStr += "#";
        else if (note.accidental === "flat") pitchStr += "b";

        // Octave
        const octaveNum = note.octave === 1 ? 5 : note.octave === 2 ? 3 : 4;
        parts.push(`${pitchStr}${octaveNum}${dur} `);
      }

      if (note.dots > 0) parts.push(". ");
      if (note.tie_start) parts.push("- ");
      if (note.lyrics) parts.push(`"${note.lyrics}" `);
    });

    if (measure.repeat_end) parts.push("] ");

    lines.push(parts.join(""));
  });

  lines.push("");
  lines.push("--- End ---");

  return lines.join("\n");
}

// ============================================================
// 格式化识别结果为可读文本
// ============================================================

export function formatResultAsText(data: RecognitionResult): string {
  const lines: string[] = [];

  lines.push("=== 简谱识别结果 ===");
  lines.push("");

  if (data.title) lines.push(`曲名: ${data.title}`);
  if (data.key_signature) lines.push(`调号: ${data.key_signature}`);
  if (data.time_signature) lines.push(`拍号: ${data.time_signature}`);
  if (data.tempo) lines.push(`速度: ${data.tempo}`);
  if (data.composer) lines.push(`作曲: ${data.composer}`);
  if (data.lyricist) lines.push(`作词: ${data.lyricist}`);

  lines.push("");
  lines.push("--- 音符序列 ---");
  lines.push("");

  const noteNames: Record<number, string> = {
    1: "do",
    2: "re",
    3: "mi",
    4: "fa",
    5: "sol",
    6: "la",
    7: "si",
  };

  const durationNames: Record<number, string> = {
    1: "全音符",
    2: "二分音符",
    4: "四分音符",
    8: "八分音符",
    16: "十六分音符",
  };

  const octaveNames: Record<number, string> = {
    0: "中音",
    1: "高音",
    2: "低音",
  };

  data.measures.forEach((measure, mIdx) => {
    const notesStr = measure.notes
      .map((note) => {
        if (note.pitch === null) return "0(休止)";
        let s = `${note.pitch}(${noteNames[note.pitch] || "?"})`;
        if (note.octave !== 0) s += `[${octaveNames[note.octave] || ""}]`;
        if (note.accidental) s += `{${note.accidental}}`;
        s += ` ${durationNames[note.duration] || `${note.duration}`}`;
        if (note.dots > 0) s += "附点";
        if (note.tie_start) s += "连";
        if (note.lyrics) s += ` "${note.lyrics}"`;
        return s;
      })
      .join("  ");

    lines.push(`第${mIdx + 1}小节: ${notesStr}`);
  });

  return lines.join("\n");
}

// ============================================================
// 文件下载辅助
// ============================================================

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
