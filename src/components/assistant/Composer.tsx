import { Send, Plus, Mic, MicOff, FileText, X, Loader2 } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { BrandName } from "@/components/BrandName";
import { toast } from "sonner";
import { SuggestionChips } from "./SuggestionChips";
import { motion, AnimatePresence } from "framer-motion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionAPI: (new () => SpeechRecognition) | undefined =
  typeof window !== "undefined"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    : undefined;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAttach?: () => void;
  onQuickAction?: (prompt: string) => void;
  onGenerateDoc?: () => void;
  disabled?: boolean;
  suggestions?: string[];
  onSuggestionSelect?: (text: string) => void;
};

interface AttachedFile {
  filename: string;
  text: string;
}

interface MentionUser {
  id: number;
  name: string;
  email: string;
  department: string;
  designation: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onAttach,
  onQuickAction,
  onGenerateDoc,
  disabled,
  suggestions,
  onSuggestionSelect,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  const [uploading, setUploading] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [loadingMentions, setLoadingMentions] = useState(false);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const fetchMentions = useCallback(async (q: string) => {
    setLoadingMentions(true);
    try {
      const res = await fetch(`/api/employees/autocomplete?q=${encodeURIComponent(q)}&limit=6`);
      if (res.ok) {
        const data: MentionUser[] = await res.json();
        setMentionResults(data);
        setMentionIndex(0);
      }
    } catch {
      setMentionResults([]);
    } finally {
      setLoadingMentions(false);
    }
  }, []);

  const detectMention = useCallback((text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    if (match) {
      const q = match[1];
      setMentionStart(cursor - match[0].length);
      setMentionIndex(0);
      setMentionQuery(q);
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = setTimeout(() => fetchMentions(q), 150);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
    }
  }, [fetchMentions]);

