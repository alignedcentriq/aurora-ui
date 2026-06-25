import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Wrench,
  Plane,
  Wallet,
  BookOpen,
  MessageSquare,
  Sparkles,
  X,
  Pause,
  Play,
  ArrowRight,
  Check,
  UserRoundSearch,
  Megaphone,
  FileText,
  FlaskConical,
} from "lucide-react";
import { Logo } from "@/components/Logo";

/* ================================================================== */
/*  Centriq — Cinematic intro film                                     */
/*  8 scenes, auto-playing. Web approximation of a product launch reel.*/
/*  Chat queries & answers reuse the Centriq assistant tour content.   */
/* ================================================================== */

const BRAND = "#818cf8"; // indigo-400, particle/line tint on dark

/* ---- Ambient particle constellation (canvas) --------------------- */
function ParticleField({
  density = 64,
  color = BRAND,
  linkDist = 130,
  speed = 0.22,
}: {
  density?: number;
  color?: string;
  linkDist?: number;
  speed?: number;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    const pts: { x: number; y: number; vx: number; vy: number; r: number }[] = [];

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < density; i++) {
      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        r: Math.random() * 1.6 + 0.4,
      });
    }

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDist) {
            ctx.globalAlpha = (1 - dist / linkDist) * 0.18;
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density, color, linkDist, speed]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full pointer-events-none" />;
}

/* ---- Natural-rhythm typewriter ----------------------------------- */
function useTypewriter(text: string, active: boolean, base = 30) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (!active) {
      setN(0);
      return;
    }
    if (n >= text.length) return;
    const ch = text[n];
    let d = base + Math.random() * 40;
    if (ch === " ") d += 16;
    if (",;:".includes(ch)) d += 120;
    if (".?!".includes(ch)) d += 220;
    const t = setTimeout(() => setN((x) => x + 1), d);
    return () => clearTimeout(t);
  }, [text, active, n, base]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

const Caret = () => (
  <span className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] animate-pulse bg-current align-middle" />
);

const sceneFade = {
  initial: { opacity: 0, scale: 1.06 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const },
};

