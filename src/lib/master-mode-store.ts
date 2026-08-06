import { create } from "zustand";

interface MasterModeState {
  /** Whether the Master Mode cockpit overlay is open. A momentary, full-screen
   * experience the owner opens deliberately — not persisted, so it never
   * reopens on its own after a reload or navigation. */
  isMasterMode: boolean;
  toggle: () => void;
  set: (on: boolean) => void;
}

export const useMasterModeStore = create<MasterModeState>((set, get) => ({
  isMasterMode: false,
  toggle: () => set({ isMasterMode: !get().isMasterMode }),
  set: (on: boolean) => set({ isMasterMode: on }),
}));
