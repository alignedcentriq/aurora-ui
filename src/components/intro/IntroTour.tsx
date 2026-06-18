import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarCheck,
  Laptop,
  GraduationCap,
  BarChart3,
  UserRoundSearch,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  ArrowRight,
  CheckCircle2,
  Clock,
  Send,
} from "lucide-react";
import { Logo } from "@/components/Logo";

/* ------------------------------------------------------------------ */
/*  Scene content — each is a typed prompt -> animated assistant reply  */
/* ------------------------------------------------------------------ */

type Scene = {
  id: string;
  feature: string;
  narration: string;
  accent: string; // a CSS var() reference from the 4C palette
  Icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  answer: string;
  result: React.ReactNode;
};

function Pill({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: accent,
        background: `color-mix(in oklab, ${accent} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function ResultCard({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22, delay: 0.12 }}
      className="mt-3 w-full max-w-[420px] rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md"
      style={{ boxShadow: `0 12px 30px -12px color-mix(in oklab, ${accent} 40%, transparent)` }}
    >
      {children}
    </motion.div>
  );
}

const SCENES: Scene[] = [
  {
    id: "hr",
    feature: "HR Requests",
    narration: "Time off, policies & people — handled right in chat.",
    accent: "var(--collaboration)",
    Icon: CalendarCheck,
    prompt: "I need to take 3 days off next week for a family trip",
    answer:
      "Done! I've drafted a leave request for Mon–Wed (Jun 22–24). Your manager Aisha will be notified for approval.",
    result: (
      <ResultCard accent="var(--collaboration)">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-white">Leave Request</span>
          <Pill accent="var(--collaboration)">Pending approval</Pill>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-white/40">Dates</div>
            <div className="font-semibold text-white">Jun 22 – 24</div>
          </div>
          <div>
            <div className="text-white/40">Type</div>
            <div className="font-semibold text-white">Paid leave</div>
          </div>
          <div>
            <div className="text-white/40">Approver</div>
            <div className="font-semibold text-white">Aisha K.</div>
          </div>
          <div>
            <div className="text-white/40">Balance left</div>
            <div className="font-semibold text-white">12 days</div>
          </div>
        </div>
      </ResultCard>
    ),
  },
  {
    id: "it",
    feature: "IT Support",
    narration: "Devices, access & software — raised in a sentence.",
    accent: "var(--connectivity)",
    Icon: Laptop,
    prompt: "My laptop is slow — can I get a RAM upgrade?",
    answer:
      "I've raised an IT ticket for a 16GB → 32GB upgrade. Expected pickup is within 2 business days.",
    result: (
      <ResultCard accent="var(--connectivity)">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-white">Ticket #IT-4821</span>
          <Pill accent="var(--connectivity)">Open</Pill>
        </div>
        <div className="mt-2 text-[13px] text-white/80">RAM upgrade · 16GB → 32GB</div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-white/50">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> ETA 2 days
          </span>
          <span>Priority: Medium</span>
          <span>Assigned: IT Desk</span>
        </div>
      </ResultCard>
    ),
  },
  {
    id: "pmo",
    feature: "PMO Approvals",
    narration: "Learning, projects & sign-offs — approved in one tap.",
    accent: "var(--clarity)",
    Icon: GraduationCap,
    prompt: "Approve Priya's Udemy course on Kubernetes",
    answer:
      "Approved ✓ Priya's 'Kubernetes Mastery' enrollment is confirmed. Cost logged to the L&D budget.",
    result: (
      <ResultCard accent="var(--clarity)">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" style={{ color: "var(--clarity)" }} />
          <span className="text-[12px] font-bold text-white">Course Approved</span>
        </div>
        <div className="mt-2 text-[13px] font-semibold text-white">Kubernetes Mastery</div>
        <div className="mt-1 flex items-center gap-4 text-[11px] text-white/50">
          <span>Learner: Priya S.</span>
          <span>Cost: $14.99</span>
          <span>Budget: L&D · Q2</span>
        </div>
      </ResultCard>
    ),
  },
  {
    id: "analytics",
    feature: "Ask Your Data",
    narration: "Plain-English questions over your live metrics.",
    accent: "var(--accent-amber)",
    Icon: BarChart3,
    prompt: "What was our average hiring cost per role last quarter?",
    answer:
      "Average cost-per-hire last quarter was $4,180 — down 12% from Q1. Engineering roles ran highest at $6,250.",
    result: (
      <ResultCard accent="var(--accent-amber)">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-white">Cost per Hire · Q2</span>
          <Pill accent="var(--accent-amber)">▼ 12%</Pill>
        </div>
        <div className="mt-3 flex items-end gap-2 h-20">
          {[
            { l: "Eng", v: 100 },
            { l: "Sales", v: 64 },
            { l: "Ops", v: 48 },
            { l: "HR", v: 40 },
          ].map((b, i) => (
            <div key={b.l} className="flex flex-1 flex-col items-center justify-end gap-1">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${b.v}%` }}
                transition={{ delay: 0.3 + i * 0.1, type: "spring", stiffness: 180, damping: 18 }}
                className="w-full rounded-md"
                style={{ background: "var(--accent-amber)", opacity: 0.85 }}
              />
              <span className="text-[9px] text-white/40">{b.l}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-white/50">Avg $4,180 · Eng peak $6,250</div>
      </ResultCard>
    ),
  },
  {
    id: "match",
    feature: "Resource Matching",
    narration: "Staff projects by real skills & availability.",
    accent: "var(--capacity)",
    Icon: UserRoundSearch,
    prompt: "Find me a React developer free for next sprint",
    answer:
      "Best match: Rahul Mehta — 95% skill fit and 80% available next sprint. Want me to send him a heads-up?",
    result: (
      <ResultCard accent="var(--capacity)">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: "var(--gradient-primary)" }}
          >
            RM
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-bold text-white">Rahul Mehta</div>
            <div className="text-[11px] text-white/50">Senior Frontend Engineer</div>
          </div>
          <Pill accent="var(--capacity)">95% fit</Pill>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["React", "TypeScript", "Next.js", "GraphQL"].map((s) => (
            <span
              key={s}
              className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/70"
            >
              {s}
            </span>
          ))}
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-white/40">
            <span>Availability next sprint</span>
            <span>80%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "80%" }}
              transition={{ delay: 0.4, duration: 0.7, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ background: "var(--capacity)" }}
            />
          </div>
        </div>
      </ResultCard>
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  Phase machine                                                      */
/*  moveIn -> type -> moveSend -> think -> answer -> hold -> (next)     */
/* ------------------------------------------------------------------ */
type Phase = "moveIn" | "type" | "moveSend" | "think" | "answer" | "hold";

