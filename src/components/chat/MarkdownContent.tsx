import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

interface MarkdownContentProps {
  content: string;
  className?: string;
  style?: CSSProperties;
}

export default function MarkdownContent({
  content,
  className,
  style,
}: MarkdownContentProps) {
  return (
    <div className={className} style={style}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
