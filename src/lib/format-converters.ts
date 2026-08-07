/**
 * Format converters: RecognitionResult → MusicXML / Jianpu Text / Guitar Pro
 */

export interface RecognitionResult {
  title: string;
  key_signature: string;
  time_signature: string;
  tempo: string;
  composer: string;
  lyricist: string;
  measures: {
    notes: {
      pitch: number | null;
      duration: number;
      dots: number;
      octave: number;
      accidental: string | null;
      tie_start: boolean;
      tie_end: boolean;
      slur_start: boolean;
      slur_end: boolean;
      lyrics: string | null;
    }[];
    repeat_start?: boolean;
    repeat_end?: boolean;
  }[];
}

const PITCH_TO_STEP: Record<string, string> = {
  "1": "C",
  "2": "D",
  "3": "E",
  "4": "F",
  "5": "G",
  "6": "A",
  "7": "B",
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function keySignatureToFifths(key: string): number {
  const map: Record<string, number> = {
    "C": 0, "Am": 0,
    "G": 1, "Em": 1,
    "D": 2, "Bm": 2,
    "A": 3, "F#m": 3,
    "E": 4, "C#m": 4,
    "B": 5, "G#m": 5,
    "F#": 6, "D#m": 6,
    "C#": 7, "A#m": 7,
    "F": -1, "Dm": -1,
    "Bb": -2, "Gm": -2,
    "Eb": -3, "Cm": -3,
    "Ab": -4, "Fm": -4,
    "Db": -5, "Bbm": -5,
    "Gb": -6, "Ebm": -6,
    "Cb": -7, "Abm": -7,
  };
  return map[key] ?? 0;
}

function durationToType(duration: number): string {
  switch (duration) {
    case 1: return "whole";
    case 2: return "half";
    case 4: return "quarter";
    case 8: return "eighth";
    case 16: return "16th";
    case 32: return "32nd";
    default: return "quarter";
  }
}

function durationToTicks(duration: number, divisions: number): number {
  const quarterRatio = 4 / duration;
  return Math.round(divisions * quarterRatio);
}

function dotsToDurationAddition(dots: number, baseTicks: number): number {
  let addition = 0;
  let value = baseTicks;
  for (let i = 0; i < dots; i++) {
    value = value / 2;
    addition += value;
  }
  return Math.round(addition);
}

function noteToPitch(note: { pitch: number | null; octave: number; accidental: string | null }): { step: string; alter: number | null; octave: number } {
  if (note.pitch === null) {
    return { step: "C", alter: null, octave: 4 };
  }
  const step = PITCH_TO_STEP[String(note.pitch)] || "C";

  // Base octave: jianpu middle octave (1=C) maps to C4
  // octave: 0=中音(C4), 1=高音(C5), 2=低音(C3)
  let octave = 4;
  if (note.octave === 1) octave = 5; // 高音
  else if (note.octave === 2) octave = 3; // 低音

  let alter: number | null = null;
  if (note.accidental === "sharp") alter = 1;
  else if (note.accidental === "flat") alter = -1;
  else if (note.accidental === "natural") alter = 0;

  return { step, alter, octave };
}

export function convertToMusicXml(data: RecognitionResult): string {
  const divisions = 4;
  const timeParts = data.time_signature.split("/");
  const beats = parseInt(timeParts[0]) || 4;
  const beatType = parseInt(timeParts[1]) || 4;
  const keyFifths = keySignatureToFifths(data.key_signature);

  // Determine key mode
  const isMinor = /[a-z]/.test(data.key_signature) || data.key_signature.endsWith("m");
  const keyMode = isMinor ? "minor" : "major";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${escapeXml(data.title || "Untitled")}</work-title>
  </work>
  <identification>
    <creator type="composer">${escapeXml(data.composer)}</creator>
    <creator type="lyricist">${escapeXml(data.lyricist)}</creator>
    <encoding>
      <software>Jianpu Recognizer</software>
      <encoding-date>${new Date().toISOString().split("T")[0]}</encoding-date>
    </encoding>
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

    // Attributes in first measure
    if (mIdx === 0) {
      xml += `      <attributes>
        <divisions>${divisions}</divisions>
        <key>
          <fifths>${keyFifths}</fifths>
          <mode>${keyMode}</mode>
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
        xml += `      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
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
    if (measure.repeat_end) {
      xml += `      <barline location="right">
        <bar-style>light-heavy</bar-style>
        <repeat direction="backward"/>
      </barline>\n`;
    }

    // Notes
    measure.notes.forEach((note) => {
      const ticks = durationToTicks(note.duration, divisions);
      const dotAdd = dotsToDurationAddition(note.dots, ticks);
      const totalDuration = ticks + dotAdd;

      if (note.pitch === null) {
        // Rest
        xml += `      <note>
        <rest/>
        <duration>${totalDuration}</duration>
        <voice>1</voice>
        <type>${durationToType(note.duration)}</type>
        <staff>1</staff>\n`;
        for (let i = 0; i < note.dots; i++) {
          xml += `        <dot/>\n`;
        }
        xml += `      </note>\n`;
      } else {
        const pitchInfo = noteToPitch(note);

        // Build note element with correct MusicXML element order:
        // pitch, duration, voice, type, dot*, stem, accidental, tie*, notation*
        xml += `      <note>
        <pitch>
          <step>${pitchInfo.step}</step>`;
        if (pitchInfo.alter !== null) {
          xml += `
          <alter>${pitchInfo.alter}</alter>`;
        }
        xml += `
          <octave>${pitchInfo.octave}</octave>
        </pitch>
        <duration>${totalDuration}</duration>
        <voice>1</voice>
        <type>${durationToType(note.duration)}</type>
        <staff>1</staff>\n`;

        // Dots
        for (let i = 0; i < note.dots; i++) {
          xml += `        <dot/>\n`;
        }

        // Accidental (must come after type/dots)
        if (note.accidental && note.accidental !== "") {
          xml += `        <accidental>${note.accidental}</accidental>\n`;
        }

        // Ties
        if (note.tie_start) {
          xml += `        <tie type="start"/>\n`;
        }
        if (note.tie_end) {
          xml += `        <tie type="stop"/>\n`;
        }

        // Notations (combine ties, slurs, etc.)
        const notationParts: string[] = [];
        if (note.tie_start) {
          notationParts.push(`<tied type="start"/>`);
        }
        if (note.tie_end) {
          notationParts.push(`<tied type="stop"/>`);
        }
        if (note.slur_start) {
          notationParts.push(`<slur type="start"/>`);
        }
        if (note.slur_end) {
          notationParts.push(`<slur type="stop"/>`);
        }
        if (notationParts.length > 0) {
          xml += `        <notations>\n`;
          notationParts.forEach((n) => {
            xml += `          ${n}\n`;
          });
          xml += `        </notations>\n`;
        }

        // Lyrics
        if (note.lyrics && note.lyrics !== "") {
          xml += `        <lyric number="1">
          <syllabic>single</syllabic>
          <text>${escapeXml(note.lyrics)}</text>
        </lyric>\n`;
        }

        xml += `      </note>\n`;
      }
    });

    xml += `    </measure>\n`;
  });

  xml += `  </part>
</score-partwise>
`;

  return xml;
}

