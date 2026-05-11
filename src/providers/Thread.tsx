import React, {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { Thread } from "@langchain/langgraph-sdk";
import { fetchJSON, type SessionInfo } from "./api-client";

interface ThreadContextType {
  getThreads: () => Promise<Thread[]>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    try {
      const sessions = await fetchJSON<SessionInfo[]>("/sessions");
      return sessions.map((s) => ({
        thread_id: s.session_id,
        created_at: s.created_at || new Date().toISOString(),
        updated_at: s.created_at || new Date().toISOString(),
        metadata: {
          doc_name: s.doc_name || "",
          doc_id: s.doc_id || "",
          title: s.title || "",
        },
        values: {},
      })) as unknown as Thread[];
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
      return [];
    }
  }, []);

  const value = {
    getThreads,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  };

  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}
