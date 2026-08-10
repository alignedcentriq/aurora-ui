import { create } from "zustand";

export type HumanoidState =
  | "starting"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "executing";

interface HumanoidStore {
  humanoidActive: boolean;
  humanoidState: HumanoidState;
  transcript: string;
  audioLevel: number;
  setHumanoidActive: (active: boolean) => void;
  setHumanoidState: (state: HumanoidState) => void;
  setTranscript: (text: string) => void;
  setAudioLevel: (level: number) => void;
}

export const useHumanoidStore = create<HumanoidStore>((set) => ({
  humanoidActive: false,
  humanoidState: "idle",
  transcript: "",
  audioLevel: 0,
  setHumanoidActive: (humanoidActive) =>
    set({
      humanoidActive,
      humanoidState: humanoidActive ? "starting" : "idle",
      transcript: "",
      audioLevel: 0,
    }),
  setHumanoidState: (humanoidState) => set({ humanoidState }),
  setTranscript: (transcript) => set({ transcript }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
}));
