import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

interface VoiceStore {
  /** Whether hands-free ("Jarvis") mode is engaged. Persisted per browser. */
  voiceMode: boolean;
  /** Current phase of the hands-free loop. Not persisted. */
  voiceState: VoiceState;
  /** Live transcript shown in the orb while listening. Not persisted. */
  liveTranscript: string;
  toggleVoiceMode: () => void;
  setVoiceMode: (on: boolean) => void;
  setVoiceState: (s: VoiceState) => void;
  setLiveTranscript: (t: string) => void;
}

export const useVoiceStore = create<VoiceStore>()(
  persist(
    (set) => ({
      voiceMode: false,
      voiceState: "idle",
      liveTranscript: "",
      toggleVoiceMode: () =>
        set((s) => ({
          voiceMode: !s.voiceMode,
          voiceState: s.voiceMode ? "idle" : "listening",
          liveTranscript: "",
        })),
      setVoiceMode: (on) =>
        set({ voiceMode: on, voiceState: on ? "listening" : "idle", liveTranscript: "" }),
      setVoiceState: (voiceState) => set({ voiceState }),
      setLiveTranscript: (liveTranscript) => set({ liveTranscript }),
    }),
    {
      name: "centriq-voice-mode",
      // Only remember the preference; transient loop state resets each session.
      partialize: (s) => ({ voiceMode: s.voiceMode }),
    },
  ),
);
