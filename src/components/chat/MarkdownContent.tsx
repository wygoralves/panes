import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { recordPerfMetric } from "../../lib/perfTelemetry";
import type {
  MarkdownParseWorkerRequest,
  MarkdownParseWorkerResponse,
} from "../../workers/markdownParser.types";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];
const MARKDOWN_WORKER_THRESHOLD_CHARS = 1000;
const MARKDOWN_CACHE_LIMIT = 280;

const markdownHtmlCache = new Map<string, string>();
let markdownWorkerInstance: Worker | null = null;
let markdownWorkerRequestSeq = 0;
const markdownWorkerCallbacks = new Map<
  number,
  {
    resolve: (value: string) => void;
    reject: (reason?: unknown) => void;
  }
>();

function computeCacheKey(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}

function readCachedMarkdownHtml(cacheKey: string): string | null {
  const html = markdownHtmlCache.get(cacheKey);
  if (html === undefined) {
    return null;
  }

  markdownHtmlCache.delete(cacheKey);
  markdownHtmlCache.set(cacheKey, html);
  return html;
}

function writeCachedMarkdownHtml(cacheKey: string, html: string) {
  if (markdownHtmlCache.has(cacheKey)) {
    markdownHtmlCache.delete(cacheKey);
  }
  markdownHtmlCache.set(cacheKey, html);
  while (markdownHtmlCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownHtmlCache.keys().next().value;
    if (!oldest) {
      break;
    }
    markdownHtmlCache.delete(oldest);
  }
}

function ensureMarkdownWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  if (!markdownWorkerInstance) {
    markdownWorkerInstance = new Worker(
      new URL("../../workers/markdownParser.worker.ts", import.meta.url),
      { type: "module" },
    );
    markdownWorkerInstance.onmessage = (
      event: MessageEvent<MarkdownParseWorkerResponse>,
    ) => {
      const payload = event.data;
      const callback = markdownWorkerCallbacks.get(payload.id);
      if (!callback) {
        return;
      }
      markdownWorkerCallbacks.delete(payload.id);
      if (payload.ok) {
        callback.resolve(payload.html);
      } else {
        callback.reject(new Error(payload.error));
      }
    };
    markdownWorkerInstance.onerror = (error) => {
      for (const callback of markdownWorkerCallbacks.values()) {
        callback.reject(error);
      }
      markdownWorkerCallbacks.clear();
      markdownWorkerInstance?.terminate();
      markdownWorkerInstance = null;
    };
  }
  return markdownWorkerInstance;
}

function parseMarkdownInWorker(markdown: string): Promise<string> {
  const worker = ensureMarkdownWorker();
  if (!worker) {
    return Promise.reject(new Error("worker-unavailable"));
  }

  return new Promise((resolve, reject) => {
    markdownWorkerRequestSeq += 1;
    const requestId = markdownWorkerRequestSeq;
    markdownWorkerCallbacks.set(requestId, { resolve, reject });
    const payload: MarkdownParseWorkerRequest = {
      id: requestId,
      markdown,
    };
    worker.postMessage(payload);
  });
}

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
  const [workerHtml, setWorkerHtml] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState(false);
  const parseStartedAtRef = useRef(0);

  const workerEligible = content.length >= MARKDOWN_WORKER_THRESHOLD_CHARS;
  const cacheKey = useMemo(() => computeCacheKey(content), [content]);

  useEffect(() => {
    if (!workerEligible) {
      setWorkerHtml(null);
      setWorkerError(false);
      return;
    }

    const cached = readCachedMarkdownHtml(cacheKey);
    if (cached !== null) {
      setWorkerHtml(cached);
      setWorkerError(false);
      return;
    }

    let disposed = false;
    setWorkerHtml(null);
    setWorkerError(false);
    parseStartedAtRef.current = performance.now();

    parseMarkdownInWorker(content)
      .then((html) => {
        if (disposed) {
          return;
        }
        writeCachedMarkdownHtml(cacheKey, html);
        setWorkerHtml(html);
        recordPerfMetric("chat.markdown.worker.ms", performance.now() - parseStartedAtRef.current, {
          chars: content.length,
          cached: false,
        });
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setWorkerError(true);
      });

    return () => {
      disposed = true;
    };
  }, [cacheKey, content, workerEligible]);

  if (workerEligible && !workerError) {
    if (workerHtml === null) {
      return (
        <div className={className} style={style}>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
            }}
          >
            {content}
          </pre>
        </div>
      );
    }

    return (
      <div
        className={className}
        style={style}
        dangerouslySetInnerHTML={{ __html: workerHtml }}
      />
    );
  }

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
