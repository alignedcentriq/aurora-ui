import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface EmailDraftData {
  to: string;
  subject: string;
  body: string;
}

export interface RoomBookingPrefill {
  date?: string;
  startTime?: string;
  endTime?: string;
  roomHint?: string;
  title?: string;
  attendees?: string;
}

export interface AnnouncementPrefill {
  title?: string;
  body?: string;
  category?: string;
  domain?: string;
  expiresDays?: string;
}

export interface PromptConfigPrefill {
  domain?: string;
  promptKey?: string;
  value?: string;
}

export interface SkillsEditorPrefill {
  skill?: string;
}

export interface AttendanceSchedulePrefill {
  frequency?: string;
  day_of_week?: number;
  day_of_month?: number;
  hour?: number;
}

export interface VisitorPassPrefill {
  visitorName?: string;
  visitDate?: string;
  visitTime?: string;
  purpose?: string;
  visitorCompany?: string;
}

export interface InteractivePayload {
  type:
    | "email_draft"
    | "parking_form"
    | "visitor_pass_form"
    | "room_booking_form"
    | "cancel_booking_form"
    | "announcement_form"
    | "prompt_config_form"
    | "my_schedule"
    | "skills_editor"
    | "team_attendance"
    | "attendance_schedule";
  data?: EmailDraftData | RoomBookingPrefill | AnnouncementPrefill | PromptConfigPrefill | SkillsEditorPrefill | VisitorPassPrefill | AttendanceSchedulePrefill;
}

export interface Turn {
  role: "user" | "ai";
  text: string;
  card?: boolean;
  downloadUrl?: string;
  downloadTitle?: string;
  domain?: string;
  interactive?: InteractivePayload;
  images?: string[];
  streaming?: boolean;
}

export interface Thread {
  id: string;
  turns: Turn[];
  updatedAt: number;
}

interface ChatState {
  threads: Record<string, Thread>;
  activeId: string | null;
  /** Per-thread "generating a response" flag, keyed by thread id. */
  thinkingThreads: Record<string, boolean>;
  setActiveId: (id: string | null) => void;
  setThinking: (threadId: string, thinking: boolean) => void;
  createThread: () => string;
  addTurn: (threadId: string, turn: Turn) => void;
  updateLastAITurn: (threadId: string, updates: Partial<Turn>) => void;
  deleteThread: (id: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      threads: {},
      activeId: null,
      thinkingThreads: {},
      setActiveId: (id) => set({ activeId: id }),
      setThinking: (threadId, thinking) =>
        set((state) => {
          const next = { ...state.thinkingThreads };
          if (thinking) next[threadId] = true;
          else delete next[threadId];
          return { thinkingThreads: next };
        }),
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
      updateLastAITurn: (threadId, updates) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          const turns = [...thread.turns];
          for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === "ai") {
              turns[i] = { ...turns[i], ...updates };
              break;
            }
          }
          return {
            threads: {
              ...state.threads,
              [threadId]: { ...thread, turns, updatedAt: Date.now() },
            },
          };
        }),
      deleteThread: (id) =>
        set((state) => {
          const newThreads = { ...state.threads };
          delete newThreads[id];
          let newActiveId = state.activeId;
          if (state.activeId === id) {
            const next = Object.values(newThreads)
              .filter((t) => t.turns.length > 0)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
            newActiveId = next?.id ?? null;
          }
          return { threads: newThreads, activeId: newActiveId };
        }),
    }),
    {
      name: "aurora-chat-storage",
      partialize: (state) => ({
        activeId: state.activeId,
        threads: Object.fromEntries(
          Object.entries(state.threads).map(([id, thread]) => [
            id,
            {
              ...thread,
              turns: thread.turns.map(({ images: _images, ...turn }) => turn),
            },
          ])
        ),
      }),
      onRehydrateStorage: () => (state) => {
        // thinkingThreads is never persisted — reset any stale generating flags on load.
        if (state) {
          state.thinkingThreads = {};
        }
      },
    }
  )
);
