import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Composer } from "./Composer";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Download, Sparkles, WifiOff, X, ArrowDown, BookOpen, Library as LibraryIcon } from "lucide-react";
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
import { VisitorPassForm } from "./VisitorPassForm";
import { RoomBookingWidget } from "./RoomBookingWidget";
import { CancelBookingWidget } from "./CancelBookingWidget";
import { MyScheduleWidget } from "./MyScheduleWidget";
import { SkillsEditorWidget } from "./SkillsEditorWidget";
import { AnnouncementWidget } from "./AnnouncementWidget";
import { PromptConfigWidget } from "./PromptConfigWidget";
import { VoiceOrb } from "./VoiceOrb";
import { ThinkingBuddy } from "./ThinkingBuddy";
import { SmartWidgets } from "./SmartWidgets";
import { useVoiceStore } from "@/lib/voice-store";
import { createRecognition, resetSpeech, enqueueFrom, cancelSpeech } from "@/lib/speech";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Turn } from "@/lib/chat-store";
import { QUICK_QUERIES } from "@/lib/quickQueries";

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

// ── Book intent helpers ─────────────────────────────────────────────────────
// Client-side intercept for the most common book-discovery / status / return /
// extension intents. Matches the same phrasings the backend router covers, so
// the user is taken straight to the right page without waiting for an LLM call.

const BOOK_DISCOVER_RE = /\b(?:bookshelf|book\s*shelf|company\s+library|office\s+library|library\s+(?:catalog|catalogue|books?)|available\s+books?|books?\s+available|browse\s+(?:the\s+)?(?:library|books)|show\s+(?:me\s+)?(?:some\s+|the\s+|any\s+)?(?:books?|library)|recommend\s+(?:me\s+)?(?:a\s+)?book|(?:i\s+)?(?:want|need|like)\s+(?:a\s+|an\s+|some\s+)?book|looking\s+for\s+(?:a\s+|an\s+|some\s+)?(?:book|reading\s+material|something\s+to\s+read)|(?:learning|reading|study)\s+material|borrow\s+a\s+book|issue\s+a\s+book|lend\s+me\s+a\s+book)\b/i;

const BOOK_MY_RE = /\b(?:my\s+(?:borrowed\s+)?(?:books?|library|borrows?|book\s+requests?)|books?\s+i\s+(?:have\s+)?borrowed|check\s+(?:my\s+)?book\s+request|my\s+book\s+request\s+status|return\s+(?:my\s+|the\s+|a\s+)?book|i\s+(?:have\s+)?finished\s+(?:reading|the\s+book)|extend\s+(?:my\s+|the\s+)?(?:book|due\s+date|borrow)|renew\s+(?:my\s+|the\s+|a\s+)?book|(?:need|want)\s+more\s+time\s+(?:on|for|with)\s+(?:my\s+|the\s+)?book)\b/i;

// Stationery-style phrases that look like book intents but are not.
const NOT_BOOK_RE = /\bborrow\s+(?:a\s+)?(?:pen|pencil|charger|cable|notebook(?!\s+book)|stapler|marker)\b/i;

function detectBookIntent(text: string): { path: string; label: string; reply: string } | null {
  const t = text.toLowerCase();
  if (NOT_BOOK_RE.test(t)) return null;
  if (BOOK_MY_RE.test(t)) {
    return {
      path: "/my-library",
      label: "Open My Library",
      reply: "Opening **My Library** so you can manage your borrows, requests, and extensions.",
    };
  }
  if (BOOK_DISCOVER_RE.test(t)) {
    return {
      path: "/books",
      label: "Open Book Catalog",
      reply: "Opening the **company library** — browse and request any book you'd like.",
    };
  }
  return null;
}

