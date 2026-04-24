const MARKDOWN_PREVIEW_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

export function isMarkdownPreviewFile(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension ? MARKDOWN_PREVIEW_EXTENSIONS.has(extension) : false;
}