export function convertToJianpu(data: RecognitionResult): string {
  let text = "";
  if (data.title) text += `曲名：${data.title}\n`;
  if (data.key_signature) text += `调号：${data.key_signature}\n`;
  if (data.time_signature) text += `拍号：${data.time_signature}\n`;
  if (data.tempo) text += `速度：${data.tempo}\n`;
  if (data.composer) text += `作曲：${data.composer}\n`;
  if (data.lyricist) text += `作词：${data.lyricist}\n`;
  text += "\n";

  data.measures.forEach((measure, mIdx) => {
    if (mIdx > 0 && mIdx % 4 === 0) text += "\n";
    if (measure.repeat_start) text += "|:";
    else if (mIdx > 0) text += "| ";

    measure.notes.forEach((note) => {
      if (note.pitch === null) {
        text += "0";
      } else {
        if (note.accidental === "sharp") text += "#";
        if (note.accidental === "flat") text += "b";
        text += String(note.pitch);
      }

      // Octave dots
      if (note.octave === 1) text += "̇"; // high octave dot above (combining dot above)
      if (note.octave === 2) text += "̣"; // low octave dot below (combining dot below)

      // Duration dashes
      if (note.duration <= 2) text += "-";
      if (note.duration === 1) text += "--";

      // Dots
      if (note.dots > 0) text += ".";

      // Tie
      if (note.tie_start) text += "─";

      // Slur
      if (note.slur_start) text += "(";
      if (note.slur_end) text += ")";

      // Lyrics
      if (note.lyrics && note.lyrics !== "") text += `[${note.lyrics}]`;

      text += " ";
    });

    if (measure.repeat_end) text += ":|";
  });

  return text.trim();
}

export function convertToGP(data: RecognitionResult): string {
  let text = "";
  if (data.title) text += `Title: ${data.title}\n`;
  if (data.key_signature) text += `Key: ${data.key_signature}\n`;
  if (data.time_signature) text += `Time: ${data.time_signature}\n`;
  if (data.tempo) text += `Tempo: ${data.tempo}\n`;
  text += "\n";

  const pitchToName: Record<string, string> = {
    "1": "C", "2": "D", "3": "E", "4": "F",
    "5": "G", "6": "A", "7": "B",
  };

  data.measures.forEach((measure, mIdx) => {
    text += `Measure ${mIdx + 1}:\n`;
    measure.notes.forEach((note) => {
      if (note.pitch === null) {
        text += `  rest(${note.duration})`;
      } else {
        const name = pitchToName[String(note.pitch)] || "?";
        const oct = note.octave === 1 ? "+" : note.octave === 2 ? "-" : "";
        const acc = note.accidental === "sharp" ? "#" : note.accidental === "flat" ? "b" : "";
        text += `  ${name}${acc}${oct}(${note.duration})`;
        if (note.dots > 0) text += ".";
        if (note.tie_start) text += " tie";
        if (note.lyrics) text += ` [${note.lyrics}]`;
      }
      text += "\n";
    });
  });

  return text;
}

export function formatResultAsText(data: RecognitionResult): string {
  return convertToJianpu(data);
}

export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
