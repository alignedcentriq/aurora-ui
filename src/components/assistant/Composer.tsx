import { Send, Paperclip, Plus, Mic, MicOff, FileText, X, Loader2, Car, Monitor, Headphones, Wifi, Package, Receipt } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { BrandName } from "@/components/BrandName";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";

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
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [isListening, setIsListening] = useState(false);

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
    // Reset input so same file can be reselected
    e.target.value = "";

    const allowed = ["application/pdf", "text/plain", "text/csv"];
    if (!allowed.includes(file.type) && !file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) {
      toast.error("Only PDF and text files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }

    setUploading(true);
    setIsOpen(false);
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

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      {/* Attached file chip */}
      {attached && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-3 py-2 w-fit">
          <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[12px] font-medium text-foreground truncate max-w-[240px]">{attached.filename}</span>
          <button
            onClick={() => setAttached(null)}
            className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-rose-500 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.csv,text/plain,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="relative flex flex-col rounded-[24px] border border-[var(--border)] bg-card/40 backdrop-blur-2xl shadow-2xl transition-all focus-within:border-primary/30 p-2">

        {/* @mention dropdown */}
        {mentionQuery !== null && (loadingMentions || mentionResults.length > 0 || mentionQuery.length >= 1) && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-[var(--border)] bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
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
          className="max-h-[200px] min-h-[40px] w-full resize-none bg-transparent px-4 py-2 text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <Popover open={isOpen} onOpenChange={setIsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={uploading}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90 disabled:opacity-50"
                  title="Add"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-6 w-6" strokeWidth={1.5} />}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0 overflow-hidden rounded-2xl border-[var(--border)] bg-card/95 backdrop-blur-xl shadow-2xl" align="start" side="top" sideOffset={12}>
                <div className="flex flex-col">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-3 w-full px-4 py-3.5 text-[13px] font-semibold hover:bg-secondary/50 transition-colors text-left group"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                      <Paperclip className="h-4 w-4" />
                    </div>
                    Attach Files
                  </button>

                  <div className="mx-4 border-t border-[var(--border)]" />

                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Quick Queries
                  </p>

                  {[
                    { icon: Car, label: "Request parking sticker", prompt: "I need a parking sticker", color: "bg-amber-500/10 text-amber-500" },
                    { icon: Monitor, label: "Install software", prompt: "I need to install software on my laptop", color: "bg-violet-500/10 text-violet-500" },
                    { icon: Headphones, label: "IT support ticket", prompt: "I need to raise an IT support ticket", color: "bg-blue-500/10 text-blue-500" },
                    { icon: Wifi, label: "Request VPN access", prompt: "I need VPN access", color: "bg-emerald-500/10 text-emerald-500" },
                    { icon: Package, label: "Asset request", prompt: "I need to request a new asset (laptop/equipment)", color: "bg-rose-500/10 text-rose-500" },
                    { icon: Receipt, label: "Expense reimbursement", prompt: "I want to submit an expense reimbursement", color: "bg-orange-500/10 text-orange-500" },
                  ].map(({ icon: Icon, label, prompt, color }) => (
                    <button
                      key={label}
                      onClick={() => {
                        setIsOpen(false);
                        onQuickAction?.(prompt);
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-[13px] hover:bg-secondary/50 transition-colors text-left group"
                    >
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${color} group-hover:scale-110 transition-transform`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-foreground/80 font-medium">{label}</span>
                    </button>
                  ))}

                  <div className="h-2" />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleListening}
              disabled={disabled}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed",
                isListening
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={isListening ? "Stop recording" : "Voice input"}
            >
              {isListening
                ? <MicOff className="h-5 w-5 animate-pulse" strokeWidth={1.5} />
                : <Mic className="h-5 w-5" strokeWidth={1.5} />
              }
            </button>

            {(value.trim() || attached) && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 text-center text-[11px] font-medium text-muted-foreground/50 tracking-wide px-4">
        <span className="uppercase tracking-widest whitespace-nowrap"><BrandName withAI plain /></span>
        <span className="normal-case"> can make mistakes. Consider checking important information.</span>
      </div>
    </div>
  );
}
