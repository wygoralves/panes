import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import DOMPurify from "dompurify";
import { recordPerfMetric } from "../../lib/perfTelemetry";
import {
  classifyLinkTarget,
  getWorkspacePaneLeafIdFromEventTarget,
  navigateLinkTarget,
} from "../../lib/fileLinkNavigation";
import { renderMarkdownToHtml } from "../../workers/markdownParserCore";
import type {
  MarkdownParseWorkerRequest,
  MarkdownParseWorkerResponse,
} from "../../workers/markdownParser.types";

const MARKDOWN_WORKER_THRESHOLD_CHARS = 1000;
const MARKDOWN_CACHE_LIMIT = 280;
const MARKDOWN_CACHE_MAX_BYTES = 8 * 1024 * 1024;

const markdownHtmlCache = new Map<string, string>();
let markdownHtmlCacheBytes = 0;
let markdownWorkerInstance: Worker | null = null;
let markdownWorkerRequestSeq = 0;
const markdownWorkerCallbacks = new Map<
  number,
  {
    resolve: (value: string) => void;
    reject: (reason?: unknown) => void;
  }
>();

// Admits web, mail, phone and file links, fragments, relative paths and the
// local file references the linkifier emits (`src/a.ts:12`, `README.md:4`,
// `Makefile:12`, `C:\repo\a.ts`, `\\server\share`). Any other scheme, and
// protocol-relative `//host` links, are dropped. A bare `name:line[:col]` can
// only evaluate a number even if a browser reads `name` as a scheme.
export const MARKDOWN_ALLOWED_URI_RE =
  /^(?!\/[\\/]|\\\/)(?:(?:https?|mailto|tel|file):|[a-z]:[\\/]|[^a-z]|[a-z][a-z0-9+.-]*(?:[^a-z0-9+.:-]|$)|[a-z0-9+-]*\.[a-z0-9+.-]*:\d|[a-z][a-z0-9+.-]*:\d+(?::\d+)?$)/i;