export function AssistantView() {
  const { threads, activeId, thinkingThreads, setActiveId, setThinking, addTurn, updateLastAITurn, createThread } =
    useChatStore();
  // The active chat is "thinking" only if it is the thread currently generating a response
  // (pre-first-token phase — drives the ThinkingBuddy bubble).
  const thinking = activeId ? !!thinkingThreads[activeId] : false;
  // "busy" stays true for the whole in-flight response (thinking OR tokens still streaming),
  // so the Stop button and input lock persist until the active chat's reply completes.
  const activeTurnsForBusy = (activeId && threads[activeId]?.turns) || [];
  const lastActiveTurn = activeTurnsForBusy[activeTurnsForBusy.length - 1];
  const busy = thinking || (lastActiveTurn?.role === "ai" && lastActiveTurn.streaming === true);
  const { theme } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docType, setDocType] = useState("project_status_report");
  const [docTitle, setDocTitle] = useState("");
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [activity, setActivity] = useState("");
  const [vpnWarning, setVpnWarning] = useState(false);
  const [vpnRetrying, setVpnRetrying] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [starterPage, setStarterPage] = useState(0);

  // Hands-free voice mode ("Jarvis")
  const { voiceMode, voiceState, setVoiceState, setLiveTranscript } = useVoiceStore();
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const lastSpokenIndexRef = useRef(-1);
  const lastSpokenLenRef = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);

  // In-flight request control, keyed by thread id, so each chat can be stopped
  // independently and a stopped abort isn't mistaken for a timeout.
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const stoppedRef = useRef<Set<string>>(new Set());

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

  // Cycle starter prompts every 4s on empty state
  const STARTER_PAGE_SIZE = 3;
  const starterTotal = Math.ceil(QUICK_QUERIES.length / STARTER_PAGE_SIZE);
  useEffect(() => {
    const id = setInterval(() => setStarterPage((p) => (p + 1) % starterTotal), 4000);
    return () => clearInterval(id);
  }, [starterTotal]);

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

  const retryVpn = () => {
    setVpnRetrying(true);
    fetch("/api/health/llm")
      .then((res) => {
        if (res.ok) {
          setVpnWarning(false);
          toast.success("VPN connected", { description: "You're back on the office network." });
        } else {
          toast.error("Still unreachable", { description: "Check your VPN connection and try again." });
        }
      })
      .catch(() => toast.error("Still unreachable", { description: "Check your VPN connection and try again." }))
      .finally(() => setVpnRetrying(false));
  };

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

  // Parse room-booking entities from a natural-language message (no LLM)
  function parseRoomBooking(text: string) {
    const lower = text.toLowerCase();

    // Date: "tomorrow" / "today"
    let date: string | undefined;
    const localISO = (offsetDays = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    };
    if (/\btomorrow\b/.test(lower)) date = localISO(1);
    else if (/\btoday\b/.test(lower)) date = localISO(0);

    // Time range: "10 am to 11 am", "10:30am-11:30am", "10 to 11 pm"
    let startTime: string | undefined;
    let endTime: string | undefined;
    const to24 = (h: number, m: number, p: string) => {
      let hr = h;
      if (p.toLowerCase() === "pm" && h !== 12) hr = h + 12;
      if (p.toLowerCase() === "am" && h === 12) hr = 0;
      return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    const tRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
    const tm = text.match(tRe);
    if (tm) {
      const p2 = tm[6];
      const p1 = tm[3] ?? p2;
      startTime = to24(parseInt(tm[1]), parseInt(tm[2] ?? "0"), p1);
      endTime   = to24(parseInt(tm[4]), parseInt(tm[5] ?? "0"), p2);
    }

    // Room hint: words after "book"/"reserve" before a preposition/date word
    let roomHint: string | undefined;
    const rRe = /\b(?:book|reserve)(?:ing)?\s+([\w\s]+?)\s+(?:for\b|on\b|at\b|from\b|tomorrow\b|today\b|\d)/i;
    const rm = text.match(rRe);
    if (rm) roomHint = rm[1].trim();

    // Title: after "title", "titled", "called"
    let title: string | undefined;
    const titRe = /\b(?:title(?:d)?|called)\s+([^\n]+?)(?:\s+(?:no\s+attendees?|with(?:\s+no)?\s+attendees?|attendees?\s*(?:needed)?)\b.*)?$/i;
    const tit = text.match(titRe);
    if (tit) title = tit[1].trim().replace(/\s+(?:no\s+attendees?|attendees?\s*(?:needed)?).*$/i, "").trim();

    // Attendees: explicit "no attendees" → empty string
    let attendees: string | undefined;
    if (/\bno\s+attendees?\b/.test(lower) || /\battendees?\s+(?:not\s+)?needed\b/.test(lower)) attendees = "";

    return { date, startTime, endTime, roomHint, title, attendees };
  }

  // Parse an announcement command (no LLM). Structural — keyword for the
  // domain, topic after "about/titled/saying", remainder becomes the body.
  function parseAnnouncement(text: string) {
    const lower = text.toLowerCase();
    const DOMAIN_KW: Record<string, string> = {
      hr: "hr", "human resource": "hr",
      it: "it_support", "it support": "it_support", tech: "it_support",
      pmo: "pmo", project: "pmo",
      admin: "admin", facilit: "admin", office: "admin",
    };
    let domain: string | undefined;
    let category: string | undefined;
    for (const [kw, dom] of Object.entries(DOMAIN_KW)) {
      if (lower.includes(kw)) { domain = dom; break; }
    }
    if (/\bholiday\b/.test(lower)) category = "Holiday";
    else if (/\bpolicy\b/.test(lower)) category = "Policy Update";
    else if (/\bhiring\b|\bjob\b/.test(lower)) category = "Hiring";
    else if (/\btraining\b/.test(lower)) category = "Training";
    else if (/\bevent\b/.test(lower)) category = "Events";

    let title: string | undefined;
    const m = text.match(/\b(?:about|titled|called|saying|regarding|on)\s+(.+)$/i);
    if (m) title = m[1].trim().replace(/[.?!]+$/, "");
    return { title, category, domain } as { title?: string; category?: string; domain?: string };
  }

  // Parse a prompt-config command (no LLM). Domain keyword + section + value.
  function parsePromptConfig(text: string) {
    const lower = text.toLowerCase();
    const DOMAIN_KW: Record<string, string> = {
      hr: "hr", "human resource": "hr",
      "it support": "it_support", it: "it_support",
      pmo: "pmo", project: "pmo",
      admin: "admin",
      manager: "functional_manager",
    };
    let domain: string | undefined;
    for (const [kw, dom] of Object.entries(DOMAIN_KW)) {
      if (lower.includes(kw)) { domain = dom; break; }
    }
    const promptKey = /\bguardrail\b/.test(lower) ? "guardrail" : "system_prompt";
    let value: string | undefined;
    const m = text.match(/\b(?:to|say(?:ing)?|that|with)\s+(.+)$/i);
    if (m) value = m[1].trim();
    return { domain, promptKey, value } as { domain?: string; promptKey?: string; value?: string };
  }

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

      // Intercept book-related intents → route to /books or /my-library directly.
      // This is the spec's "User Query → Intent Detection → Route to Page" path.
      const bookIntent = detectBookIntent(text);
      if (bookIntent) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: `${bookIntent.reply}\n\n<<NAV:${bookIntent.path}|${bookIntent.label}>>`,
          domain: "admin",
        });
        setInput("");
        // Auto-navigate a moment later so the message is visible first.
        window.setTimeout(() => navigate({ to: bookIntent.path }), 400);
        return;
      }

      // Intercept room booking requests.
      // Matches: "book/reserve a room", "book [named room] for/on/at [time or date]"
      // Does NOT rely on hardcoded room names — uses structure instead.
      const isRoomBooking =
        /\b(book|reserve)\b.{0,40}\b(room|conference|meeting room|conf room)\b/i.test(text) ||
        /\b(room|conference room|meeting room)\b.{0,40}\b(book|reserve|available|free)\b/i.test(text) ||
        /\b(?:book|reserve)\s+\w[\w\s]{1,25}\s+(?:for|on|at)\s+(?:tomorrow|today|\d{1,2}(?:\s*(?:am|pm|:\d)))/i.test(text);
      if (isRoomBooking) {
        const prefill = parseRoomBooking(text);
        const hasContext = !!(prefill.roomHint && prefill.date && prefill.startTime && prefill.endTime);
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: hasContext
            ? "On it — checking availability and booking your room."
            : "Let's book a meeting room. Pick your date, time, and duration — I'll show you what's available.",
          interactive: { type: "room_booking_form", data: prefill },
        });
        setInput("");
        return;
      }

      // Intercept room cancellation requests
      if (/\b(cancel|cancell?ation|delete|remove)\b.{0,30}\b(booking|reservation|room|meeting room|conference)\b/i.test(text) ||
          /\b(booking|reservation|room booking)\b.{0,30}\b(cancel|delete|remove)\b/i.test(text)) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Here are your upcoming room bookings — select one to cancel.",
          interactive: { type: "cancel_booking_form" },
        });
        setInput("");
        return;
      }

      // Intercept "show my schedule / my meetings / upcoming bookings" — read-only calendar pull, zero LLM.
      if (
        /\b(my|today'?s|upcoming|this week'?s)\b.{0,20}\b(schedule|meetings?|calendar|bookings?|agenda)\b/i.test(text) ||
        /\bwhat('?s| is| are)\b.{0,30}\b(my )?(schedule|meetings?|calendar|agenda)\b/i.test(text)
      ) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Here's what's on your calendar.",
          interactive: { type: "my_schedule" },
        });
        setInput("");
        return;
      }

      // Intercept "update/add my skills / certifications", "set primary skill",
      // "years of experience". Self-serve for all roles — zero LLM. Structural, not name-based.
      const isSkillsEditor =
        /\b(update|edit|add|change|manage|set)\b.{0,30}\b(skill|skills|certification|certificate|cert|expertise)\b/i.test(text) ||
        /\b(skill|skills|certification|certificate|expertise)\b.{0,30}\b(update|edit|add|upload|manage|change)\b/i.test(text) ||
        /\bprimary skill\b/i.test(text) ||
        /\byears? of experience\b/i.test(text) ||
        /\bupload\b.{0,20}\bcertif/i.test(text);
      if (isSkillsEditor) {
        const m = text.match(/\badd\s+(?:a\s+|an\s+|my\s+)?([A-Za-z][A-Za-z0-9+.# ]{1,30}?)\s+(?:skill|certification|cert)\b/i);
        const prefill = { skill: m?.[1]?.trim() };
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Here's your skills profile — add or update skills, set your primary skill, years of experience, when you last used it, and attach a certification.",
          interactive: { type: "skills_editor", data: prefill },
        });
        setInput("");
        return;
      }

      // Admin commands — only for domain managers; others fall through to chat.
      const role = (user?.role || "employee").toLowerCase();
      const isManager = ["hr", "it", "pmo", "admin"].includes(role);

      // Intercept "create/add an announcement …"
      if (isManager && /\b(create|add|post|publish|make|send)\b.{0,40}\bannouncement\b/i.test(text)) {
        const prefill = parseAnnouncement(text);
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Let's publish an announcement. Review the details below — add a message or let me draft one, then publish.",
          interactive: { type: "announcement_form", data: prefill },
        });
        setInput("");
        return;
      }

      // Intercept "update/change the … prompt/guardrail/system prompt …"
      if (
        isManager &&
        /\b(update|change|edit|set|add|configure|tweak)\b.{0,40}\b(prompt|config(?:uration)?|guardrail|system prompt|instruction)\b/i.test(text)
      ) {
        const prefill = parsePromptConfig(text);
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, {
          role: "ai",
          text: "Here's the prompt configuration — confirm the domain and section, edit the text, then save.",
          interactive: { type: "prompt_config_form", data: prefill },
        });
        setInput("");
        return;
      }

      // Pin the originating thread so the streaming closure writes to the chat that
      // asked, even if the user switches to another chat mid-response.
      const threadId = activeId;

      setSuggestions([]);
      addTurn(threadId, { role: "user", text });
      setInput("");
      setThinking(threadId, true);

      const history = (threads[threadId]?.turns || []).map((t) => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }));

      const controller = new AbortController();
      controllersRef.current.set(threadId, controller);
      const timeoutId = window.setTimeout(() => controller.abort(), 180000);
      const activitySteps = getActivitySteps(text);
      setActivity(activitySteps[0]);
      const activityTimers = activitySteps
        .slice(1)
        .map((step, index) => window.setTimeout(() => setActivity(step), (index + 1) * 1800));

      const fetchSuggestions = (userText: string, aiText: string, domain: string) => {
        fetch("/api/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(user?.email ? { "x-user-email": user.email } : {}),
          },
          body: JSON.stringify({ message: userText, response: aiText, domain }),
        })
          .then((r) => (r.ok ? r.json() : { suggestions: [] }))
          .then((d) => {
            if (Array.isArray(d.suggestions) && d.suggestions.length > 0) {
              setSuggestions(d.suggestions);
            }
          })
          .catch(() => {});
      };

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
          session_id: threadId,
          preferences: {},
        }),
      })
        .then(async (res) => {
          // Non-2xx responses still return JSON error bodies
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

          // SSE stream reader
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let aiTurnAdded = false;
          let accumulatedText = "";
          let buffer = "";

          const processLine = (line: string) => {
            if (!line.startsWith("data: ")) return;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(line.slice(6)); } catch { return; }

            if (evt.type === "queued") {
              // Server is at capacity; our request is waiting for a slot.
              setActivity((evt.message as string) ?? "High demand — waiting in queue…");
            } else if (evt.type === "busy") {
              // Queue is full — degrade gracefully instead of timing out.
              setThinking(threadId, false);
              activityTimers.forEach((t) => window.clearTimeout(t));
              setActivity("");
              if (!aiTurnAdded) {
                addTurn(threadId, {
                  role: "ai",
                  text:
                    (evt.message as string) ??
                    "Centriq is handling a lot of requests right now. Please try again in a moment.",
                });
                aiTurnAdded = true;
              }
            } else if (evt.type === "token") {
              const content = (evt.content as string) ?? "";
              accumulatedText += content;
              if (!aiTurnAdded) {
                // First token — switch from "thinking" to streaming message
                setThinking(threadId, false);
                activityTimers.forEach((t) => window.clearTimeout(t));
                setActivity("");
                addTurn(threadId, { role: "ai", text: content, streaming: true });
                aiTurnAdded = true;
              } else {
                updateLastAITurn(threadId, { text: accumulatedText });
              }
            } else if (evt.type === "replace") {
              accumulatedText = (evt.content as string) ?? accumulatedText;
              updateLastAITurn(threadId, { text: accumulatedText });
            } else if (evt.type === "done") {
              updateLastAITurn(threadId, {
                streaming: false,
                domain: (evt.domain as string) ?? undefined,
                interactive: (evt.interactive as Turn["interactive"]) ?? undefined,
                downloadUrl: (evt.download_url as string) ?? undefined,
                images:
                  Array.isArray(evt.images) && evt.images.length > 0
                    ? (evt.images as string[])
                    : undefined,
              });
              fetchSuggestions(text, accumulatedText, (evt.domain as string) ?? "general");
            } else if (evt.type === "error") {
              if (!aiTurnAdded) {
                setThinking(threadId, false);
                setActivity("");
                const errCode = (evt.code as string) ?? "";
                const errMsg = (evt.message as string) ?? "";
                const friendlyText =
                  errCode === "TOOL_FAILURE"
                    ? `I couldn't complete that step — ${errMsg || "a tool call failed"}. Please try rephrasing or try again.`
                    : errCode === "CONTEXT_LIMIT"
                    ? "This conversation is getting long. Start a new chat to continue with a fresh context."
                    : errCode === "MODEL_UNAVAILABLE"
                    ? "The AI model is temporarily unavailable. Please try again in a moment."
                    : errMsg || "Something went wrong. Please try again.";
                addTurn(threadId, { role: "ai", text: friendlyText });
                aiTurnAdded = true;
              }
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) processLine(line.trim());
          }
          if (buffer.trim()) processLine(buffer.trim());

          // If stream ended without a done event and we never got tokens
          if (!aiTurnAdded) {
            setThinking(threadId, false);
            setActivity("");
            addTurn(threadId, {
              role: "ai",
              text: "I didn't receive a response — the server may be busy. Please try again.",
            });
          }
        })
        .catch((err: Error & { code?: string }) => {
          // User pressed Stop — abort the request quietly, finalize any partial reply,
          // and don't show a timeout/error message.
          if (err.name === "AbortError" && stoppedRef.current.has(threadId)) {
            updateLastAITurn(threadId, { streaming: false });
            return;
          }

          console.error("Backend Error:", err);
          const isVpn = err.code === "VPN_REQUIRED";
          const isTimeout = err.name === "AbortError";

          addTurn(threadId, {
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
          setThinking(threadId, false);
          controllersRef.current.delete(threadId);
          stoppedRef.current.delete(threadId);
        });
    },
    [activeId, input, threads, addTurn, updateLastAITurn, setThinking, user?.email, user?.role],
  );

  // Stop the in-flight response for the active chat.
  const stop = useCallback(() => {
    if (!activeId) return;
    const controller = controllersRef.current.get(activeId);
    if (!controller) return;
    stoppedRef.current.add(activeId);
    controller.abort();
    setThinking(activeId, false);
    setActivity("");
  }, [activeId, setThinking]);

  // ── Hands-free voice loop ("Jarvis") ──────────────────────────────────────
  // Keep a live ref to send() so recognition callbacks never capture a stale one.
  const sendRef = useRef(send);
  sendRef.current = send;

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null; // prevent auto-restart on a deliberate stop
      try { rec.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current) return; // already running
    const rec = createRecognition({ continuous: true, interimResults: true });
    if (!rec) return;
    finalTranscriptRef.current = "";

    const resetSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const transcript = finalTranscriptRef.current.trim();
        if (!transcript) return;
        finalTranscriptRef.current = "";
        setLiveTranscript("");
        useVoiceStore.getState().setVoiceState("thinking"); // pauses recognition
        sendRef.current(transcript);
      }, 1500);
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscriptRef.current += t + " ";
        else interim = t;
      }
      setLiveTranscript((finalTranscriptRef.current + interim).trim());
      resetSilence();
    };
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access denied. Allow it to use voice mode.");
        useVoiceStore.getState().setVoiceMode(false);
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      // Browsers auto-stop after a while; restart if we're still listening.
      const s = useVoiceStore.getState();
      if (s.voiceMode && s.voiceState === "listening") startListening();
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }, [setLiveTranscript]);

  // Drive the microphone from the loop phase: listen only while "listening".
  useEffect(() => {
    if (voiceMode && voiceState === "listening") startListening();
    else stopListening();
  }, [voiceMode, voiceState, startListening, stopListening]);

  // Entering/leaving voice mode: reset speech cursor so history isn't replayed.
  useEffect(() => {
    if (!voiceMode) {
      cancelSpeech();
      stopListening();
      setLiveTranscript("");
      return;
    }
    const turns = (activeId ? threads[activeId]?.turns : []) || [];
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "ai") { idx = i; break; }
    lastSpokenIndexRef.current = idx;
    lastSpokenLenRef.current = idx >= 0 ? turns[idx].text.length : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  // Mark the thinking phase while a streamed reply is being generated.
  useEffect(() => {
    if (voiceMode && thinking) setVoiceState("thinking");
  }, [voiceMode, thinking, setVoiceState]);

  // Speak AI turns aloud (sentence-by-sentence as they stream).
  useEffect(() => {
    if (!voiceMode) return;
    const turns = activeThread.turns;
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "ai") { idx = i; break; }
    if (idx === -1) return;
    const turn = turns[idx];

    if (idx !== lastSpokenIndexRef.current) {
      lastSpokenIndexRef.current = idx;
      lastSpokenLenRef.current = 0;
      resetSpeech({
        onStart: () => useVoiceStore.getState().setVoiceState("speaking"),
        onAllDone: () => {
          const s = useVoiceStore.getState();
          if (s.voiceMode) s.setVoiceState("listening");
        },
      });
    } else if (turn.text.length === lastSpokenLenRef.current) {
      return; // no new text (e.g. an unrelated turn was appended)
    }
    lastSpokenLenRef.current = turn.text.length;
    enqueueFrom(turn.text, turn.streaming !== true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, activeThread.turns]);

  // Reset when switching threads.
  useEffect(() => {
    cancelSpeech();
    lastSpokenIndexRef.current = -1;
    lastSpokenLenRef.current = 0;
  }, [activeId]);

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
                <strong>VPN not connected</strong> — Connect to the office VPN to use Centriq AI.
              </span>
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <button
                  onClick={retryVpn}
                  disabled={vpnRetrying}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-800/40 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${vpnRetrying ? "animate-spin" : ""}`} />
                  Retry
                </button>
                <button
                  onClick={() => setVpnWarning(false)}
                  className="rounded-lg p-1 text-amber-700 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-800/40 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
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
            "mx-auto w-full max-w-5xl px-4 sm:px-8 flex flex-col",
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
                        className="text-4xl font-extrabold tracking-tight sm:text-5xl mb-2 text-glow"
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
                  className="w-full max-w-4xl mb-6"
                >
                  <SmartWidgets onAction={(prompt) => !busy && send(prompt)} />
                </motion.div>

                {/* Starter prompt chips */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.4 }}
                  className="w-full max-w-4xl mb-5"
                >
                  <div className="try-asking-container">
                    <p className="text-[11px] text-muted-foreground font-semibold mb-3 text-center tracking-wide">Try asking…</p>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={starterPage}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.3 }}
                        className="flex flex-wrap justify-center gap-2.5"
                      >
                        {QUICK_QUERIES.slice(
                          starterPage * STARTER_PAGE_SIZE,
                          starterPage * STARTER_PAGE_SIZE + STARTER_PAGE_SIZE,
                        ).map((q) => (
                          <button
                            key={q.prompt}
                            onClick={() => !busy && send(q.prompt)}
                            className="group flex items-center gap-2 rounded-full border border-border/80 bg-card/70 backdrop-blur-sm px-4 py-2 text-[12px] font-medium text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-md hover:scale-[1.02]"
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/60 group-hover:bg-primary/10 transition-colors">
                              <q.icon className={`h-3 w-3 ${q.iconColor}`} />
                            </span>
                            {q.label}
                          </button>
                        ))}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>

                {/* Composer */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.45 }}
                  className="w-full max-w-4xl ambient-glow"
                >
                  <VoiceOrb />
                  <Composer
                    value={input}
                    onChange={setInput}
                    onSubmit={() => send()}
                    disabled={busy}
                    busy={busy}
                    onStop={stop}
                    onAttach={() =>
                      toast("Attachments", { description: "This feature is currently in preview." })
                    }
                    onQuickAction={(p) => !busy && send(p)}
                    suggestions={suggestions}
                    onSuggestionSelect={(t) => !busy && send(t)}
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
                          live={t.streaming}
                        >
                          <div className="space-y-4">
                            {t.text && (() => {
                              const navTokens: { path: string; label: string }[] = [];
                              const cleaned = t.text.replace(/<<NAV:([^|>]+)\|([^>]+)>>/g, (_m, path, label) => {
                                navTokens.push({ path: String(path).trim(), label: String(label).trim() });
                                return "";
                              }).trim();
                              return (
                                <>
                                  {cleaned && (
                                    <div className="text-[15px] leading-relaxed text-foreground/90 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-table:my-2 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-muted/60 prose-th:font-semibold prose-th:text-foreground prose-tr:border-b prose-tr:border-border/50 prose-table:border prose-table:border-border/50 prose-table:rounded-lg prose-table:overflow-hidden prose-table:text-sm">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
                                      {t.streaming && (
                                        <span className="inline-block w-[2px] h-[1em] ml-[1px] bg-foreground/70 align-middle animate-pulse" />
                                      )}
                                    </div>
                                  )}
                                  {navTokens.length > 0 && !t.streaming && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                      {navTokens.map((n, idx) => {
                                        const Icon = n.path === "/my-library" ? LibraryIcon : BookOpen;
                                        return (
                                          <button
                                            key={idx}
                                            onClick={() => navigate({ to: n.path })}
                                            className="inline-flex items-center gap-2 rounded-xl bg-primary/15 px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/25 transition-colors border border-primary/20"
                                          >
                                            <Icon className="h-3.5 w-3.5" />
                                            {n.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
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
                            {t.interactive?.type === "visitor_pass_form" && (
                              <VisitorPassForm
                                userEmail={user?.email || ""}
                                prefill={t.interactive.data as import("@/lib/chat-store").VisitorPassPrefill | undefined}
                                onSubmitted={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "email_draft" && t.interactive.data && (
                              <InteractiveEmailDraft
                                data={t.interactive.data as import("@/lib/chat-store").EmailDraftData}
                                userEmail={user?.email}
                                onSent={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "it_support" })
                                }
                              />
                            )}
                            {t.interactive?.type === "room_booking_form" && (
                              <RoomBookingWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={t.interactive.data as import("@/lib/chat-store").RoomBookingPrefill | undefined}
                                onBooked={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "ms365" })
                                }
                              />
                            )}
                            {t.interactive?.type === "cancel_booking_form" && (
                              <CancelBookingWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                onCancelled={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "ms365" })
                                }
                              />
                            )}
                            {t.interactive?.type === "my_schedule" && (
                              <MyScheduleWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                              />
                            )}
                            {t.interactive?.type === "skills_editor" && (
                              <SkillsEditorWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={t.interactive.data as import("@/lib/chat-store").SkillsEditorPrefill | undefined}
                                onSaved={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "hr" })
                                }
                              />
                            )}
                            {t.interactive?.type === "announcement_form" && (
                              <AnnouncementWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={t.interactive.data as import("@/lib/chat-store").AnnouncementPrefill | undefined}
                                onPublished={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "prompt_config_form" && (
                              <PromptConfigWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={t.interactive.data as import("@/lib/chat-store").PromptConfigPrefill | undefined}
                                onSaved={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
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
                        <ThinkingBuddy activity={activity} />
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
              <VoiceOrb />
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={() => send()}
                disabled={busy}
                busy={busy}
                onStop={stop}
                onAttach={() =>
                  toast("Attachments", { description: "This feature is currently in preview." })
                }
                onQuickAction={(p) => !busy && send(p)}
                onGenerateDoc={openDocModal}
                suggestions={suggestions}
                onSuggestionSelect={(t) => !busy && send(t)}
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
