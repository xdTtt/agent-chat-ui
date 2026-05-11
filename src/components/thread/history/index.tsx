import { Button } from "@/components/ui/button";
import { useThreads } from "@/providers/Thread";
import { Thread } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useState } from "react";

import { useQueryState, parseAsBoolean } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelRightOpen, PanelRightClose, Pencil, Trash2, Check, X, Plus, BookOpen } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { deleteSession, renameSession, fetchNovels, type NovelInfo, type SessionInfo, fetchJSON } from "@/providers/api-client";

function ThreadItem({
  thread,
  isActive,
  onClick,
  onRefresh,
}: {
  thread: Thread;
  isActive: boolean;
  onClick: () => void;
  onRefresh: () => void;
}) {
  const meta = thread.metadata as Record<string, string> | undefined;
  const displayText = meta?.title || meta?.doc_name || thread.thread_id;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayText);

  const handleRename = async () => {
    if (editValue.trim() && editValue !== displayText) {
      await renameSession(thread.thread_id, editValue.trim());
      onRefresh();
    }
    setIsEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(thread.thread_id);
    onRefresh();
  };

  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-md px-1 ${isActive ? "bg-muted" : "hover:bg-muted/50"}`}
    >
      {isEditing ? (
        <div className="flex flex-1 items-center gap-1">
          <input
            className="h-7 flex-1 rounded border px-2 text-sm"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setIsEditing(false);
            }}
            autoFocus
          />
          <button onClick={handleRename} className="shrink-0 p-1 hover:bg-muted rounded"><Check className="size-3.5" /></button>
          <button onClick={() => setIsEditing(false)} className="shrink-0 p-1 hover:bg-muted rounded"><X className="size-3.5" /></button>
        </div>
      ) : (
        <>
          <button
            className="flex-1 truncate text-left text-sm px-2 py-1.5"
            onClick={onClick}
          >
            {displayText}
          </button>
          <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setEditValue(displayText); setIsEditing(true); }}
              className="p-1 hover:bg-muted rounded"
              title="Rename"
            >
              <Pencil className="size-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 hover:bg-muted rounded"
              title="Delete"
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ThreadList({
  threads,
  onThreadClick,
  onRefresh,
}: {
  threads: Thread[];
  onThreadClick?: (threadId: string) => void;
  onRefresh: () => void;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");

  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-1 overflow-y-scroll px-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {threads.map((t) => (
        <ThreadItem
          key={t.thread_id}
          thread={t}
          isActive={t.thread_id === threadId}
          onClick={() => {
            onThreadClick?.(t.thread_id);
            if (t.thread_id !== threadId) setThreadId(t.thread_id);
          }}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {Array.from({ length: 30 }).map((_, i) => (
        <Skeleton key={`skeleton-${i}`} className="h-10 w-[280px]" />
      ))}
    </div>
  );
}

function NewChatButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [novels, setNovels] = useState<NovelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setThreadId] = useQueryState("threadId");

  const handleOpen = async () => {
    setOpen((p) => !p);
    if (!open && novels.length === 0) {
      setLoading(true);
      try {
        const list = await fetchNovels();
        setNovels(list);
      } catch {
        // ignore
      }
      setLoading(false);
    }
  };

  const handleSelect = async (novel?: NovelInfo) => {
    const body: Record<string, string> = {};
    if (novel) {
      body.doc_id = novel.doc_id;
      body.doc_name = novel.doc_name;
    }
    try {
      const session = await fetchJSON<SessionInfo>("/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await setThreadId(session.session_id);
    } catch {
      // ignore
    }
    setOpen(false);
    onCreated();
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-sm"
        onClick={handleOpen}
      >
        <Plus className="size-4" />
        New Chat
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => handleSelect()}
            >
              <Plus className="size-3.5" />
              Empty chat
            </button>
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading novels...</div>
            ) : novels.length > 0 ? (
              <>
                <div className="my-1 h-px bg-border" />
                {novels.map((n) => (
                  <button
                    key={n.doc_id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                    onClick={() => handleSelect(n)}
                  >
                    <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{n.doc_name}</span>
                  </button>
                ))}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );

  const { getThreads, threads, setThreads, threadsLoading, setThreadsLoading } =
    useThreads();

  const refreshThreads = useCallback(() => {
    setThreadsLoading(true);
    getThreads()
      .then(setThreads)
      .catch(console.error)
      .finally(() => setThreadsLoading(false));
  }, [getThreads, setThreads, setThreadsLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    refreshThreads();
  }, [refreshThreads]);

  return (
    <>
      <div className="shadow-inner-right hidden h-screen w-[300px] shrink-0 flex-col items-start justify-start gap-6 border-r-[1px] border-slate-300 lg:flex">
        <div className="flex w-full items-center justify-between px-4 pt-1.5">
          <Button
            className="hover:bg-gray-100"
            variant="ghost"
            onClick={() => setChatHistoryOpen((p) => !p)}
          >
            {chatHistoryOpen ? (
              <PanelRightOpen className="size-5" />
            ) : (
              <PanelRightClose className="size-5" />
            )}
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            Thread History
          </h1>
        </div>
        <div className="w-full px-3">
          <NewChatButton onCreated={refreshThreads} />
        </div>
        {threadsLoading ? (
          <ThreadHistoryLoading />
        ) : (
          <ThreadList threads={threads} onRefresh={refreshThreads} />
        )}
      </div>
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && !isLargeScreen}
          onOpenChange={(open) => {
            if (isLargeScreen) return;
            setChatHistoryOpen(open);
          }}
        >
          <SheetContent side="left" className="flex lg:hidden">
            <SheetHeader>
              <SheetTitle>Thread History</SheetTitle>
            </SheetHeader>
            <div className="px-1">
              <NewChatButton onCreated={refreshThreads} />
            </div>
            <ThreadList
              threads={threads}
              onThreadClick={() => setChatHistoryOpen((o) => !o)}
              onRefresh={refreshThreads}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
