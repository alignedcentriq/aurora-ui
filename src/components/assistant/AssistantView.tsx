import { useState, useCallback, useEffect, useRef } from "react";
import { Composer } from "./Composer";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Download, Sparkles, WifiOff, X, ArrowDown } from "lucide-react";
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
import { InteractiveEmailDraft } from "./InteractiveEmailDraft";
import { ParkingForm } from "./ParkingForm";
import { ThinkingBuddy } from "./ThinkingBuddy";
import { SmartWidgets } from "./SmartWidgets";
import { motion, AnimatePresence } from "framer-motion";

import type { Turn } from "@/lib/chat-store";

function getGreeting(name: string): { heading: string; subheading: string } {
  const firstName = name.split(" ")[0];
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 9) {
    return { heading: `Early start, ${firstName}.`, subheading: "Let's make the most of the morning." };
  } else if (hour >= 9 && hour < 12) {
    return { heading: `Good morning, ${firstName}.`, subheading: "What can I help you with today?" };
  } else if (hour >= 12 && hour < 14) {
    return { heading: `Good afternoon, ${firstName}.`, subheading: "What's on your plate?" };
  } else if (hour >= 14 && hour < 17) {
    return { heading: `Afternoon, ${firstName}.`, subheading: "How can I help you power through the day?" };
  } else if (hour >= 17 && hour < 20) {
    return { heading: `Good evening, ${firstName}.`, subheading: "Wrapping up or just getting started?" };
  } else if (hour >= 20 && hour < 23) {
    return { heading: `Night owl mode, ${firstName}.`, subheading: "I'm here. What's on your mind?" };
  } else {
    return { heading: `Up late, ${firstName}.`, subheading: "The quiet hours. What do you need?" };
  }
}

interface ThreadData {
  id: string;
  turns: Turn[];
}

import { useChatStore } from "@/lib/chat-store";
import { useSettings } from "@/lib/settings-store";

