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
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  threads: Record<string, Thread>;
  activeId: string | null;
  thinking: boolean;
  setActiveId: (id: string) => void;
  setThinking: (thinking: boolean) => void;
  addTurn: (threadId: string, turn: Turn) => void;
  createThread: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: {},
      activeId: null,
      thinking: false,
      setActiveId: (id) => set({ activeId: id }),
      setThinking: (thinking) => set({ thinking }),
      addTurn: (threadId, turn) => {
        const { threads } = get();
        const thread = threads[threadId];
        if (!thread) return;

        const updatedThread = {
          ...thread,
          turns: [...thread.turns, turn],
          updatedAt: Date.now(),
        };

        set({
          threads: {
            ...threads,
            [threadId]: updatedThread,
          },
        });
      },
      createThread: () => {
        const id = "chat-" + Date.now();
        const newThread: Thread = {
          id,
          turns: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          threads: {
            ...state.threads,
            [id]: newThread,
          },
          activeId: id,
        }));
      },
    }),
    {
      name: "chat-storage",
    }
  )
);
