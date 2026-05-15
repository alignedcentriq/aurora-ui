import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Turn {
  role: "user" | "ai";
  text: string;
  card?: boolean;
  downloadUrl?: string;
  downloadTitle?: string;
}

export interface Thread {
  id: string;
  turns: Turn[];
  updatedAt: number;
}

interface ChatState {
  threads: Record<string, Thread>;
  activeId: string | null;
  thinking: boolean;
  setActiveId: (id: string | null) => void;
  setThinking: (thinking: boolean) => void;
  createThread: () => string;
  addTurn: (threadId: string, turn: Turn) => void;
  deleteThread: (id: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      threads: {},
      activeId: null,
      thinking: false,
      setActiveId: (id) => set({ activeId: id }),
      setThinking: (thinking) => set({ thinking }),
      createThread: () => {
        const id = "chat-" + Date.now();
        set((state) => ({
          threads: {
            ...state.threads,
            [id]: { id, turns: [], updatedAt: Date.now() },
          },
          activeId: id,
        }));
        return id;
      },
      addTurn: (threadId, turn) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: {
                ...thread,
                turns: [...thread.turns, turn],
                updatedAt: Date.now(),
              },
            },
          };
        }),
      deleteThread: (id) =>
        set((state) => {
          const newThreads = { ...state.threads };
          delete newThreads[id];
          return {
            threads: newThreads,
            activeId: state.activeId === id ? null : state.activeId,
          };
        }),
    }),
    {
      name: "aurora-chat-storage",
    }
  )
);