export function AssistantView() {
  const { threads, activeId, thinking, setActiveId, setThinking, addTurn, createThread } =
    useChatStore();
  const { theme } = useSettings();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docType, setDocType] = useState("project_status_report");
  const [docTitle, setDocTitle] = useState("");
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [activity, setActivity] = useState("");
  const [vpnWarning, setVpnWarning] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Create a thread whenever there is no active one
  useEffect(() => {
    if (!activeId) {
      createThread();
    }
  }, [activeId, createThread]);

  // Clear suggestion chips whenever the active thread changes
  useEffect(() => {
    setSuggestions([]);
  }, [activeId]);

  // Listen for quick-action events from CommandPalette
  useEffect(() => {
    const handler = (e: CustomEvent<{ prompt: string }>) => {
      if (e.detail?.prompt) {
        send(e.detail.prompt);
      }
    };
    window.addEventListener("centriq:quick-action", handler as EventListener);
    return () => window.removeEventListener("centriq:quick-action", handler as EventListener);
  }, [activeId, threads]);

  // Check LLM reachability on mount
  useEffect(() => {
    fetch("/api/health/llm")
      .then((res) => { if (!res.ok) setVpnWarning(true); })
      .catch(() => { /* backend itself unreachable */ });
  }, []);

  // Poll health endpoint while VPN warning is active
  useEffect(() => {
    if (!vpnWarning) return;
    const id = setInterval(() => {
      fetch("/api/health/llm")
        .then((res) => {
          if (res.ok) {
            setVpnWarning(false);
            toast.success("VPN connected", { description: "You're back on the office network." });
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [vpnWarning]);

  const activeThread = activeId && threads[activeId] ? threads[activeId] : { id: "", turns: [] };

  // Scroll handling
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeThread.turns.length, thinking]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const send = useCallback(
    (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || !activeId) return;

      // Intercept parking sticker requests
      if (
        text.toLowerCase().includes("parking sticker") ||
        (text.toLowerCase().includes("parking") && text.toLowerCase().includes("sticker"))
      ) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Please fill in your vehicle details below to submit a parking sticker request.",
          interactive: { type: "parking_form" },
        });
        setInput("");
        return;
      }

      setSuggestions([]);
      addTurn(activeId, { role: "user", text });
      setInput("");
      setThinking(true);

      const history = (threads[activeId]?.turns || []).map((t) => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }));

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 180000);
      const activitySteps = getActivitySteps(text);
      setActivity(activitySteps[0]);
      const activityTimers = activitySteps
        .slice(1)
        .map((step, index) => window.setTimeout(() => setActivity(step), (index + 1) * 1800));

      fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(user?.email ? { "x-user-email": user.email } : {}),
          ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
        },
        body: JSON.stringify({
          message: text,
          history,
          session_id: activeId,
          preferences: {},
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const detail = errorData.detail;
            if (detail && typeof detail === "object" && detail.code === "VPN_REQUIRED") {
              setVpnWarning(true);
              const err = new Error(detail.message) as Error & { code: string };
              err.code = "VPN_REQUIRED";
              throw err;
            }
            throw new Error(typeof detail === "string" ? detail : "Server error. Please try again.");
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
            interactive: data.interactive ?? undefined,
            images: Array.isArray(data.images) && data.images.length > 0 ? data.images : undefined,
          });
          // Fetch contextual follow-up suggestions
          fetch("/api/suggestions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(user?.email ? { "x-user-email": user.email } : {}),
            },
            body: JSON.stringify({
              message: text,
              response: responseText,
              domain: data.domain ?? "general",
            }),
          })
            .then((r) => (r.ok ? r.json() : { suggestions: [] }))
            .then((d) => {
              if (Array.isArray(d.suggestions) && d.suggestions.length > 0) {
                setSuggestions(d.suggestions);
              }
            })
            .catch(() => {});
        })
        .catch((err: Error & { code?: string }) => {
          console.error("Backend Error:", err);
          const isVpn = err.code === "VPN_REQUIRED";
          const isTimeout = err.name === "AbortError";

          addTurn(activeId, {
            role: "ai",
            text: isVpn
              ? "I can't reach the AI service right now.\n\n**You appear to be outside the office network.** Please connect to the VPN and try again."
              : isTimeout
              ? "This request is taking too long, so I stopped waiting. Please try again, or check the backend logs for the step that stalled."
              : "I couldn't complete that request right now. Please try again in a moment.",
          });

          if (isVpn) {
            toast.error("VPN not connected", {
              description: "Connect to the office VPN to use Centriq AI.",
              duration: 8000,
            });
          } else {
            toast.error("Service unavailable", {
              description: isTimeout
                ? "The request timed out after 90 seconds."
                : err.message || "Please try again later.",
            });
          }
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          activityTimers.forEach((timer) => window.clearTimeout(timer));
          setActivity("");
          setThinking(false);
        });
    },
    [activeId, input, threads, addTurn, setThinking, user?.email, user?.role],
  );

  const handleNewChat = () => {
    createThread();
    setIsSidebarOpen(false);
  };

  const handleThreadSelect = (id: string) => {
    setActiveId(id);
    setIsSidebarOpen(false);
  };

  const handleFeedback = (rating: "up" | "down", index: number, feedbackText?: string) => {
    const turns = (activeId ? threads[activeId]?.turns : undefined) || [];
    const aiTurn = turns[index];
    const prevUserTurn = turns.slice(0, index).reverse().find((t: Turn) => t.role === "user");
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        threadId: activeId,
        domain: aiTurn?.role === "ai" ? aiTurn.domain : undefined,
        user_message: prevUserTurn?.text || "",
        ai_response: aiTurn?.text || "",
        feedback_text: feedbackText || "",
      }),
    })
      .then(() => {
        if (rating === "up") toast.success("Glad I could help!");
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

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* VPN Warning */}
        <AnimatePresence>
          {vpnWarning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300 overflow-hidden"
            >
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>
                <strong>VPN not connected</strong> — You appear to be outside the office network. Connect to the VPN to use Centriq AI.
              </span>
              <button
                onClick={() => setVpnWarning(false)}
                className="ml-auto shrink-0 rounded-lg p-1 text-amber-700 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-800/40 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages Area */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto scroll-smooth"
        >
          <div className={cn(
            "mx-auto w-full max-w-4xl px-4 sm:px-8 flex flex-col",
            activeThread.turns.length === 0 ? "min-h-full justify-center py-8" : "py-8",
          )}>
            {activeThread.turns.length === 0 ? (
              /* ──── Empty State ──── */
              <motion.section
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }}
                className="flex w-full flex-col items-center justify-center text-center max-w-5xl mx-auto"
              >
                {(() => {
                  const { heading, subheading } = getGreeting(user?.name || "there");
                  return (
                    <>
                      <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                        className="text-4xl font-extrabold tracking-tight sm:text-5xl mb-2"
                      >
                        <span className="text-gradient">{heading}</span>
                      </motion.h1>
                      <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="text-base text-muted-foreground mb-8"
                      >
                        {subheading}
                      </motion.p>
                    </>
                  );
                })()}

                {/* Smart Widgets */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="w-full max-w-3xl mb-8"
                >
                  <SmartWidgets onAction={(prompt) => !thinking && send(prompt)} />
                </motion.div>

                {/* Composer */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.45 }}
                  className="w-full max-w-3xl"
                >
                  <Composer
                    value={input}
                    onChange={setInput}
                    onSubmit={() => send()}
                    disabled={thinking}
                    onAttach={() =>
                      toast("Attachments", { description: "This feature is currently in preview." })
                    }
                    onQuickAction={(p) => !thinking && send(p)}
                    suggestions={suggestions}
                    onSuggestionSelect={(t) => !thinking && send(t)}
                  />
                </motion.div>
              </motion.section>
            ) : (
              /* ──── Chat Messages ──── */
              <section className="space-y-6 pb-6">
                <AnimatePresence mode="popLayout">
                  {activeThread.turns.map((t, i) =>
                    t.role === "user" ? (
                      <motion.div
                        key={`msg-${i}`}
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        layout
                      >
                        <UserMessage
                          initials={user?.name?.split(" ").map(n => n[0]).join("") || "U"}
                        >
                          {t.text}
                        </UserMessage>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`msg-${i}`}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 300,
                          damping: 30,
                          delay: 0.05,
                        }}
                        layout
                      >
                        <AIMessage
                          onFeedback={(rating, feedbackText) => handleFeedback(rating, i, feedbackText)}
                          domain={t.role === "ai" ? t.domain : undefined}
                          text={t.text}
                        >
                          <div className="space-y-4">
                            {t.text && (
                              <div className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                                {renderInline(t.text)}
                              </div>
                            )}
                            {t.images && t.images.length > 0 && (
                              <div className="mt-3 flex flex-col gap-3">
                                {t.images.map((url, imgIdx) => (
                                  <a key={imgIdx} href={url} target="_blank" rel="noopener noreferrer">
                                    <img
                                      src={url}
                                      alt={`Policy image ${imgIdx + 1}`}
                                      className="max-w-full rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
                                      loading="lazy"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}
                            {t.downloadUrl && (
                              <motion.a
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.97 }}
                                href={t.downloadUrl}
                                download={t.downloadTitle ?? "report"}
                                className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
                              >
                                <Download className="h-4 w-4" />
                                {t.downloadTitle ?? "Download Report"}
                              </motion.a>
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
                            {t.interactive?.type === "parking_form" && (
                              <ParkingForm
                                userEmail={user?.email || ""}
                                onSubmitted={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "email_draft" && t.interactive.data && (
                              <InteractiveEmailDraft
                                data={t.interactive.data}
                                userEmail={user?.email}
                                onSent={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "it_support" })
                                }
                              />
                            )}
                          </div>
                        </AIMessage>
                      </motion.div>
                    ),
                  )}
                </AnimatePresence>

                {/* Thinking state */}
                <AnimatePresence>
                  {thinking && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      <AIMessage live>
                        <ThinkingBuddy />
                      </AIMessage>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}
          </div>

          {/* Scroll-to-bottom FAB */}
          <AnimatePresence>
            {showScrollBtn && activeThread.turns.length > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={scrollToBottom}
                className="fixed bottom-28 right-8 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-card border border-border shadow-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowDown className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area — visible when there are messages */}
        {activeThread.turns.length > 0 && (
          <motion.footer
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative border-t border-border bg-background/60 backdrop-blur-xl px-4 pb-6 pt-4 sm:px-8"
          >
            <div className="mx-auto w-full max-w-4xl space-y-4">
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
                suggestions={suggestions}
                onSuggestionSelect={(t) => !thinking && send(t)}
              />
            </div>
          </motion.footer>
        )}
      </main>

      {/* Document Generation Modal */}
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
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
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

function getActivitySteps(text: string) {
  const lower = text.toLowerCase();
  if (
    lower.includes("install") ||
    lower.includes("software") ||
    lower.includes("nodejs") ||
    lower.includes("node.js") ||
    lower.includes("figma")
  ) {
    return ["Routing to IT Support...", "Preparing email draft...", "Waiting for response..."];
  }

  if (/\b(yes|send|confirm|ok|okay)\b/.test(lower)) {
    return ["Checking pending draft...", "Sending email...", "Finalizing response..."];
  }

  return ["Routing request...", "Selecting the right service...", "Preparing response..."];
}
