import { create } from "zustand";

interface UdemyAutomationsStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Shared signal between the top-bar "Automate" button (control-hub layout)
 *  and the UdemyBusinessPortal drawer renderer.  Keeps both sides decoupled. */
export const useUdemyAutomations = create<UdemyAutomationsStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
