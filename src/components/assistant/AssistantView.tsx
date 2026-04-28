import { useState, useCallback, useEffect, useRef } from "react";
import { AssistantSidebar } from "./Sidebar";
import { QuickActions } from "./QuickActions";
import { Composer } from "./Composer";
import { SuggestionsBar, type SuggestionCategory } from "./SuggestionsBar";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Zap, Menu, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Turn =
  | { role: "user"; text: string }
  | { role: "ai"; text: string; card?: boolean };

interface ThreadData {
  id: string;
  turns: Turn[];
}

const initialTurns: Turn[] = [
  { role: "user", text: "How many leave days do I have left this year, and can I apply for 2 days next Monday?" },
  {
    role: "ai",
    text: "You currently have **12 earned leaves** remaining for 2026. Next Monday (May 4) is open on your calendar and clashes with no team OOO. I can file the request with your manager, Priya, in one click.",
    card: true,
  },
];

export function AssistantView() {
  const [activeId, setActiveId] = useState("1");
  const [threads, setThreads] = useState<Record<string, ThreadData>>({
    "1": { id: "1", turns: initialTurns },
    "2": { id: "2", turns: [{ role: "user", text: "Reset my VPN access" }, { role: "ai", text: "I've started the VPN reset process. You'll receive an OTP on your registered mobile number shortly." }] },
  });
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SuggestionCategory>("all");
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeThread = threads[activeId] || { id: activeId, turns: [] };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeThread.turns.length, thinking]);

  const send = useCallback((override?: string) => {
    const text = (override ?? input).trim();
    if (!text) return;

    // 1. Intercept Software Install requests for approval workflow
    if (text.toLowerCase().includes("software install") || text.toLowerCase().includes("install figma")) {
      setThreads((prev) => {
        const current = prev[activeId] || { id: activeId, turns: [] };
        return {
          ...prev,
          [activeId]: {
            ...current,
            turns: [
              ...current.turns,
              { role: "user", text },
              {
                role: "ai",
                text: "Software installations require **Admin Credentials**. I have initiated an approval request to **IT Support (support@nexus.ai)**. Once approved, you will receive an installation link via email.",
                card: false,
              }
            ],
          },
        };
      });
      setInput("");
      toast.success("IT Approval Request Sent", {
        description: "Sent to IT Support for software installation."
      });
      return;
    }

    setThreads((prev) => {
      const current = prev[activeId] || { id: activeId, turns: [] };
      return {
        ...prev,
        [activeId]: {
          ...current,
          turns: [...current.turns, { role: "user", text }],
        },
      };
    });

    setInput("");
    setThinking(true);

    const history = (threads[activeId]?.turns || []).map(t => ({
      role: t.role === "user" ? "user" : "assistant",
      content: t.text
    }));

    // Real API call to FastAPI backend
    fetch("http://localhost:8000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch from backend");
        return res.json();
      })
      .then(data => {
        setThreads((prev) => {
          const current = prev[activeId] || { id: activeId, turns: [] };
          return {
            ...prev,
            [activeId]: {
              ...current,
              turns: [
                ...current.turns,
                {
                  role: "ai",
                  text: data.response,
                },
              ],
            },
          };
        });
      })
      .catch(err => {
        console.error("Backend Error:", err);
        toast.error("Assistant is unavailable", {
          description: "Check if the backend is running at http://localhost:8000"
        });
      })
      .finally(() => {
        setThinking(false);
      });
  }, [activeId, input, threads]);

  const handleNewChat = () => {
    const newId = Date.now().toString();
    setThreads((prev) => ({
      ...prev,
      [newId]: { id: newId, turns: [] },
    }));
    setActiveId(newId);
    toast.success("New conversation started");
  };

  const handleThreadSelect = (id: string) => {
    setActiveId(id);
    setIsSidebarOpen(false);
  };

  const handleFeedback = (rating: "up" | "down", index: number) => {
    fetch("http://localhost:8000/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, index, threadId: activeId })
    })
      .then(() => {
        toast.success(rating === "up" ? "Glad I could help!" : "Thanks for the feedback");
      })
      .catch(() => toast.error("Failed to save feedback"));
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background">
      <AssistantSidebar
        activeId={activeId}
        onSelect={handleThreadSelect}
        onNewChat={handleNewChat}
        onSettings={() => toast("Settings", { description: "Manage your preferences and model configurations." })}
        onHelp={() => toast("Help Center", { description: "Explore documentation and guides for Nexus AI." })}
        className={isSidebarOpen ? "flex fixed inset-0 z-50 lg:relative lg:z-auto" : ""}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-background/80 px-4 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-secondary/50 text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">Nexus AI</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </header>

        {/* Chat Content */}
        <div 
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto scroll-smooth no-scrollbar"
        >
          <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-8">
            {activeThread.turns.length === 0 ? (
              <section className="flex flex-col items-center justify-center text-center py-10 animate-[fade-in_.6s_ease-out_both]">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-semibold text-gray-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                  <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
                  AI-Powered Workplace Assistant
                </div>
                
                <h1 className="text-5xl font-black tracking-tight text-gray-900 dark:text-white sm:text-6xl mb-6 leading-tight">
                  How can I help you today?
                </h1>
                <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mb-12 font-medium leading-relaxed">
                  Get instant answers to HR, Admin, IT, and organizational questions. No waiting, no friction — just fast, reliable help.
                </p>

                <div className="w-full">
                  <QuickActions onPick={(p) => send(p)} />
                </div>
              </section>
            ) : (
              <section className="space-y-10 pb-10">
                {activeThread.turns.map((t, i) =>
                  t.role === "user" ? (
                    <UserMessage key={i}>
                      {t.text}
                    </UserMessage>
                  ) : (
                    <AIMessage key={i} onFeedback={(rating) => handleFeedback(rating, i)}>
                      <div className="space-y-4">
                        <div className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {renderInline(t.text)}
                        </div>
                        {t.card && (
                          <AnswerCard
                            title="Leave Balance · 2026"
                            meta="System Source: HR Connect"
                            rows={[
                              { label: "Total Earned Leaves", value: "12 days", highlight: true },
                              { label: "Casual Leaves", value: "4 days" },
                              { label: "Sick Leaves", value: "7 days" },
                              { label: "Upcoming (May 4)", value: "2 days" },
                            ]}
                            cta={{
                              label: "File Leave Request",
                              onClick: () => {
                                toast.promise(new Promise(resolve => setTimeout(resolve, 1500)), {
                                  loading: 'Processing request...',
                                  success: 'Leave request filed with Priya!',
                                  error: 'Failed to file request',
                                });
                              }
                            }}
                          />
                        )}
                      </div>
                    </AIMessage>
                  )
                )}

                {thinking && (
                  <AIMessage live>
                    <div className="flex gap-1.5 py-2">
                      <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </AIMessage>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Input Area */}
        <footer className="relative border-t border-[var(--border)] bg-background/80 backdrop-blur-md px-4 pb-8 pt-4 sm:px-8">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            {activeThread.turns.length > 0 && (
              <SuggestionsBar
                activeCategory={activeCategory}
                onCategoryChange={setActiveCategory}
                onSelect={(text) => send(text)}
              />
            )}
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={() => send()}
              disabled={thinking}
              onAttach={() => toast("Attachments", { description: "This feature is currently in preview." })}
              onSuggest={() => {
                toast.promise(new Promise(resolve => setTimeout(resolve, 1500)), {
                  loading: 'Analyzing conversation context...',
                  success: 'Suggestions updated based on recent turns.',
                  error: 'Could not refresh suggestions',
                });
              }}
            />
          </div>
        </footer>
      </main>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-bold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
