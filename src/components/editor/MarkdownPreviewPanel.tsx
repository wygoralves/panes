import MarkdownContent from "../chat/MarkdownContent";

interface Props {
  content: string;
}

export function MarkdownPreviewPanel({ content }: Props) {
  return (
    <div className="editor-markdown-preview">
      <div className="editor-markdown-preview-scroll">
        <MarkdownContent
          content={content}
          className="prose editor-markdown-preview-prose"
        />
      </div>
    </div>
  );
}
