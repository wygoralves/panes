export interface MarkdownParseWorkerRequest {
  id: number;
  markdown: string;
}

export interface MarkdownParseWorkerSuccessResponse {
  id: number;
  ok: true;
  html: string;
}

export interface MarkdownParseWorkerErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type MarkdownParseWorkerResponse =
  | MarkdownParseWorkerSuccessResponse
  | MarkdownParseWorkerErrorResponse;

