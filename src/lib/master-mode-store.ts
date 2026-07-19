import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MasterModeState {
  /** When on, the chat hub ("/") renders the 3D model round-table landing instead of chat. */
  isMasterMode: boolean;
  toggle: () => void;
  set: (on: boolean) => void;
}

export const useMasterModeStore = create<MasterModeState>()(
  persist(
    (set, get) => ({
      isMasterMode: false,
      toggle: () => set({ isMasterMode: !get().isMasterMode }),
      set: (on: boolean) => set({ isMasterMode: on }),
    }),
    { name: "centriq-master-mode" },
  ),
);
