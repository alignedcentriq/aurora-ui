import { useState } from "react";
import { AssistantSidebar } from "./Sidebar";
import { QuickActions } from "./QuickActions";
import { Composer } from "./Composer";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Zap, Menu } from "lucide-react";

type Turn =
  | { role: "user"; text: string }
  | { role: "ai"; text: string; card?: boolean };

const initialTurns: Turn[] = [
  { role: "user", text: "How many leave days do I have left this year, and can I apply for 2 days next Monday?" },
  {
    role: "ai",
    text: "You currently have **12 earned leaves** remaining for 2026. Next Monday (May 4) is open on your calendar and clashes with no team OOO. I can file the request with your manager, Priya, in one click.",
    card: true,
  },
];

export function AssistantView() {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const send = (override?: string) => {
    const text = (override ?? input).trim();
    if (!text) return;
    setTurns((p) => [...p, { role: "user", text }]);
    setInput("");
    setThinking(true);
    // Simulated reply — replace with real AI stream call
    setTimeout(() => {
      setTurns((p) => [
        ...p,
        {
          role: "ai",
          text: `Got it. I pulled the relevant info for “${text}” from HR, IT and Admin systems so you don’t have to switch tabs.`,
        },
      ]);
      setThinking(false);
    }, 900);
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      <AssistantSidebar />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="relative z-10 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-background/40 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-surface/60 text-muted-foreground lg:hidden">
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <span
                className="flex h-1.5 w-1.5 rounded-full bg-emerald-400"
                style={{ boxShadow: "0 0 10px currentColor" }}
              />
              <span className="text-sm font-medium">Workplace Concierge</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
                · HR · IT · Admin · Org
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-surface/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:flex">
              <Zap className="h-3 w-3 text-[color:var(--accent-cyan)]" />
              Avg reply 1.2s
            </div>
            <ThemeToggle />
          </div>
        </header>

        {/* Thread */}
        <div className="relative flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[920px] px-4 py-10 sm:px-8">
            {/* Hero */}
            <section className="mb-10 animate-[fade-in_.6s_ease-out_both]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-surface/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-cyan)] animate-pulse" />
                One assistant · Every workplace system
              </div>
              <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.08]">
                Skip the tabs. <span className="text-gradient">Just ask.</span>
              </h1>
              <p className="mt-3 max-w-[60ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
                Synapse connects HR, IT, Admin and Org tools into one conversation.
                Apply leave, reset VPN, fetch a payslip or raise a ticket — in a
                single message, no system hopping.
              </p>

              <div className="mt-7">
                <QuickActions onPick={(p) => send(p)} />
              </div>
            </section>

            <div className="divider-soft my-8" />

            {/* Conversation */}
            <section className="space-y-8 pb-4">
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <UserMessage key={i} name="Ayesha · You" initials="AK">
                    {t.text}
                  </UserMessage>
                ) : (
                  <AIMessage key={i}>
                    <p className="text-[15px] leading-relaxed text-foreground/90">
                      {renderInline(t.text)}
                    </p>
                    {t.card && (
                      <AnswerCard
                        title="Leave balance · FY 2026"
                        meta="Source: HRMS · Updated just now"
                        rows={[
                          { label: "Earned leave remaining", value: "12 days", highlight: true },
                          { label: "Casual leave", value: "4 days" },
                          { label: "Sick leave", value: "7 days" },
                          { label: "Requested (May 4)", value: "2 days" },
                        ]}
                        cta={{ label: "File request with Priya" }}
                      />
                    )}
                  </AIMessage>
                ),
              )}

              {thinking && (
                <AIMessage live>
                  <div className="inline-flex items-center gap-1.5">
                    <Dot delay={0} />
                    <Dot delay={150} />
                    <Dot delay={300} />
                  </div>
                </AIMessage>
              )}
            </section>
          </div>
        </div>

        {/* Composer */}
        <div className="relative border-t border-[var(--color-border)] bg-gradient-to-t from-background via-background/85 to-background/0 px-4 pb-6 pt-4 sm:px-8">
          <div className="mx-auto w-full max-w-[820px]">
            <Composer value={input} onChange={setInput} onSubmit={() => send()} disabled={thinking} />
          </div>
        </div>
      </main>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-cyan)]"
      style={{
        animation: "pulse-glow 1.2s ease-in-out infinite",
        animationDelay: `${delay}ms`,
        boxShadow: "0 0 8px currentColor",
      }}
    />
  );
}

// Minimal **bold** renderer — keeps the UI lightweight without pulling a markdown lib.
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