/* ================================================================== */
/*  Scene 1 — Ambient space, systems coming online                     */
/* ================================================================== */
function Scene1() {
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex flex-col items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 4, ease: "easeOut" }}
        className="absolute inset-0"
      >
        <ParticleField density={84} linkDist={150} />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 14, letterSpacing: "0.5em" }}
        animate={{ opacity: 1, y: 0, letterSpacing: "0.3em" }}
        transition={{ delay: 1, duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 text-center"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/40">
          Every system. Connected.
        </p>
        <h2 className="mt-3 text-2xl font-light text-white/80">
          Meet Aligned Automation's{" "}
          <span className="font-black text-white">intelligence layer</span>
        </h2>
      </motion.div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 2 — Chat: a question, an instant typed answer                */
/* ================================================================== */
function Scene2() {
  const [stage, setStage] = React.useState<"ask" | "answer">("ask");
  React.useEffect(() => {
    const t = setTimeout(() => setStage("answer"), 800);
    return () => clearTimeout(t);
  }, []);
  const { shown, done } = useTypewriter(
    "You get 18 annual leave days and 12 casual/sick days a year, with carry-forward up to 30 days. Want the full policy doc?",
    stage === "answer",
    15,
  );

  return (
    <motion.div {...sceneFade} className="absolute inset-0 flex items-center justify-center">
      <ParticleField density={40} linkDist={110} speed={0.14} />
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Incoming question */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="flex justify-end"
        >
          <div
            className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-white"
            style={{ background: "var(--gradient-primary)" }}
          >
            What is our leave policy?
          </div>
        </motion.div>

        {/* AI reply */}
        <AnimatePresence>
          {stage === "answer" && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-4 flex items-start gap-2.5"
            >
              <div className="mt-0.5 shrink-0">
                <Logo size="sm" />
              </div>
              <div className="rounded-2xl rounded-bl-md bg-white/[0.07] px-4 py-3 text-[15px] leading-relaxed text-white/90 backdrop-blur-md">
                {shown}
                {!done && <Caret />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 3 — Orbiting glass cards of connected systems                */
/* ================================================================== */
const SYSTEMS = [
  { label: "HR Portal", Icon: Users, c: "var(--collaboration)" },
  { label: "IT Service Desk", Icon: Wrench, c: "var(--connectivity)" },
  { label: "Travel Requests", Icon: Plane, c: "var(--clarity)" },
  { label: "Payroll", Icon: Wallet, c: "var(--accent-amber)" },
  { label: "Knowledge Base", Icon: BookOpen, c: "var(--capacity)" },
  { label: "Microsoft Teams", Icon: MessageSquare, c: "var(--connectivity)" },
  { label: "Alchemy", Icon: FlaskConical, c: "var(--clarity)" },
];

function Scene3() {
  const radius = 280;
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex flex-col items-center justify-center"
    >
      <ParticleField density={34} linkDist={100} speed={0.12} />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 1 }}
        className="absolute top-[16%] z-20 text-center text-[13px] font-medium uppercase tracking-[0.25em] text-white/45"
      >
        One assistant across every tool
      </motion.p>

      <div className="relative z-10" style={{ perspective: "1100px" }}>
        <motion.div
          animate={{ rotateY: 360 }}
          transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
          className="relative h-[220px] w-[220px]"
          style={{ transformStyle: "preserve-3d" }}
        >
          {SYSTEMS.map((s, i) => {
            const angle = (360 / SYSTEMS.length) * i;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.12, type: "spring", stiffness: 200, damping: 18 }}
                className="absolute left-1/2 top-1/2 -ml-[80px] -mt-[44px] flex h-[88px] w-[160px] flex-col justify-between rounded-2xl border border-white/15 bg-white/[0.06] p-3 backdrop-blur-xl"
                style={{
                  transform: `rotateY(${angle}deg) translateZ(${radius}px)`,
                  boxShadow: `0 12px 40px -10px color-mix(in oklab, ${s.c} 50%, transparent)`,
                }}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: `color-mix(in oklab, ${s.c} 20%, transparent)`,
                    color: s.c,
                  }}
                >
                  <s.Icon className="h-4 w-4" />
                </div>
                <span className="text-[13px] font-semibold text-white">{s.label}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 4 — Request + thinking orb + confirmation                    */
/* ================================================================== */
function ThinkingOrb() {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border"
          style={{ borderColor: "color-mix(in oklab, var(--clarity) 40%, transparent)" }}
          initial={{ width: 40, height: 40, opacity: 0.6 }}
          animate={{ width: 112, height: 112, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
        />
      ))}
      <motion.div
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        className="h-12 w-12 rounded-full"
        style={{
          background: "var(--gradient-primary)",
          boxShadow: "0 0 40px 6px color-mix(in oklab, var(--clarity) 60%, transparent)",
        }}
      />
    </div>
  );
}

function Scene4() {
  const [stage, setStage] = React.useState<"ask" | "think" | "answer" | "done">("ask");
  React.useEffect(() => {
    const t1 = setTimeout(() => setStage("think"), 800);
    const t2 = setTimeout(() => setStage("answer"), 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const { shown, done } = useTypewriter(
    "I've raised IT ticket #IT-4821 for a system heating issue. A technician will reach you within 2 business days.",
    stage === "answer",
    15,
  );
  React.useEffect(() => {
    if (done) setStage("done");
  }, [done]);

  return (
    <motion.div {...sceneFade} className="absolute inset-0 flex items-center justify-center">
      <ParticleField density={38} linkDist={110} speed={0.16} />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 22 }}
          className="self-end"
        >
          <div
            className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-white"
            style={{ background: "var(--gradient-primary)" }}
          >
            My laptop keeps overheating — can someone check it?
          </div>
        </motion.div>

        <div className="mt-6 flex min-h-[150px] w-full flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {stage === "think" && (
              <motion.div
                key="orb"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <ThinkingOrb />
              </motion.div>
            )}

            {(stage === "answer" || stage === "done") && (
              <motion.div
                key="ans"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-5 py-4 backdrop-blur-md"
              >
                <AnimatePresence>
                  {stage === "done" && (
                    <motion.span
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 16 }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500"
                    >
                      <Check className="h-5 w-5 text-white" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="text-[15px] font-medium leading-relaxed text-white">
                  {shown}
                  {!done && <Caret />}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 4b — Capabilities montage (resource / complaint / documents) */
/* ================================================================== */
const CAPS = [
  {
    q: "Find me a React developer free for next sprint",
    a: "Rahul Mehta — 95% skill fit, 80% available next sprint.",
    Icon: UserRoundSearch,
    c: "var(--capacity)",
    tag: "Best match",
  },
  {
    q: "Raise a complaint about the AC in Bay 3",
    a: "Logged complaint #HR-2207 and routed to Facilities — update within 24h.",
    Icon: Megaphone,
    c: "var(--accent-amber)",
    tag: "Complaint logged",
  },
  {
    q: "Get me the latest travel & expense policy",
    a: "Here's Travel-Policy-v4.pdf · updated Jun 2026.",
    Icon: FileText,
    c: "var(--connectivity)",
    tag: "Document ready",
  },
];

function SceneCapabilities() {
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex flex-col items-center justify-center"
    >
      <ParticleField density={32} linkDist={100} speed={0.12} />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.9 }}
        className="absolute top-[12%] z-20 text-center text-[13px] font-medium uppercase tracking-[0.25em] text-white/45"
      >
        Anything you need — just ask
      </motion.p>

      <div className="relative z-10 flex w-full max-w-lg flex-col gap-5 px-6">
        {CAPS.map((c, i) => (
          <motion.div
            key={c.q}
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 1.25, type: "spring", stiffness: 200, damping: 22 }}
            className="flex flex-col gap-2"
          >
            <div
              className="max-w-[80%] self-end rounded-2xl rounded-br-md px-4 py-2 text-[14px] leading-snug text-white"
              style={{ background: "var(--gradient-primary)" }}
            >
              {c.q}
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">
                <Logo size="sm" />
              </div>
              <div className="flex flex-col gap-1.5 rounded-2xl rounded-bl-md bg-white/[0.07] px-4 py-2.5 backdrop-blur-md">
                <span className="text-[14px] leading-snug text-white/90">{c.a}</span>
                <span
                  className="flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: c.c, background: `color-mix(in oklab, ${c.c} 16%, transparent)` }}
                >
                  <c.Icon className="h-3 w-3" /> {c.tag}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 5 — Requests merge into the core                             */
/* ================================================================== */
const REQUESTS = [
  { t: "Leave policy", x: -250, y: -130 },
  { t: "Report device issue", x: 260, y: -100 },
  { t: "Approve course", x: -280, y: 60 },
  { t: "Find a developer", x: 250, y: 120 },
  { t: "Raise complaint", x: -120, y: -195 },
  { t: "Get documents", x: 140, y: 195 },
  { t: "Show payslip", x: 0, y: -210 },
];

function Scene5() {
  return (
    <motion.div {...sceneFade} className="absolute inset-0 flex items-center justify-center">
      <ParticleField density={30} linkDist={90} speed={0.12} />
      <div className="relative z-10 flex h-[360px] w-full items-center justify-center">
        {REQUESTS.map((r, i) => (
          <motion.div
            key={r.t}
            initial={{ x: r.x, y: r.y, opacity: 0, scale: 1 }}
            animate={{ x: [r.x, r.x, 0], y: [r.y, r.y, 0], opacity: [0, 1, 0], scale: [1, 1, 0.3] }}
            transition={{
              duration: 2.4,
              times: [0, 0.35, 1],
              delay: i * 0.12,
              ease: [0.5, 0, 0.2, 1],
            }}
            className="absolute rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-[13px] font-medium text-white backdrop-blur-md"
          >
            {r.t}
          </motion.div>
        ))}

        {/* Core forms */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 0.6, 1.15, 1], opacity: [0, 0.4, 1, 1] }}
          transition={{ duration: 2.6, times: [0, 0.4, 0.8, 1], ease: "easeOut" }}
          className="absolute h-24 w-24 rounded-full"
          style={{
            background: "var(--gradient-primary)",
            boxShadow: "0 0 80px 20px color-mix(in oklab, var(--clarity) 55%, transparent)",
          }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.4, duration: 0.6 }}
          className="absolute z-10"
        >
          <Logo size="md" />
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 6 — Core expands, dashboards orbit, data streams             */
/* ================================================================== */
function Scene6() {
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <ParticleField density={50} linkDist={130} speed={0.2} />

      {/* Data streams */}
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (360 / 10) * i;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-px w-[42%] origin-left"
            style={{
              transform: `rotate(${angle}deg)`,
              background:
                "linear-gradient(90deg, transparent, color-mix(in oklab, var(--clarity) 70%, transparent))",
            }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: [0, 1, 0], opacity: [0, 0.7, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
          />
        );
      })}

      {/* Orbiting mini dashboards */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        className="absolute h-[420px] w-[420px]"
      >
        {[0, 1, 2, 3].map((i) => {
          const angle = (360 / 4) * i;
          return (
            <motion.div
              key={i}
              animate={{ rotate: -360 }}
              transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
              className="absolute left-1/2 top-1/2 h-16 w-24 -ml-12 -mt-8 rounded-xl border border-white/10 bg-white/[0.05] p-2 backdrop-blur-md"
              style={{ transform: `rotate(${angle}deg) translateX(210px)` }}
            >
              <div className="h-1.5 w-10 rounded-full bg-white/30" />
              <div className="mt-2 flex items-end gap-1">
                {[10, 18, 12, 22].map((hh, k) => (
                  <div
                    key={k}
                    className="w-2 rounded-sm"
                    style={{ height: hh, background: BRAND }}
                  />
                ))}
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* The core */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [0.6, 1.1, 1], opacity: 1 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
        className="relative z-10 flex h-32 w-32 items-center justify-center rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #a5b4fc, var(--clarity) 55%, #4338ca)",
          boxShadow: "0 0 100px 24px color-mix(in oklab, var(--clarity) 55%, transparent)",
        }}
      >
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Logo size="md" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 7 — Typography reveal                                        */
/* ================================================================== */
function Scene7() {
  const lines = ["One Assistant.", "Every System.", "Every Employee."];
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex flex-col items-center justify-center"
    >
      <ParticleField density={30} linkDist={90} speed={0.1} />
      <div className="relative z-10 flex flex-col items-center gap-1 text-center">
        {lines.map((l, i) => (
          <motion.h1
            key={l}
            initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.3 + i * 0.55, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="text-4xl font-black tracking-tight sm:text-5xl"
            style={{
              background: "linear-gradient(180deg, #fff, rgba(255,255,255,0.55))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {l}
          </motion.h1>
        ))}
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Scene 8 — Hero logo + tagline                                      */
/* ================================================================== */
function Scene8({ onComplete, onReplay }: { onComplete: () => void; onReplay: () => void }) {
  return (
    <motion.div
      {...sceneFade}
      className="absolute inset-0 flex flex-col items-center justify-center"
    >
      <ParticleField density={70} linkDist={150} speed={0.18} />
      <motion.div
        initial={{ opacity: 0, scale: 0.6, filter: "blur(14px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
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

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="mt-6 text-4xl font-black uppercase tracking-[0.15em] text-white"
        >
          Centriq
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 1 }}
          className="mt-3 text-[15px] font-medium text-white/55"
        >
          Aligned Automation's Intelligence Layer
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.7 }}
          className="mt-8 flex items-center gap-3"
        >
          <button
            onClick={onReplay}
            className="rounded-full border border-white/10 bg-white/[0.05] px-5 py-2.5 text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/10 cursor-pointer"
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
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ================================================================== */
/*  Orchestrator                                                       */
/* ================================================================== */
// scenes 0..7 auto-advance; final hero (8) holds
const DURATIONS = [3600, 5000, 5000, 5400, 5800, 3400, 4000, 3600];

interface IntroTourProps {
  onComplete: () => void;
}

export function IntroTour({ onComplete }: IntroTourProps) {
  const [scene, setScene] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const TOTAL = 9;
  const isHero = scene === TOTAL - 1;

  React.useEffect(() => {
    if (paused || isHero) return;
    const t = setTimeout(() => setScene((s) => s + 1), DURATIONS[scene]);
    return () => clearTimeout(t);
  }, [scene, paused, isHero]);

  const renderScene = () => {
    switch (scene) {
      case 0:
        return <Scene1 key="s1" />;
      case 1:
        return <Scene2 key="s2" />;
      case 2:
        return <Scene3 key="s3" />;
      case 3:
        return <Scene4 key="s4" />;
      case 4:
        return <SceneCapabilities key="s4b" />;
      case 5:
        return <Scene5 key="s5" />;
      case 6:
        return <Scene6 key="s6" />;
      case 7:
        return <Scene7 key="s7" />;
      default:
        return <Scene8 key="s8" onComplete={onComplete} onReplay={() => setScene(0)} />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[9998] overflow-hidden select-none"
      style={{ background: "radial-gradient(circle at 50% 40%, #0b1326 0%, #020617 70%)" }}
    >
      {/* Vignette / depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Scenes (crossfade) */}
      <AnimatePresence>{renderScene()}</AnimatePresence>

      {/* Skip */}
      {!isHero && (
        <button
          onClick={onComplete}
          className="absolute right-5 top-5 z-30 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
        >
          Skip <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Pause */}
      {!isHero && (
        <button
          onClick={() => setPaused((p) => !p)}
          className="absolute left-5 top-5 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/55 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Timeline progress */}
      <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <button
            key={i}
            onClick={() => setScene(i)}
            className="h-1 rounded-full transition-all duration-300 cursor-pointer"
            style={{
              width: i === scene ? 28 : 14,
              background: i <= scene ? "var(--gradient-primary)" : "rgba(255,255,255,0.16)",
            }}
            aria-label={`Scene ${i + 1}`}
          />
        ))}
      </div>
    </motion.div>
  );
}
