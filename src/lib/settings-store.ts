import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  theme: "light" | "dark" | "system";
  compactMode: boolean;
  aiTone: string;
  userNickname: string;
  reasoningDepth: "quick" | "deep";
  responseFormat: "standard" | "bullets" | "action";
  actionExecution: "ask" | "auto_safe";
  setTheme: (theme: "light" | "dark" | "system") => void;
  setCompactMode: (compactMode: boolean) => void;
  setAiTone: (aiTone: string) => void;
  setUserNickname: (userNickname: string) => void;
  setReasoningDepth: (reasoningDepth: "quick" | "deep") => void;
  setResponseFormat: (responseFormat: "standard" | "bullets" | "action") => void;
  setActionExecution: (actionExecution: "ask" | "auto_safe") => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      compactMode: false,
      aiTone: "professional",
      userNickname: "",
      reasoningDepth: "quick",
      responseFormat: "standard",
      actionExecution: "ask",
      setTheme: (theme) => set({ theme }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setAiTone: (aiTone) => set({ aiTone }),
      setUserNickname: (userNickname) => set({ userNickname }),
      setReasoningDepth: (reasoningDepth) => set({ reasoningDepth }),
      setResponseFormat: (responseFormat) => set({ responseFormat }),
      setActionExecution: (actionExecution) => set({ actionExecution }),
    }),
    {
      name: "aurora-settings",
    },
  ),
);
