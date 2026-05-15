import { useState, useCallback, useEffect, useRef } from "react";
import { QuickActions } from "./QuickActions";
import { Composer } from "./Composer";
import { SuggestionsBar, type SuggestionCategory } from "./SuggestionsBar";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Download, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { Turn } from "@/lib/chat-store";

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
import { useSettings } from "@/lib/settings-store";

export function AssistantView() {
  const { threads, activeId, thinking, setActiveId, setThinking, addTurn, createThread } =
    useChatStore();
  const { theme } = useSettings();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SuggestionCategory>("all");
  const [showDocModal, setShowDocModal] = useState(false);
  const [docType, setDocType] = useState("project_status_report");
  const [docTitle, setDocTitle] = useState("");
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize a new thread ONLY if one doesn't exist (persistence will restore activeId)
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && !activeId) {
      createThread();
      initialized.current = true;
    }
  }, [createThread, activeId]);

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

      // Always send history now that AI Memory toggle is removed
      const history = (threads[activeId]?.turns || []).map((t) => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }));

      // Real API call to backend
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          session_id: activeId,
          preferences: {},
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errorData = await res
              .json()
              .catch(() => ({ detail: "Failed to connect to the server" }));
            throw new Error(errorData.detail || "Server Error");
          }
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
            domain: data.domain ?? undefined,
          });
        })
        .catch((err) => {
          console.error("Backend Error:", err);
          toast.error("Assistant is unavailable", {
            description: err.message || "Please try again later.",
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
    const turns = (activeId ? threads[activeId]?.turns : undefined) || [];
    const aiTurn = turns[index];
    const prevUserTurn = turns.slice(0, index).reverse().find((t: Turn) => t.role === "user");
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        index,
        threadId: activeId,
        user_message: prevUserTurn?.text || "",
        ai_response: aiTurn?.text || "",
      }),
    })
      .then(() => {
        toast.success(rating === "up" ? "Glad I could help!" : "Thanks for the feedback");
      })
      .catch(() => toast.error("Failed to save feedback"));
  };

  const openDocModal = () => {
    const firstUserTurn = activeThread.turns.find((turn) => turn.role === "user");
    setDocTitle(firstUserTurn ? firstUserTurn.text.slice(0, 60) : "Centriq Report");
    setShowDocModal(true);
  };

  const handleGenerateDoc = async () => {
    if (!activeId) return;

    setIsGeneratingDoc(true);
    try {
      const conversationText = activeThread.turns
        .map((turn) => `${turn.role === "user" ? "User" : "Centriq"}: ${turn.text}`)
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
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${docTitle.replace(/\s+/g, "_").toLowerCase().slice(0, 50)}.pdf`;
      anchor.click();
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
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scroll-smooth no-scrollbar">
          <div className={cn("mx-auto w-full max-w-4xl px-4 sm:px-8 flex flex-col", activeThread.turns.length === 0 ? "min-h-full justify-center py-12" : "py-12")}>
            {activeThread.turns.length === 0 ? (
              <section className="flex w-full flex-col items-center justify-center text-center animate-[fade-in_.6s_ease-out_both] max-w-5xl mx-auto">
                <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl mb-12">
                  Hi, how can I help you?
                </h1>
                
                <div className="w-full max-w-3xl mb-12">
                  <Composer
                    value={input}
                    onChange={setInput}
                    onSubmit={() => send()}
                    disabled={thinking}
                    onAttach={() =>
                      toast("Attachments", { description: "This feature is currently in preview." })
                    }
                    onQuickAction={(p) => !thinking && send(p)}
                  />
                </div>

                <div className="w-full max-w-5xl mt-4">
                  <QuickActions onPick={(p) => !thinking && send(p)} />
                </div>
              </section>
            ) : (
              <section className="space-y-10 pb-10">
                {activeThread.turns.map((t, i) =>
                  t.role === "user" ? (
                    <UserMessage 
                      key={i} 
                      initials={user?.name?.split(" ").map(n => n[0]).join("") || "U"}
                    >
                      {t.text}
                    </UserMessage>
                  ) : (
                    <AIMessage key={i} onFeedback={(rating) => handleFeedback(rating, i)} domain={t.role === "ai" ? t.domain : undefined}>
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
        {activeThread.turns.length > 0 && (
          <footer className="relative border-t border-[var(--border)] bg-background/80 backdrop-blur-md px-4 pb-8 pt-4 sm:px-8">
            <div className="mx-auto w-full max-w-4xl space-y-6">
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={() => send()}
                disabled={thinking}
                onAttach={() =>
                  toast("Attachments", { description: "This feature is currently in preview." })
                }
                onQuickAction={(p) => !thinking && send(p)}
                onGenerateDoc={openDocModal}
              />
            </div>
          </footer>
        )}
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
                onChange={(event) => setDocType(event.target.value)}
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
                onChange={(event) => setDocTitle(event.target.value)}
                placeholder="e.g. Project Aurora Sprint 5 Summary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDocModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateDoc} disabled={isGeneratingDoc || !docTitle.trim()}>
              {isGeneratingDoc ? "Generating..." : "Download PDF"}
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
