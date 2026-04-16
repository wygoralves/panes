// Minimal YAML-ish frontmatter helpers for meeting documents.
// We only support flat `key: value` pairs inside `---` fences; that's all
// the meetings feature writes. Anything more sophisticated belongs in a
// real YAML parser if we ever need it.

const FRONTMATTER_RE = /^(---\n)([\s\S]*?)(\n---\n)/;

export function parseFrontmatterValue(
  content: string,
  key: string,
): string | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const prefix = `${key}:`;
  for (const line of match[2].split("\n")) {
    if (line.trim().startsWith(prefix)) {
      return line.trim().slice(prefix.length).trim();
    }
  }
  return null;
}

export function updateFrontmatterValue(
  content: string,
  key: string,
  value: string,
): string {
  const match = content.match(FRONTMATTER_RE);
  const keyLine = (v: string) => `${key}: ${v}`;
  if (!match) {
    if (!value) return content;
    return `---\n${keyLine(value)}\n---\n\n${content}`;
  }
  const [full, open, body, close] = match;
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}:`));
  if (!value) {
    if (idx >= 0) lines.splice(idx, 1);
  } else if (idx >= 0) {
    lines[idx] = keyLine(value);
  } else {
    lines.push(keyLine(value));
  }
  return content.replace(full, `${open}${lines.join("\n")}${close}`);
}
