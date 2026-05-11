const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface ChatRequest {
  message: string;
  session_id?: string;
  doc_id?: string;
  verbose?: boolean;
}

export interface SessionInfo {
  session_id: string;
  doc_id?: string;
  doc_name?: string;
  title?: string;
  created_at?: string;
}

export interface SessionMessage {
  type: string;
  content: string;
  tool_calls?: { name: string; args: Record<string, unknown> }[];
  usage_metadata?: Record<string, unknown>;
}

export async function fetchJSON<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetchJSON(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await fetchJSON(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export interface NovelInfo {
  doc_id: string;
  doc_name: string;
  doc_description?: string;
  chapter_count?: number;
}

export async function fetchNovels(): Promise<NovelInfo[]> {
  return fetchJSON<NovelInfo[]>("/novels");
}

export function streamChat(
  req: ChatRequest,
): { stream: ReadableStream<Uint8Array>; cancel: () => void } {
  const controller = new AbortController();
  const promise = fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: controller.signal,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const res = await promise;
      if (!res.body) {
        ctrl.close();
        return;
      }
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          ctrl.enqueue(value);
        }
        ctrl.close();
      } catch (e) {
        ctrl.error(e);
      }
    },
  });

  return {
    stream,
    cancel: () => controller.abort(),
  };
}
