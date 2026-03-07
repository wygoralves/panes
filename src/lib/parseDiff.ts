export interface ParsedLine {
  type: "add" | "del" | "context" | "hunk" | "meta";
  content: string;
  gutter: string;
  lineNum: string;
}

interface DiffSection {
  header: ParsedLine | null;
  metadata: ParsedLine[];
  body: ParsedLine[];
}

function createDiffSection(): DiffSection {
  return {
    header: null,
    metadata: [],
    body: [],
  };
}

function createMetaLine(content: string): ParsedLine {
  return {
    type: "meta",
    content,
    gutter: "",
    lineNum: "",
  };
}

function isFileHeaderLine(line: string): boolean {
  return line.startsWith("--- ") || line.startsWith("+++ ");
}

function isStructuralMetadataLine(line: string): boolean {
  return (
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity") ||
    line.startsWith("dissimilarity") ||
    line.startsWith("rename") ||
    line.startsWith("copy ") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode")
  );
}

function flushSection(
  section: DiffSection,
  result: ParsedLine[],
  showHeaderForBodySections: boolean,
) {
  const hasHeader = Boolean(section.header);
  const hasMetadata = section.metadata.length > 0;
  const hasBody = section.body.length > 0;

  if (!hasHeader && !hasMetadata && !hasBody) {
    return;
  }

  if (section.header && (hasMetadata || !hasBody || showHeaderForBodySections)) {
    result.push(section.header);
  }
  if (hasMetadata) {
    result.push(...section.metadata);
  }
  if (hasBody) {
    result.push(...section.body);
  }
}

export function parseDiff(raw: string): ParsedLine[] {
  if (raw.length === 0) {
    return [];
  }
  const lines = raw.split("\n");
  const showFileHeaders = lines.filter((line) => line.startsWith("diff --git")).length > 1;
  const result: ParsedLine[] = [];
  let section = createDiffSection();
  let newLine = 0;

  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("diff --git")) {
      flushSection(section, result, showFileHeaders);
      section = createDiffSection();
      section.header = createMetaLine(line);
      newLine = 0;
      continue;
    }

    if (line.startsWith("index ")) {
      continue;
    }

    if (section.body.length === 0 && isFileHeaderLine(line)) {
      continue;
    }

    if (isStructuralMetadataLine(line)) {
      section.metadata.push(createMetaLine(line));
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      newLine = match ? parseInt(match[1], 10) : 0;
      const hunkLabel = line.replace(/^@@[^@]*@@\s?/, "").trim();
      section.body.push({
        type: "hunk",
        content: hunkLabel,
        gutter: "",
        lineNum: "",
      });
    } else if (line.startsWith("+")) {
      section.body.push({
        type: "add",
        content: line.slice(1),
        gutter: "+",
        lineNum: String(newLine),
      });
      newLine++;
    } else if (line.startsWith("-")) {
      section.body.push({
        type: "del",
        content: line.slice(1),
        gutter: "-",
        lineNum: "",
      });
    } else {
      section.body.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        gutter: "",
        lineNum: String(newLine || ""),
      });
      if (newLine) newLine++;
    }
  }

  flushSection(section, result, showFileHeaders);
  return result;
}

export const LINE_CLASS: Record<string, string> = {
  add: "git-diff-add",
  del: "git-diff-del",
  hunk: "git-diff-hunk",
  meta: "git-diff-meta",
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
