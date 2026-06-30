import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChartSpec } from "@/components/analytics/ChartCanvas";

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

// One configurable field in an admin-defined Form Library form.
export interface DynamicFormField {
  name: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "date"
    | "select"
    | "number"
    | "email"
    | "checkbox"
    | "user"
    | "image";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  // Identity attribute this field pre-fills from (e.g. "department", "manager"). Empty = manual.
  autofill?:
    | "name"
    | "email"
    | "employee_id"
    | "department"
    | "designation"
    | "location"
    | "manager";
}

// Schema the backend sends for an admin-defined form matched in chat.
export interface DynamicFormData {
  template_id: number;
  name: string;
  description?: string;
  fields: DynamicFormField[];
  submit_endpoint: string;
  // {field_name: value} resolved from the logged-in user's profile for autofill-bound fields.
  prefill?: Record<string, string>;
}

// LLM-drafted form template shown for admin review/editing before it's actually created.
// When `id` is present the draft revises an existing form (PUT/update); otherwise it's a new
// form (POST/create).
export interface FormBuilderDraft {
  id?: number;
  name: string;
  description: string;
  category?: string;
  fields: DynamicFormField[];
}

export interface QuickChoiceOption {
  label: string;
  /** "message" → inject into chat; "link" → open in new tab */
  action: "message" | "link";
  value: string;
  icon?: string;
}

export interface QuickChoiceData {
  question: string;
  options: QuickChoiceOption[];
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
    | "attendance_schedule"
    | "my_attendance"
    | "dynamic_form"
    | "form_builder"
    | "quick_choice"
    | "travel_request_form"
    | "travel_expense_form"
    | "cancel_leave_form"
    | "leave_application_form"
    | "document_generation_form"
    | "chart";
  data?:
    | EmailDraftData
    | RoomBookingPrefill
    | AnnouncementPrefill
    | PromptConfigPrefill
    | SkillsEditorPrefill
    | VisitorPassPrefill
    | AttendanceSchedulePrefill
    | DynamicFormData
    | QuickChoiceData
    | FormBuilderDraft
    | ChartSpec;
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
  /** Grounding sources for the answer (ARB #41) — rendered as a cited-answer trust card. */
  citations?: Citation[];
  streaming?: boolean;
  /** True when this turn was generated from an error/failure, enabling the escalation prompt */
  isError?: boolean;
}

/** A single grounding source behind a cited answer (ARB #41). */
export interface Citation {
  title: string;
  category: string;
  excerpt: string;
}

export interface Thread {
  id: string;
  turns: Turn[];
  updatedAt: number;
  isPrivate?: boolean;
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
  togglePrivate: (threadId: string) => void;
}

// Threads inactive for longer than this are automatically purged from localStorage.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const isExpired = (t: Thread) => t.updatedAt < Date.now() - RETENTION_MS;

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
      togglePrivate: (threadId) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: { ...thread, isPrivate: !thread.isPrivate },
            },
          };
        }),
    }),
    {
      name: "aurora-chat-storage",
      partialize: (state) => {
        const cutoff = Date.now() - RETENTION_MS;
        return {
          activeId: state.activeId,
          threads: Object.fromEntries(
            Object.entries(state.threads)
              .filter(([_, thread]) => !thread.isPrivate && thread.updatedAt >= cutoff && thread.turns.length > 0)
              .map(([id, thread]) => [
                id,
                {
                  ...thread,
                  turns: thread.turns.map(({ images: _images, ...turn }) => turn),
                },
              ]),
          ),
        };
      },
      onRehydrateStorage: () => (state) => {
        // thinkingThreads is never persisted — reset any stale generating flags on load.
        if (state) {
          state.thinkingThreads = {};
          // Evict threads older than 30 days on every page load.
          const cutoff = Date.now() - RETENTION_MS;
          state.threads = Object.fromEntries(
            Object.entries(state.threads).filter(([_, t]) => t.updatedAt >= cutoff && t.turns.length > 0),
          );
          if (state.activeId && !state.threads[state.activeId]) {
            state.activeId = null;
          }
        }
      },
    },
  ),
);
