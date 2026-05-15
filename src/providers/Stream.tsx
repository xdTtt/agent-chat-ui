import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LangGraphLogoSVG } from "@/components/icons/langgraph";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { useThreads } from "./Thread";
import { toast } from "sonner";
import type { Message } from "@langchain/langgraph-sdk";
import { streamChat, fetchJSON, type SessionMessage } from "./api-client";

export type StateType = { messages: Message[] };

export interface MessageMetadata {
  branch?: string;
  branchOptions?: string[];
  firstSeenState?: { parent_checkpoint?: unknown } | null;
}

interface StreamContextType {
  messages: Message[];
  isLoading: boolean;
  error: unknown;
  threadId: string | null;
  values: Record<string, unknown>;
  submit: (
    input: { messages?: Message[] } | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => void;
  stop: () => void;
  interrupt: unknown;
  getMessagesMetadata: (message: Message) => MessageMetadata | null;
  setBranch: (branch: string) => void;
}

const StreamContext = createContext<StreamContextType | undefined>(undefined);

const DEFAULT_API_URL = "http://localhost:8000/api";

async function checkServerStatus(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function StreamSession({ children, apiUrl }: { children: ReactNode; apiUrl: string }) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads } = useThreads();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const skipReloadRef = useRef(false);

  useEffect(() => {
    checkServerStatus(apiUrl).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to chat server", {
          description: () => (
            <p>
              Please ensure the server is running at <code>{apiUrl}</code>
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiUrl]);

  // Load messages when switching to an existing session
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    if (skipReloadRef.current) {
      skipReloadRef.current = false;
      return;
    }
    fetchJSON<SessionMessage[]>(`/sessions/${threadId}/messages`)
      .then((data) => {
        const loaded = data
          .filter((m) => m.type === "human" || m.type === "ai" || m.type === "tool")
          .map((m): Message => {
            if (m.type === "human") {
              return { id: crypto.randomUUID(), type: "human", content: m.content } as Message;
            }
            if (m.type === "tool") {
              return {
                id: crypto.randomUUID(),
                type: "tool",
                content: m.content,
                name: (m as any).name || "tool",
                tool_call_id: "",
              } as Message;
            }
            return {
              id: crypto.randomUUID(),
              type: "ai",
              content: m.content,
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
              ...(m.usage_metadata ? { usage_metadata: m.usage_metadata } : {}),
            } as Message;
          });
        setMessages(loaded);
      })
      .catch(() => setMessages([]));
  }, [threadId]);

  const submit = useCallback(
    (input: { messages?: Message[] } | Record<string, unknown>, _options?: Record<string, unknown>) => {
      const msgs = (input as { messages?: Message[] }).messages;
      if (!msgs || !msgs.length) return;
      const lastMessage = msgs[msgs.length - 1];
      const text =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage.content)
            ? lastMessage.content
                .filter(
                  (c): c is { type: "text"; text: string } =>
                    "type" in c && c.type === "text",
                )
                .map((c) => c.text)
                .join("")
            : "";

      if (!text.trim()) return;

      const humanMsg: Message = {
        id: lastMessage.id || crypto.randomUUID(),
        type: "human",
        content: lastMessage.content,
      };
      setMessages((prev) => [...prev, humanMsg]);
      setIsLoading(true);
      setError(null);

      const { stream, cancel } = streamChat({
        message: text,
        session_id: threadId || undefined,
      });
      abortRef.current = cancel;

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const aiMessageId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      let aiContent = "";
      let pendingTokens = "";
      let rafId: number | null = null;
      let lastUsageMeta: Record<string, unknown> | null = null;

      function updateAiMessage(content: string) {
        setMessages((prev) => {
          const extra = lastUsageMeta ? { usage_metadata: lastUsageMeta as any } : {};
          const idx = prev.findIndex((m) => m.id === aiMessageId);
          if (idx !== -1) {
            return prev.map((m, i) => i === idx ? { ...m, content, ...extra } : m);
          }
          return [
            ...prev,
            { id: aiMessageId, type: "ai" as const, content, ...extra },
          ];
        });
      }

      function flushTokens() {
        if (pendingTokens) {
          aiContent += pendingTokens;
          pendingTokens = "";
          updateAiMessage(aiContent);
        }
        rafId = null;
      }

      function cancelRaf() {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (pendingTokens) {
          aiContent += pendingTokens;
          pendingTokens = "";
        }
      }

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "token") {
                  pendingTokens += event.content;
                  if (!rafId) rafId = requestAnimationFrame(flushTokens);
                } else if (event.type === "tool_call") {
                  cancelRaf();
                  setMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === aiMessageId);
                    if (idx !== -1) {
                      const ai = prev[idx] as any;
                      return prev.map((m, i) => i === idx ? {
                        ...m,
                        content: aiContent,
                        tool_calls: [
                          ...(ai.tool_calls || []),
                          {
                            name: event.tool,
                            args: event.args,
                            id: crypto.randomUUID(),
                          },
                        ],
                      } : m);
                    }
                    return prev;
                  });
                } else if (event.type === "tool_output") {
                  cancelRaf();
                  setMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === aiMessageId);
                    if (idx !== -1) {
                      return [
                        ...prev.slice(0, idx + 1).map((m, i) => i === idx ? { ...m, content: aiContent } : m),
                        ...prev.slice(idx + 1),
                        {
                          id: crypto.randomUUID(),
                          type: "tool",
                          name: event.tool,
                          content: event.result,
                          tool_call_id: "",
                        } as Message,
                      ];
                    }
                    return prev;
                  });
                } else if (event.type === "usage") {
                  lastUsageMeta = {
                    input_tokens: event.input_tokens || 0,
                    output_tokens: event.output_tokens || 0,
                    total_tokens: event.total_tokens || 0,
                    ttft_ms: event.ttft_ms,
                  };
                  setMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === aiMessageId);
                    if (idx !== -1) {
                      return prev.map((m, i) => i === idx ? { ...m, content: aiContent, usage_metadata: lastUsageMeta as any } : m);
                    }
                    return prev;
                  });
                } else if (event.type === "result") {
                  cancelRaf();
                  if (event.answer) aiContent = event.answer;
                  updateAiMessage(aiContent);

                  if (event.session_id && !threadId) {
                    skipReloadRef.current = true;
                    setThreadId(event.session_id);
                    setTimeout(
                      () =>
                        getThreads().then(setThreads).catch(console.error),
                      4000,
                    );
                  }
                  setIsLoading(false);
                } else if (event.type === "error") {
                  cancelRaf();
                  updateAiMessage(aiContent);
                  setError(event.error || "Unknown error");
                  setIsLoading(false);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
          // Stream ended — flush remaining tokens
          cancelRaf();
          updateAiMessage(aiContent);
          setIsLoading(false);
        } catch (e) {
          cancelRaf();
          updateAiMessage(aiContent);
          if ((e as Error).name !== "AbortError") {
            setError(e);
          }
          setIsLoading(false);
        }
      })();
    },
    [threadId, setThreadId, getThreads, setThreads],
  );

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const value: StreamContextType = useMemo(
    () => ({
      messages,
      isLoading,
      error,
      threadId,
      values: {},
      submit,
      stop,
      interrupt: null,
      getMessagesMetadata: () => ({
        branch: undefined,
        branchOptions: undefined,
        firstSeenState: null,
      }),
      setBranch: () => {},
    }),
    [messages, isLoading, error, threadId, submit, stop],
  );

  return (
    <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
  );
}

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;

  const [apiUrl, setApiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });

  const resolvedApiUrl = useMemo(() => {
    if (apiUrl.startsWith("/") && typeof window !== "undefined") {
      return window.location.origin + apiUrl;
    }
    return apiUrl;
  }, [apiUrl]);

  if (!resolvedApiUrl) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="mt-14 flex flex-col gap-2 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Agent Chat
              </h1>
            </div>
            <p className="text-muted-foreground">
              Welcome! Enter the chat server URL to get started.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const formData = new FormData(form);
              setApiUrl(formData.get("apiUrl") as string);
              form.reset();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiUrl">
                Server URL<span className="text-rose-500">*</span>
              </Label>
              <Input
                id="apiUrl"
                name="apiUrl"
                className="bg-background"
                defaultValue={apiUrl || DEFAULT_API_URL}
                required
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button type="submit" size="lg">
                Continue
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <StreamSession apiUrl={resolvedApiUrl}>
      {children}
    </StreamSession>
  );
};

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
