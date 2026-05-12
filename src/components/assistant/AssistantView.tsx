import { useState, useCallback, useEffect, useRef } from "react";
import { QuickActions } from "./QuickActions";
import { Composer } from "./Composer";
import { SuggestionsBar, type SuggestionCategory } from "./SuggestionsBar";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles, Download } from "lucide-react";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Turn = { role: "user"; text: string } | { role: "ai"; text: string; card?: boolean };

interface ThreadData {
  id: string;
  turns: Turn[];
}

const initialTurns: Turn[] = [
  {
    role: "user",
    text: "How many leave days do I have left this year, and can I apply for 2 days next Monday?",
  },
  {
    role: "ai",
    text: "You currently have **12 earned leaves** remaining for 2026. Next Monday (May 4) is open on your calendar and clashes with no team OOO. I can file the request with your manager, Priya, in one click.",
    card: true,
  },
];

const initialId = "chat-" + Date.now();

import { useChatStore } from "@/lib/chat-store";

export function AssistantView() {
  const { threads, activeId, thinking, setActiveId, setThinking, addTurn, createThread } =
    useChatStore();
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SuggestionCategory>("all");
  const [showDocModal, setShowDocModal] = useState(false);
  const [docType, setDocType] = useState("project_status_report");
  const [docTitle, setDocTitle] = useState("");
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize first thread if none exists
  useEffect(() => {
    if (!activeId || !threads[activeId]) {
      createThread();
    }
  }, [activeId, threads, createThread]);

  const activeThread = activeId && threads[activeId] ? threads[activeId] : { id: "", turns: [] };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeThread.turns.length, thinking]);

  const send = useCallback(
    (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || !activeId) return;

      // 1. Intercept Software Install requests for approval workflow
      if (
        text.toLowerCase().includes("software install") ||
        text.toLowerCase().includes("install figma")
      ) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Software installations require **Admin Credentials**. I have initiated an approval request to **IT Support (support@centriq.ai)**. Once approved, you will receive an installation link via email.",
          card: false,
        });
        setInput("");
        toast.success("IT Approval Request Sent", {
          description: "Sent to IT Support for software installation.",
        });
        return;
      }

      addTurn(activeId, { role: "user", text });
      setInput("");
      setThinking(true);

      const history = (threads[activeId]?.turns || []).map((t) => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }));

      // Real API call to backend
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to connect to the server");
          return res.json();
        })
        .then((data) => {
          const responseText =
            data.response || "Sorry, I received an empty response from the server.";
          addTurn(activeId, {
            role: "ai",
            text: responseText,
            downloadUrl: data.download_url ?? undefined,
            downloadTitle: data.download_title ?? undefined,
          });
        })
        .catch((err) => {
          console.error("Backend Error:", err);
          toast.error("Assistant is unavailable", {
            description: "Please try again later.",
          });
        })
        .finally(() => {
          setThinking(false);
        });
    },
    [activeId, input, threads, addTurn, setThinking],
  );

  const handleNewChat = () => {
    createThread();
    setIsSidebarOpen(false);
  };

  const handleThreadSelect = (id: string) => {
    setActiveId(id);
    setIsSidebarOpen(false);
  };

  const handleFeedback = (rating: "up" | "down", index: number) => {
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, index, threadId: activeId }),
    })
      .then(() => {
        toast.success(rating === "up" ? "Glad I could help!" : "Thanks for the feedback");
      })
      .catch(() => toast.error("Failed to save feedback"));
  };

  const openDocModal = () => {
    const firstUserTurn = activeThread.turns.find((t) => t.role === "user");
    setDocTitle(firstUserTurn ? firstUserTurn.text.slice(0, 60) : "Centriq Report");
    setShowDocModal(true);
  };

  const handleGenerateDoc = async () => {
    setIsGeneratingDoc(true);
    try {
      const conversationText = activeThread.turns
        .map((t) => `${t.role === "user" ? "User" : "Centriq"}: ${t.text}`)
        .join("\n\n");

      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: docType,
          title: docTitle,
          content: conversationText,
          thread_id: activeId,
          generated_by: "Centriq AI",
        }),
      });

      if (!res.ok) throw new Error("Generation failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${docTitle.replace(/\s+/g, "_").toLowerCase().slice(0, 50)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      setShowDocModal(false);
      toast.success("Document downloaded successfully");
    } catch {
      toast.error("Failed to generate document");
    } finally {
      setIsGeneratingDoc(false);
    }
  };

  const sidebarThreads = Object.values(threads)
    .filter((t) => t.turns.length > 0)
    .map((t) => ({
      id: t.id,
      title: t.turns[0].text,
      domain: "Centriq",
      time: "Now",
    }))
    .reverse();

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-background/80 px-4 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">Centriq AI Chat</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </header>

        {/* Chat Content */}
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scroll-smooth no-scrollbar">
          <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-8">
            {activeThread.turns.length === 0 ? (
              <section className="flex flex-col items-center justify-center text-center py-10 animate-[fade-in_.6s_ease-out_both]">
                <Logo size="xl" className="mb-8 shadow-2xl shadow-primary/20" />

                <h1 className="text-4xl font-black tracking-tight text-foreground sm:text-5xl mb-4">
                  How can I help you today?
                </h1>
                <p className="text-lg text-muted-foreground max-w-2xl mb-12 font-medium">
                  I'm your intelligent workplace assistant. Choose a category below to get started
                  or ask me anything.
                </p>

                <div
                  className={cn(
                    "w-full transition-opacity",
                    thinking && "opacity-50 pointer-events-none",
                  )}
                >
                  <QuickActions onPick={(p) => !thinking && send(p)} />
                </div>
              </section>
            ) : (
              <section className="space-y-10 pb-10">
                {activeThread.turns.map((t, i) =>
                  t.role === "user" ? (
                    <UserMessage key={i}>{t.text}</UserMessage>
                  ) : (
                    <AIMessage key={i} onFeedback={(rating) => handleFeedback(rating, i)}>
                      <div className="space-y-4">
                        <div className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {renderInline(t.text)}
                        </div>
                        {t.downloadUrl && (
                          <a
                            href={t.downloadUrl}
                            download={t.downloadTitle ?? "report"}
                            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95"
                          >
                            <Download className="h-4 w-4" />
                            {t.downloadTitle ?? "Download Report"}
                          </a>
                        )}
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
                                toast.promise(new Promise((resolve) => setTimeout(resolve, 1500)), {
                                  loading: "Processing request...",
                                  success: "Leave request filed with Priya!",
                                  error: "Failed to file request",
                                });
                              },
                            }}
                          />
                        )}
                      </div>
                    </AIMessage>
                  ),
                )}

                {thinking && (
                  <AIMessage live>
                    <div className="flex gap-1.5 py-2">
                      <div
                        className="h-2 w-2 rounded-full bg-primary/40 animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <div
                        className="h-2 w-2 rounded-full bg-primary/40 animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <div
                        className="h-2 w-2 rounded-full bg-primary/40 animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
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
              onAttach={() =>
                toast("Attachments", { description: "This feature is currently in preview." })
              }
              onSuggest={() => {
                toast.promise(new Promise((resolve) => setTimeout(resolve, 1500)), {
                  loading: "Analyzing conversation context...",
                  success: "Suggestions updated based on recent turns.",
                  error: "Could not refresh suggestions",
                });
              }}
              onGenerateDoc={activeThread.turns.length > 0 ? openDocModal : undefined}
            />
          </div>
        </footer>
      </main>
      <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="project_status_report">Project Status Report</option>
                <option value="sprint_summary">Sprint Summary</option>
                <option value="meeting_minutes">Meeting Minutes</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Document Title</label>
              <Input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g. Project Aurora — Sprint 5 Summary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDocModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateDoc} disabled={isGeneratingDoc || !docTitle.trim()}>
              {isGeneratingDoc ? "Generating…" : "Download PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderInline(text: string | undefined) {
  if (!text) return null;
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