const THINK_MS = 800;
const HOLD_MS = 2600;
const ANSWER_SPEED = 16;

// Natural per-character typing delay with pauses at punctuation.
function typingDelay(ch: string) {
  let d = 42 + Math.random() * 60; // 42–102ms base jitter
  if (ch === " ") d += 28;
  if (",;:".includes(ch)) d += 150;
  if (".?!".includes(ch)) d += 320;
  return d;
}

interface IntroTourProps {
  onComplete: () => void;
}

export function IntroTour({ onComplete }: IntroTourProps) {
  const [scene, setScene] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("moveIn");
  const [typed, setTyped] = React.useState(0);
  const [answered, setAnswered] = React.useState(0);
  const [sent, setSent] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [finished, setFinished] = React.useState(false);

  // Mouse cursor state (coords relative to the app frame)
  const [cursor, setCursor] = React.useState({ x: 320, y: 360 });
  const [clicks, setClicks] = React.useState(0); // increments per click → ripple
  const [pressing, setPressing] = React.useState(false);

  const frameRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const sendRef = React.useRef<HTMLDivElement>(null);

  const current = SCENES[scene];
  const isLast = scene === SCENES.length - 1;

  const moveCursorTo = React.useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    const frame = frameRef.current;
    const el = ref.current;
    if (!frame || !el) return;
    const fr = frame.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    setCursor({
      x: er.left - fr.left + er.width / 2,
      y: er.top - fr.top + er.height / 2,
    });
  }, []);

  const doClick = React.useCallback(() => {
    setPressing(true);
    setClicks((c) => c + 1);
    setTimeout(() => setPressing(false), 180);
  }, []);

  // Reset everything on scene change
  React.useEffect(() => {
    setPhase("moveIn");
    setTyped(0);
    setAnswered(0);
    setSent(false);
  }, [scene]);

  // Phase: moveIn — glide cursor to composer, click, then start typing
  React.useEffect(() => {
    if (phase !== "moveIn" || paused) return;
    const m = setTimeout(() => moveCursorTo(inputRef), 60);
    const click = setTimeout(doClick, 780);
    const next = setTimeout(() => setPhase("type"), 1050);
    return () => {
      clearTimeout(m);
      clearTimeout(click);
      clearTimeout(next);
    };
  }, [phase, paused, scene, moveCursorTo, doClick]);

  // Phase: type — natural-rhythm typing into the composer
  React.useEffect(() => {
    if (phase !== "type" || paused) return;
    if (typed >= current.prompt.length) {
      const t = setTimeout(() => setPhase("moveSend"), 320);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setTyped((n) => n + 1), typingDelay(current.prompt[typed]));
    return () => clearTimeout(t);
  }, [phase, typed, paused, current.prompt]);

  // Phase: moveSend — cursor to Send button, click, commit user bubble
  React.useEffect(() => {
    if (phase !== "moveSend" || paused) return;
    const m = setTimeout(() => moveCursorTo(sendRef), 40);
    const click = setTimeout(() => {
      doClick();
      setSent(true);
    }, 560);
    const next = setTimeout(() => setPhase("think"), 860);
    return () => {
      clearTimeout(m);
      clearTimeout(click);
      clearTimeout(next);
    };
  }, [phase, paused, moveCursorTo, doClick]);

  // Phase: think — typing indicator
  React.useEffect(() => {
    if (phase !== "think" || paused) return;
    const t = setTimeout(() => setPhase("answer"), THINK_MS);
    return () => clearTimeout(t);
  }, [phase, paused]);

  // Phase: answer — stream the reply
  React.useEffect(() => {
    if (phase !== "answer" || paused) return;
    if (answered >= current.answer.length) {
      const t = setTimeout(() => setPhase("hold"), HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setAnswered((n) => n + 1), ANSWER_SPEED);
    return () => clearTimeout(t);
  }, [phase, answered, paused, current.answer]);

  // Phase: hold — advance to next scene or finale
  React.useEffect(() => {
    if (phase !== "hold" || paused) return;
    const t = setTimeout(() => {
      if (isLast) setFinished(true);
      else setScene((s) => s + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [phase, paused, isLast]);

  const goTo = (i: number) => {
    setFinished(false);
    setScene(Math.max(0, Math.min(SCENES.length - 1, i)));
  };

  const composerText = !sent ? current.prompt.slice(0, typed) : "";
  const showCaret = phase === "moveIn" || phase === "type" || phase === "moveSend";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45 }}
      className="fixed inset-0 z-[9998] flex flex-col items-center justify-center p-4 select-none overflow-hidden"
      style={{ background: "radial-gradient(circle at 50% 30%, #0f172a 0%, #020617 100%)" }}
    >
      {/* Mesh overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-6l22-13V19L28 6 6 19v28l22 13z' fill='none' stroke='%233B8FE8' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "56px 100px",
        }}
      />

      {/* Ambient accent glow — recolors per scene */}
      <AnimatePresence>
        <motion.div
          key={current.id + "-glow"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
          className="absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px] pointer-events-none"
          style={{ background: `radial-gradient(circle, ${current.accent}, transparent 70%)` }}
        />
      </AnimatePresence>

      {/* Skip */}
      <button
        onClick={onComplete}
        className="absolute right-5 top-5 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/60 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
      >
        Skip intro <X className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence mode="wait">
        {!finished ? (
          <motion.div
            key="tour"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex w-full max-w-[600px] flex-col items-center"
          >
            {/* Narration caption */}
            <div className="mb-5 h-12 flex flex-col items-center justify-end text-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{ color: current.accent }}
                  >
                    <current.Icon className="h-3.5 w-3.5" /> {current.feature}
                  </span>
                  <p className="text-[15px] font-medium text-white/80">{current.narration}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* App window frame — persists, with a slow Ken Burns drift */}
            <motion.div
              ref={frameRef}
              animate={{ scale: [1, 1.012, 1], y: [0, -4, 0] }}
              transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
              className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]/80 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            >
              {/* Title bar */}
              <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                  <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="ml-3 flex items-center gap-2">
                  <Logo size="sm" />
                  <span className="text-[13px] font-bold text-white">Centriq AI</span>
                </div>
                <span className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                  <Sparkles className="h-3 w-3" /> Concierge
                </span>
              </div>

              {/* Body */}
              <div className="px-5 pb-4 pt-5">
                <div className="flex min-h-[180px] flex-col gap-3">
                  <AnimatePresence mode="popLayout">
                    {/* User bubble (after send) */}
                    {sent && (
                      <motion.div
                        key={current.id + "-user"}
                        layout
                        initial={{ opacity: 0, y: 12, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 24 }}
                        className="flex justify-end"
                      >
                        <div
                          className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed text-white"
                          style={{ background: "var(--gradient-primary)" }}
                        >
                          {current.prompt}
                        </div>
                      </motion.div>
                    )}

                    {/* Thinking */}
                    {phase === "think" && (
                      <motion.div
                        key="think"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <Logo size="sm" />
                        <div className="flex gap-1 rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="h-1.5 w-1.5 rounded-full bg-white/50"
                              animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {/* Answer + result */}
                    {(phase === "answer" || phase === "hold") && (
                      <motion.div
                        key={current.id + "-answer"}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-start gap-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="pt-0.5">
                            <Logo size="sm" />
                          </div>
                          <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-2.5 text-[14px] leading-relaxed text-white/90">
                            {current.answer.slice(0, answered)}
                            {phase === "answer" && answered < current.answer.length && (
                              <span className="ml-0.5 inline-block h-[14px] w-[2px] -translate-y-[1px] animate-pulse bg-white/60 align-middle" />
                            )}
                          </div>
                        </div>
                        {answered >= current.answer.length && (
                          <div className="pl-8">{current.result}</div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Composer */}
                <div
                  ref={inputRef}
                  className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 transition-colors"
                  style={
                    phase === "type" || phase === "moveIn"
                      ? { borderColor: "color-mix(in oklab, var(--clarity) 45%, transparent)" }
                      : undefined
                  }
                >
                  <span className="flex-1 truncate text-[13px] text-white/70">
                    {composerText || (
                      <span className="text-white/35">Ask Centriq anything…</span>
                    )}
                    {showCaret && composerText && (
                      <span className="ml-0.5 inline-block h-[13px] w-[2px] -translate-y-[1px] animate-pulse bg-white/70 align-middle" />
                    )}
                  </span>
                  <div
                    ref={sendRef}
                    className="flex h-8 w-8 items-center justify-center rounded-xl"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    <Send className="h-4 w-4 text-white" />
                  </div>
                </div>
              </div>

              {/* Animated mouse cursor (lives inside the frame so coords align) */}
              <motion.div
                className="pointer-events-none absolute left-0 top-0 z-30"
                animate={{ x: cursor.x, y: cursor.y, scale: pressing ? 0.82 : 1 }}
                transition={{
                  x: { type: "spring", stiffness: 120, damping: 18 },
                  y: { type: "spring", stiffness: 120, damping: 18 },
                  scale: { duration: 0.18 },
                }}
              >
                {/* Click ripple */}
                <AnimatePresence>
                  <motion.span
                    key={clicks}
                    initial={{ opacity: 0.5, scale: 0 }}
                    animate={{ opacity: 0, scale: 2.6 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="absolute left-0 top-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
                  />
                </AnimatePresence>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.6))" }}>
                  <path
                    d="M5.5 3.2L5.5 18.8L9.6 14.9L12.3 20.6L14.4 19.6L11.7 14L17.2 14L5.5 3.2Z"
                    fill="white"
                    stroke="#0b1220"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
              </motion.div>
            </motion.div>

            {/* Controls */}
            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                onClick={() => goTo(scene - 1)}
                disabled={scene === 0}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-white/[0.04] cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2">
                {SCENES.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => goTo(i)}
                    className="relative h-2 rounded-full transition-all duration-300 cursor-pointer"
                    style={{
                      width: i === scene ? 24 : 8,
                      background: i === scene ? "var(--gradient-primary)" : "rgba(255,255,255,0.18)",
                    }}
                    aria-label={`Go to ${s.feature}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setPaused((p) => !p)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/10 cursor-pointer"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>

              <button
                onClick={() => (isLast ? setFinished(true) : goTo(scene + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/10 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        ) : (
          /* -------- Finale -------- */
          <motion.div
            key="finale"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="relative z-10 flex flex-col items-center text-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="flex h-24 w-24 items-center justify-center rounded-3xl p-[3px]"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
              }}
            >
              <div className="flex h-full w-full items-center justify-center rounded-3xl bg-[#020617]">
                <Logo size="md" />
              </div>
            </motion.div>
            <h1 className="mt-6 text-3xl font-black tracking-tight text-white">You're all set 🎉</h1>
            <p className="mt-2 max-w-sm text-[14px] text-white/50">
              Just ask Centriq in plain English — HR, IT, approvals, analytics and staffing, all
              from one place.
            </p>
            <div className="mt-7 flex items-center gap-3">
              <button
                onClick={() => goTo(0)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/10 cursor-pointer"
              >
                Replay
              </button>
              <button
                onClick={onComplete}
                className="flex items-center gap-2 rounded-full px-6 py-2.5 text-[13px] font-bold text-white shadow-lg transition-transform hover:scale-[1.03] cursor-pointer"
                style={{ background: "var(--gradient-primary)" }}
              >
                Get started <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