// The markdown parser already encodes raw HTML. This is the last barrier
// before the HTML reaches the DOM, so a parser bug cannot run script.
function sanitizeMarkdownHtml(html: string): string {
  if (!DOMPurify.isSupported) {
    // With no DOM at all (server rendering in tests) nothing can execute the
    // markup. A DOM that DOMPurify cannot use gets no markup at all.
    return typeof document === "undefined" ? html : "";
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: MARKDOWN_ALLOWED_URI_RE,
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

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

function peekCachedMarkdownHtml(cacheKey: string): string | null {
  return markdownHtmlCache.get(cacheKey) ?? null;
}

function writeCachedMarkdownHtml(cacheKey: string, html: string) {
  const nextEntryBytes = estimateCacheEntryBytes(cacheKey, html);
  const existing = markdownHtmlCache.get(cacheKey);
  if (markdownHtmlCache.has(cacheKey)) {
    if (existing !== undefined) {
      markdownHtmlCacheBytes -= estimateCacheEntryBytes(cacheKey, existing);
    }
    markdownHtmlCache.delete(cacheKey);
  }
  markdownHtmlCache.set(cacheKey, html);
  markdownHtmlCacheBytes += nextEntryBytes;
  while (
    markdownHtmlCache.size > MARKDOWN_CACHE_LIMIT ||
    markdownHtmlCacheBytes > MARKDOWN_CACHE_MAX_BYTES
  ) {
    const oldestKey = markdownHtmlCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const oldestHtml = markdownHtmlCache.get(oldestKey);
    if (oldestHtml !== undefined) {
      markdownHtmlCacheBytes -= estimateCacheEntryBytes(oldestKey, oldestHtml);
    }
    markdownHtmlCache.delete(oldestKey);
  }

  if (markdownHtmlCacheBytes < 0) {
    markdownHtmlCacheBytes = 0;
  }
}

function estimateCacheEntryBytes(cacheKey: string, html: string): number {
  return (cacheKey.length + html.length) * 2;
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
  streaming?: boolean;
}

interface MarkdownWorkerPlaceholderOptions {
  hasStreamed: boolean;
  streaming: boolean;
  workerEligible: boolean;
  workerError: boolean;
  workerHtml: string | null;
}

export function shouldRenderMarkdownWorkerPlaceholder({
  hasStreamed,
  streaming,
  workerEligible,
  workerError,
  workerHtml,
}: MarkdownWorkerPlaceholderOptions): boolean {
  return (
    workerEligible &&
    !streaming &&
    !hasStreamed &&
    !workerError &&
    workerHtml === null
  );
}

export function handleMarkdownLinkClick(event: ReactMouseEvent<HTMLDivElement>): void {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }

  const target = event.target;
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  if (!element) {
    return;
  }

  const anchor = element.closest("a");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  const rawHref = anchor.getAttribute("href");
  if (!rawHref) {
    return;
  }

  const targetKind = classifyLinkTarget(rawHref);
  if (targetKind === "other") {
    // In-page fragments (footnotes) keep their default scroll. Anything else
    // would navigate the app window away from Panes.
    if (!rawHref.startsWith("#")) {
      event.preventDefault();
    }
    return;
  }

  event.preventDefault();
  if (targetKind === "local") {
    event.stopPropagation();
  }
  void navigateLinkTarget(rawHref, {
    shiftKey: event.shiftKey,
    sourceLeafId: getWorkspacePaneLeafIdFromEventTarget(event.currentTarget),
  });
}

// A middle click on a link would open it in a new webview window.
export function handleMarkdownLinkAuxClick(event: ReactMouseEvent<HTMLDivElement>): void {
  const target = event.target;
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  if (element?.closest("a")) {
    event.preventDefault();
  }
}

export default function MarkdownContent({
  content,
  className,
  style,
  streaming = false,
}: MarkdownContentProps) {
  const [workerHtml, setWorkerHtml] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState(false);
  const parseStartedAtRef = useRef(0);
  const hasStreamedRef = useRef(streaming);

  const workerEligible = content.length >= MARKDOWN_WORKER_THRESHOLD_CHARS;
  const cacheKey = useMemo(() => computeCacheKey(content), [content]);
  const hasStreamed = hasStreamedRef.current || streaming;
  const cachedHtml = useMemo(() => peekCachedMarkdownHtml(cacheKey), [cacheKey]);
  const showWorkerPlaceholder = shouldRenderMarkdownWorkerPlaceholder({
    hasStreamed,
    streaming,
    workerEligible,
    workerError,
    workerHtml,
  }) && cachedHtml === null;

  const immediateHtml = useMemo(() => {
    if (cachedHtml !== null) {
      return cachedHtml;
    }
    if (showWorkerPlaceholder) {
      return null;
    }
    return sanitizeMarkdownHtml(renderMarkdownToHtml(content));
  }, [cachedHtml, content, showWorkerPlaceholder]);

  useEffect(() => {
    if (!streaming) {
      return;
    }
    hasStreamedRef.current = true;
  }, [streaming]);

  useEffect(() => {
    if (immediateHtml === null) {
      return;
    }
    writeCachedMarkdownHtml(cacheKey, immediateHtml);
  }, [cacheKey, immediateHtml]);

  useEffect(() => {
    if (!workerEligible || streaming || hasStreamed) {
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
      .then((rawHtml) => {
        if (disposed) {
          return;
        }
        const html = sanitizeMarkdownHtml(rawHtml);
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
  }, [cacheKey, content, hasStreamed, streaming, workerEligible]);

  const wrapperClassName = streaming
    ? `${className ? `${className} ` : ""}md-streaming`
    : className;

  if (showWorkerPlaceholder) {
    return (
      <div className={wrapperClassName} style={style}>
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

  const html = workerEligible && !streaming && !hasStreamed && workerHtml !== null
    ? workerHtml
    : immediateHtml;

  if (html === null) {
    return (
      <div className={wrapperClassName} style={style}>
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
      className={wrapperClassName}
      style={style}
      onClickCapture={handleMarkdownLinkClick}
      onAuxClick={handleMarkdownLinkAuxClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
