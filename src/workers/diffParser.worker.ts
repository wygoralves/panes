/// <reference lib="webworker" />

import {
  extractDiffFilename,
  parseDiff,
  type ParsedLine,
} from "../lib/parseDiff";
import type {
  DiffParseWorkerRequest,
  DiffParseWorkerResponse,
} from "./diffParser.types";

self.onmessage = (event: MessageEvent<DiffParseWorkerRequest>) => {
  const { id, raw } = event.data;
  const parsed = parseDiff(raw);

  let adds = 0;
  let dels = 0;
  for (const line of parsed) {
    if (line.type === "add") {
      adds += 1;
      continue;
    }
    if (line.type === "del") {
      dels += 1;
    }
  }

  const payload: DiffParseWorkerResponse = {
    id,
    parsed,
    filename: extractDiffFilename(raw),
    adds,
    dels,
  };
  self.postMessage(payload);
};

export {};
