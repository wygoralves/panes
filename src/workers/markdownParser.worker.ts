/// <reference lib="webworker" />

import type {
  MarkdownParseWorkerRequest,
  MarkdownParseWorkerResponse,
} from "./markdownParser.types";
import { renderMarkdownToHtml } from "./markdownParserCore";

self.onmessage = (event: MessageEvent<MarkdownParseWorkerRequest>) => {
  const payload = event.data;
  let response: MarkdownParseWorkerResponse;

  try {
    response = {
      id: payload.id,
      ok: true,
      html: renderMarkdownToHtml(payload.markdown),
    };
  } catch (error) {
    response = {
      id: payload.id,
      ok: false,
      error: String(error),
    };
  }

  self.postMessage(response);
};

