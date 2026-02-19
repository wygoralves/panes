export interface SidecarRequest {
  type: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface SidecarResponse {
  type: "response";
  id: string;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export interface SidecarNotify {
  type: "notify";
  method: string;
  params?: Record<string, unknown>;
}

export type SidecarMessage = SidecarRequest | SidecarResponse | SidecarNotify;
