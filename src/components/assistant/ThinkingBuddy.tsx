import { useState, useEffect } from "react";

const PHRASES = [
  "Hmm, let me think about that...",
  "Consulting my inner wisdom...",
  "Crunching data at light speed...",
  "Searching through all possibilities...",
  "Deep focus mode activated...",
  "Almost cracked it...",
  "Connecting all the dots...",
  "Turning your question into magic...",
  "Just a sec, genius at work!",
  "Cross-referencing everything...",
  "Pulling the right answer for you...",
  "Thinking really hard right now...",
];

type Phase = "typing" | "glance";

export function ThinkingBuddy() {
  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * PHRASES.length),
  );
  const [fade, setFade] = useState(true);
  const [phase, setPhase] = useState<Phase>("typing");
  const [handFrame, setHandFrame] = useState(0);

  // Phrase cycling
  useEffect(() => {
    let tid: number;
    const id = setInterval(() => {
      setFade(false);
      tid = window.setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % PHRASES.length);
        setFade(true);
      }, 350);
    }, 2800);
    return () => { clearInterval(id); window.clearTimeout(tid); };
  }, []);

  // Phase: typing (2.4s) → glance (1s) → typing → repeat
  useEffect(() => {
    let t: number;
    const cycle = () => {
      setPhase("glance");
      t = window.setTimeout(() => {
        setPhase("typing");
        t = window.setTimeout(cycle, 2400);
      }, 1000);
    };
    t = window.setTimeout(cycle, 2400);
    return () => window.clearTimeout(t);
  }, []);

  // Alternating hands during typing
  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => setHandFrame((f) => (f + 1) % 2), 280);
    return () => clearInterval(id);
  }, [phase]);

  const typing = phase === "typing";

  // Pupils: looking down-center when typing, up-right when glancing
  const lx = typing ? 0 : 2;
  const ly = typing ? 3 : -4;
  const rx = typing ? 0 : 2;
  const ry = typing ? 3 : -4;

  return (
    <>
      <style>{`
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes antenna-glow {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.35); }
        }
      `}</style>

      <div className="flex items-center gap-3 py-1 select-none">
        {/* Character */}
        <div
          className="shrink-0"
          style={{
            animation: "buddy-bob 2.4s ease-in-out infinite",
            filter: "drop-shadow(0 4px 12px rgba(99,102,241,0.4))",
          }}
        >
          <svg
            width="38"
            height="52"
            viewBox="0 0 50 68"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Antenna */}
            <line x1="25" y1="4" x2="25" y2="13" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
            <circle
              cx="25" cy="3.5" r="4.5" fill="#818cf8"
              style={{ animation: "antenna-glow 1.6s ease-in-out infinite", transformOrigin: "25px 3.5px" }}
            />
            <circle cx="26.5" cy="2" r="1.6" fill="white" opacity="0.65" />

            {/* Head */}
            <rect x="3" y="12" width="44" height="38" rx="14" fill="#6366f1" />

            {/* Ear bumps */}
            <circle cx="2.5" cy="31" r="5" fill="#6366f1" opacity="0.7" />
            <circle cx="47.5" cy="31" r="5" fill="#6366f1" opacity="0.7" />

            {/* Eye whites — slightly squinted when typing */}
            <ellipse cx="17" cy="29" rx="7.5" ry={typing ? 8 : 9.5} fill="white" style={{ transition: "ry 0.3s ease" }} />
            <ellipse cx="35" cy="29" rx="7.5" ry={typing ? 8 : 9.5} fill="white" style={{ transition: "ry 0.3s ease" }} />

            {/* Pupils */}
            <circle
              cx={17} cy={31} r="4.2" fill="#312e81"
              style={{ transform: `translate(${lx}px, ${ly}px)`, transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}
            />
            <circle
              cx={35} cy={31} r="4.2" fill="#312e81"
              style={{ transform: `translate(${rx}px, ${ry}px)`, transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}
            />

            {/* Pupil highlights */}
            <circle
              cx={17 + lx + 1.5} cy={31 + ly - 2} r="1.4" fill="white"
              style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
            />
            <circle
              cx={35 + rx + 1.5} cy={31 + ry - 2} r="1.4" fill="white"
              style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
            />

            {/* Mouth — flat concentration line when typing, smile when glancing */}
            {typing ? (
              <line x1="19" y1="42" x2="33" y2="42" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
            ) : (
              <path d="M 17 41 Q 26 48 35 41" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            )}

            {/* Blush */}
            <ellipse cx="8" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />
            <ellipse cx="44" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />

            {/* Keyboard — only when typing */}
            {typing && (
              <>
                {/* Hands alternating up/down */}
                <ellipse
                  cx="17" cy="55" rx="4" ry="2.5" fill="#4f46e5"
                  style={{ transform: handFrame === 0 ? "translateY(-3px)" : "translateY(0px)", transition: "transform 0.14s ease" }}
                />
                <ellipse
                  cx="35" cy="55" rx="4" ry="2.5" fill="#4f46e5"
                  style={{ transform: handFrame === 1 ? "translateY(-3px)" : "translateY(0px)", transition: "transform 0.14s ease" }}
                />
                {/* Keyboard body */}
                <rect x="7" y="58" width="36" height="7" rx="2.5" fill="#4f46e5" opacity="0.7" />
                {/* Keys */}
                <rect x="10" y="60" width="5" height="2.5" rx="1" fill="#a5b4fc" opacity="0.9" />
                <rect x="17" y="60" width="5" height="2.5" rx="1" fill="#a5b4fc" opacity="0.9" />
                <rect x="24" y="60" width="5" height="2.5" rx="1" fill="#a5b4fc" opacity="0.9" />
                <rect x="31" y="60" width="5" height="2.5" rx="1" fill="#a5b4fc" opacity="0.9" />
              </>
            )}

            {/* Stars / sparkles when glancing */}
            {!typing && (
              <>
                <text x="38" y="20" fontSize="8" fill="#fbbf24" opacity="0.9">✦</text>
                <text x="41" y="28" fontSize="5" fill="#fbbf24" opacity="0.7">✦</text>
              </>
            )}
          </svg>
        </div>

        {/* Thought bubble */}
        <div className="flex flex-col gap-2">
          <div className="relative pl-6">
            {/* Comic connector dots */}
            <div className="absolute left-0.5 top-[18px] w-1.5 h-1.5 rounded-full bg-muted border border-border/50" />
            <div className="absolute left-[10px] top-[13px] w-2.5 h-2.5 rounded-full bg-muted border border-border/50" />
            <div className="rounded-2xl border border-border/50 bg-muted px-3.5 py-2.5 max-w-[185px] sm:max-w-[230px]">
              <span
                className="text-[12.5px] leading-snug text-muted-foreground font-medium block"
                style={{
                  opacity: fade ? 1 : 0,
                  transition: "opacity 0.3s ease",
                  minHeight: "1.2em",
                }}
              >
                {PHRASES[phraseIndex]}
              </span>
            </div>
          </div>

          {/* Bouncing dots */}
          <div className="flex gap-1.5 pl-6">
            {[0, 150, 300].map((delay, i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
