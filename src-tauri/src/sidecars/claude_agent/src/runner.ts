import type { SidecarNotify, SidecarRequest, SidecarResponse } from "./protocol";

export async function handleRequest(request: SidecarRequest): Promise<SidecarResponse[]> {
  if (request.method === "start_session") {
    return [
      {
        type: "response",
        id: request.id,
        result: { sessionId: `claude-${Date.now()}` }
      }
    ];
  }

  if (request.method === "send_message") {
    const events: SidecarNotify[] = [
      { type: "notify", method: "turn_started", params: {} },
      {
        type: "notify",
        method: "text_delta",
        params: {
          content: "Claude sidecar scaffold active. SDK integration pending."
        }
      },
      { type: "notify", method: "turn_completed", params: {} }
    ];

    return [
      {
        type: "response",
        id: request.id,
        result: { ok: true }
      },
      ...events.map((event) => ({
        type: "response",
        id: `${request.id}:notify:${event.method}`,
        result: event
      }))
    ];
  }

  return [
    {
      type: "response",
      id: request.id,
      error: { message: `unknown method: ${request.method}` }
    }
  ];
}