  const selectMention = useCallback((user: MentionUser) => {
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursor);
    const inserted = `@${user.name} `;
    const newValue = before + inserted + after;
    onChange(newValue);
    setMentionQuery(null);
    setMentionResults([]);
    requestAnimationFrame(() => {
      ref.current?.focus();
      const pos = before.length + inserted.length;
      ref.current?.setSelectionRange(pos, pos);
    });
  }, [value, mentionStart, onChange]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    if (!SpeechRecognitionAPI) {
      toast.error("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    baseTextRef.current = value;
    finalTranscriptRef.current = "";

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += text + " ";
        } else {
          interim = text;
        }
      }
      const base = baseTextRef.current;
      const separator = base && !base.endsWith(" ") ? " " : "";
      onChange(base + separator + finalTranscriptRef.current + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access denied. Allow microphone permissions and try again.");
      } else if (event.error === "network") {
        toast.error("Network error during voice input. Check your connection.");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error("Voice input error. Please try again.");
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      const base = baseTextRef.current;
      const separator = base && !base.endsWith(" ") && finalTranscriptRef.current ? " " : "";
      onChange((base + separator + finalTranscriptRef.current).trimEnd());
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const allowedExtensions = [".pdf", ".txt", ".csv", ".json", ".md", ".xml", ".log"];
    const allowedMime = ["application/pdf", "text/plain", "text/csv", "application/json", "text/markdown", "application/xml", "text/xml"];
    const hasValidExt = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!allowedMime.includes(file.type) && !hasValidExt) {
      toast.error("Supported formats: PDF, TXT, CSV, JSON, MD, XML, LOG");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail);
      }
      const data: { text: string; filename: string; char_count: number } = await res.json();
      setAttached({ filename: data.filename, text: data.text });
      toast.success(`Attached: ${data.filename} (${data.char_count.toLocaleString()} chars)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!value.trim() && !attached) return;
    if (attached) {
      const contextPrefix = `[Attached file: ${attached.filename}]\n\`\`\`\n${attached.text.slice(0, 6000)}${attached.text.length > 6000 ? "\n… (truncated)" : ""}\n\`\`\`\n\n`;
      const full = contextPrefix + value;
      setAttached(null);
      onChange("");
      onQuickAction?.(full);
    } else {
      onSubmit();
    }
  };

  const hasContent = value.trim() || attached;

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      {/* Contextual suggestion chips */}
      {suggestions && suggestions.length > 0 && (
        <SuggestionChips
          suggestions={suggestions}
          onSelect={onSuggestionSelect ?? (() => {})}
        />
      )}

      {/* Attached file chip */}
      <AnimatePresence>
        {attached && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 w-fit"
          >
            <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[12px] font-medium text-foreground truncate max-w-[240px]">{attached.filename}</span>
            <button
              onClick={() => setAttached(null)}
              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-rose-500 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.csv,.json,.md,.xml,.log,text/plain,application/pdf,text/csv,application/json,text/markdown,application/xml,text/xml"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Composer with animated gradient border on focus */}
      <div className="relative">
        {/* Gradient glow layer */}
        <div
          className={cn(
            "absolute -inset-[1px] rounded-[25px] transition-opacity duration-500",
            isFocused ? "opacity-100" : "opacity-0",
          )}
          style={{
            background: "linear-gradient(135deg, var(--primary), var(--accent-cyan), var(--accent-indigo), var(--primary))",
            backgroundSize: "300% 300%",
            animation: isFocused ? "gradient-shift 4s ease infinite" : "none",
          }}
        />

        <div
          className={cn(
            "relative flex flex-col rounded-[24px] border bg-card/60 backdrop-blur-xl shadow-lg transition-all p-2",
            isFocused ? "border-transparent shadow-xl" : "border-border",
          )}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // Don't blur if focus moves within the composer
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsFocused(false);
            }
          }}
        >
          {/* @mention dropdown */}
          {mentionQuery !== null && (loadingMentions || mentionResults.length > 0 || mentionQuery.length >= 1) && (
            <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
              {loadingMentions && mentionResults.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : mentionResults.length === 0 ? (
                <div className="px-4 py-3 text-[13px] text-muted-foreground">No users found for &quot;{mentionQuery}&quot;</div>
              ) : (
                mentionResults.map((user, i) => (
                  <button
                    key={user.id}
                    onMouseDown={(e) => { e.preventDefault(); selectMention(user); }}
                    className={cn(
                      "flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors",
                      i === mentionIndex ? "bg-primary/10" : "hover:bg-secondary/50"
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-bold">
                      {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{user.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{user.designation}{user.department ? ` · ${user.department}` : ""}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => {
              const text = e.target.value;
              const cursor = e.target.selectionStart ?? text.length;
              onChange(text);
              detectMention(text, cursor);
            }}
            onKeyDown={(e) => {
              if (mentionQuery !== null && mentionResults.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectMention(mentionResults[mentionIndex]); return; }
                if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); setMentionResults([]); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Message Centriq AI..."
            disabled={disabled}
            className="max-h-[200px] min-h-[40px] w-full resize-none bg-transparent px-4 py-2 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <div className="flex items-center justify-between px-2 pb-1">
            <div className="flex items-center gap-1">
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-50"
                title="Attach file"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" strokeWidth={1.5} />}
              </motion.button>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Voice input */}
              <motion.button
                whileTap={{ scale: 0.85 }}
                type="button"
                onClick={toggleListening}
                disabled={disabled}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                  isListening
                    ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 ring-2 ring-red-500/30"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title={isListening ? "Stop recording" : "Voice input"}
              >
                {isListening
                  ? <MicOff className="h-4 w-4 animate-pulse" strokeWidth={1.5} />
                  : <Mic className="h-4 w-4" strokeWidth={1.5} />
                }
              </motion.button>

              {/* Send button */}
              <AnimatePresence>
                {hasContent && (
                  <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    onClick={handleSubmit}
                    disabled={disabled}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[11px] font-medium text-muted-foreground/40 tracking-wide px-4">
        <span className="uppercase tracking-widest whitespace-nowrap"><BrandName withAI plain /></span>
        <span className="normal-case"> can make mistakes. Consider checking important information.</span>
      </div>
    </div>
  );
}
