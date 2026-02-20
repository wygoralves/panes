export interface ParsedLine {
  type: "add" | "del" | "context" | "hunk";
  content: string;
  gutter: string;
  lineNum: string;
}

export function parseDiff(raw: string): ParsedLine[] {
  const lines = raw.split("\n");
  const result: ParsedLine[] = [];
  let newLine = 0;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      newLine = match ? parseInt(match[1], 10) : 0;
      const hunkLabel = line.replace(/^@@[^@]*@@\s?/, "").trim();
      result.push({ type: "hunk", content: hunkLabel, gutter: "", lineNum: "" });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), gutter: "+", lineNum: String(newLine) });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "del", content: line.slice(1), gutter: "-", lineNum: "" });
    } else {
      result.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line, gutter: "", lineNum: String(newLine || "") });
      if (newLine) newLine++;
    }
  }
  return result;
}

export const LINE_CLASS: Record<string, string> = {
  add: "git-diff-add",
  del: "git-diff-del",
  hunk: "git-diff-hunk",
  context: "",
};

export function extractDiffFilename(raw: string): string | null {
  const lines = raw.split("\n");
  let count = 0;
  let filename: string | null = null;

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      count++;
      if (count === 1) {
        filename = match[2];
      } else {
        return null;
      }
    }
  }

  return filename;
}
