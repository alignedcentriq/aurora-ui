// The cockpit's home — a fullscreen immersive overlay opened from the header's
// glowing orb (MasterModeTrigger), instead of living inline in the chat home.
// Built on the raw Radix Dialog primitives (not the shadcn <DialogContent>,
// which is capped at max-w-lg) so it can actually go fullscreen while keeping
// the same focus-trap / Escape / aria wiring as every other dialog in the app.
import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import gsap from "gsap";
import { X } from "lucide-react";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { MasterModePanel } from "@/components/three/MasterModePanel";
import { useMasterModeStore } from "@/lib/master-mode-store";

export function MasterModeOverlay() {
  const isOpen = useMasterModeStore((s) => s.isMasterMode);
  const setOpen = useMasterModeStore((s) => s.set);
  const contentRef = useRef<HTMLDivElement>(null);

  // GSAP choreographs the reveal — header first, cockpit a beat behind — every
  // time the overlay opens. Depending on `isOpen` (not a mount effect) because
  // the Dialog stays mounted between opens when Radix keeps it in the tree.
  useEffect(() => {
    if (!isOpen || !contentRef.current) return;
    const els = contentRef.current.querySelectorAll("[data-reveal]");
    gsap.fromTo(
      els,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.1, delay: 0.1 },
    );
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay className="bg-[#04060c]/85" />
        <DialogPrimitive.Content
          ref={contentRef}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto p-5 focus:outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:p-10"
          style={{ background: "radial-gradient(120% 100% at 50% 0%, #0b1220 0%, #04060c 65%)" }}
        >
          <DialogTitle className="sr-only">Master Mode — Unified Intelligence Cockpit</DialogTitle>
          <DialogDescription className="sr-only">
            A live view of the four inference tiers the app runs on, with real request,
            latency and feedback telemetry.
          </DialogDescription>

          <div data-reveal className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">
                Master Mode
              </div>
              <p className="mt-1 text-lg font-bold text-slate-100 sm:text-2xl">
                Unified Intelligence Cockpit
              </p>
            </div>
            <DialogClose className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>

          <div data-reveal className="mt-6 flex flex-1 items-center sm:mt-10">
            <MasterModePanel fullscreen />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
