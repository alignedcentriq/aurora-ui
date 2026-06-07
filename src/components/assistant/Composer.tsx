import { Send, Plus, FileText, X, Loader2, AudioLines, Square, Hash, ExternalLink } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { BrandName } from "@/components/BrandName";
import { toast } from "sonner";
import { SuggestionChips } from "./SuggestionChips";
import { motion, AnimatePresence } from "framer-motion";

import { useVoiceStore } from "@/lib/voice-store";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAttach?: () => void;
  onQuickAction?: (prompt: string) => void;
  onGenerateDoc?: () => void;
  disabled?: boolean;
  /** A response is currently being generated for the active chat. */
  busy?: boolean;
  /** Stop the in-flight response for the active chat. */
  onStop?: () => void;
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

type SlashItem =
  | { kind: "form"; id: number; name: string; description: string; category: string }
  | { kind: "url";  id: number; name: string; url: string; purpose: string };

export function Composer({
  value,
  onChange,
  onSubmit,
  onAttach,
  onQuickAction,
  onGenerateDoc,
  disabled,
  busy,
  onStop,
  suggestions,
  onSuggestionSelect,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);

  const [isFocused, setIsFocused] = useState(false);
  const { voiceMode, toggleVoiceMode } = useVoiceStore();

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [loadingMentions, setLoadingMentions] = useState(false);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // /slash-picker state (forms + URLs)
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashStart, setSlashStart] = useState(-1);
  const [slashItems, setSlashItems] = useState<SlashItem[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashFetchedRef = useRef(false);

  const RECENT_KEY = "centriq-recent-mentions";
  const getRecentMentions = (): MentionUser[] => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  };
  const saveRecentMention = (user: MentionUser) => {
    const prev = getRecentMentions().filter((u) => u.id !== user.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([user, ...prev].slice(0, 5)));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  useEffect(() => {
    const handler = () => { ref.current?.focus(); };
    window.addEventListener("centriq:focus-composer", handler);
    return () => window.removeEventListener("centriq:focus-composer", handler);
  }, []);



  useEffect(() => {
    if (disabled) {
      setIsFocused(false);
    }
  }, [disabled]);

  const fetchSlashItems = useCallback(async () => {
    if (slashFetchedRef.current) return;
    slashFetchedRef.current = true;
    try {
      const [formsRes, urlsRes] = await Promise.all([
        fetch("/api/forms/list"),
        fetch("/api/urls/list"),
      ]);
      const forms: SlashItem[] = formsRes.ok
        ? (await formsRes.json()).map((f: { id: number; name: string; description: string; category: string }) => ({ kind: "form" as const, ...f }))
        : [];
      const urls: SlashItem[] = urlsRes.ok
        ? (await urlsRes.json()).map((u: { id: number; name: string; url: string; purpose: string }) => ({ kind: "url" as const, ...u }))
        : [];
      setSlashItems([...forms, ...urls]);
    } catch { /* silent fail */ }
  }, []);

  const detectSlashCommand = useCallback((text: string, cursor: number): boolean => {
    const before = text.slice(0, cursor);
    const match = before.match(/(^|[\s\n])\/(\w*)$/);
    if (match) {
      const leadLen = (match[1] || "").length;
      setSlashStart(cursor - match[0].length + leadLen);
      setSlashQuery(match[2] || "");
      setSlashIndex(0);
      fetchSlashItems();
      return true;
    }
    setSlashQuery(null);
    return false;
  }, [fetchSlashItems]);

  const selectSlashItem = useCallback((item: SlashItem) => {
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, slashStart);
    const after = value.slice(cursor);
    onChange(before + after);
    setSlashQuery(null);
    if (item.kind === "url") {
      window.open(item.url, "_blank", "noreferrer");
    } else {
      onQuickAction?.(item.name);
    }
  }, [value, slashStart, onChange, onQuickAction]);

  const fetchMentions = useCallback(async (q: string) => {
    if (q === "") {
      const recents = getRecentMentions();
      if (recents.length > 0) {
        setMentionResults(recents);
        setMentionIndex(0);
      }
      return;
    }
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
    saveRecentMention(user);
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

      {/* Composer with elegant focused styling */}
      <div className="relative">
        <div
          className={cn(
            "relative flex flex-col rounded-[24px] border bg-card/60 backdrop-blur-xl shadow-lg transition-all p-2",
            isFocused && !disabled ? "border-primary/50 ring-2 ring-primary/10 shadow-xl" : "border-border",
          )}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // Don't blur if focus moves within the composer
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsFocused(false);
            }
          }}
        >
          {/* /slash picker — forms + URLs */}
          {slashQuery !== null && slashItems.length > 0 && (() => {
            const filtered = slashItems.filter(f => !slashQuery || f.name.toLowerCase().includes(slashQuery.toLowerCase()));
            return (
              <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5 sticky top-0 bg-card/95 backdrop-blur-xl border-b border-border/40">
                  <Hash className="h-3 w-3" />
                  {slashQuery ? `Results for "/${slashQuery}"` : "Forms & Apps"}
                </div>
                {filtered.length === 0 ? (
                  <div className="px-4 py-3 text-[13px] text-muted-foreground">No matches for &quot;/{slashQuery}&quot;</div>
                ) : (
                  filtered.map((item, i) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      onMouseDown={(e) => { e.preventDefault(); selectSlashItem(item); }}
                      className={cn(
                        "flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors",
                        i === slashIndex ? "bg-primary/10" : "hover:bg-secondary/50"
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        item.kind === "form" ? "bg-primary/10 text-primary" : "bg-blue-500/10 text-blue-500"
                      )}>
                        {item.kind === "form"
                          ? <FileText className="h-3.5 w-3.5" />
                          : <ExternalLink className="h-3.5 w-3.5" />
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-medium text-foreground truncate">{item.name}</p>
                          <span className={cn(
                            "shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                            item.kind === "form"
                              ? "text-primary border-primary/20 bg-primary/5"
                              : "text-blue-500 border-blue-500/20 bg-blue-500/5"
                          )}>
                            {item.kind === "form" ? "Form" : "App"}
                          </span>
                        </div>
                        {(item.kind === "form" ? (item.description || item.category) : item.purpose) && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {item.kind === "form"
                              ? `${item.category ? item.category + " · " : ""}${item.description}`
                              : item.purpose}
                          </p>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            );
          })()}

          {/* @mention dropdown */}
          {mentionQuery !== null && (loadingMentions || mentionResults.length > 0 || mentionQuery.length >= 1) && (
            <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
              {mentionQuery === "" && mentionResults.length > 0 && (
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Recent
                </div>
              )}
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
              const isSlash = detectSlashCommand(text, cursor);
              if (isSlash) {
                setMentionQuery(null);
                setMentionResults([]);
              } else {
                detectMention(text, cursor);
              }
            }}
            onFocus={() => {
              // Pre-warm heavy model tiers so a cold-reload starts before the
              // user hits Send. Fire-and-forget — errors are silently ignored.
              fetch("/api/warmup", { method: "POST" }).catch(() => {});
            }}
            onKeyDown={(e) => {
              const filtered = slashQuery !== null
                ? slashItems.filter(f => !slashQuery || f.name.toLowerCase().includes(slashQuery.toLowerCase()))
                : [];
              if (slashQuery !== null && filtered.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectSlashItem(filtered[slashIndex]); return; }
                if (e.key === "Escape") { e.preventDefault(); setSlashQuery(null); return; }
              }
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
            placeholder="Message Centriq AI... (type / for forms & links)"
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
              {/* Hands-free voice mode toggle */}
              <motion.button
                whileTap={{ scale: 0.85 }}
                type="button"
                onClick={toggleVoiceMode}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-all",
                  voiceMode
                    ? "bg-primary/15 text-primary ring-2 ring-primary/30"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title={voiceMode ? "Exit voice mode" : "Hands-free voice mode"}
              >
                <AudioLines className={cn("h-4 w-4", voiceMode && "animate-pulse")} strokeWidth={1.5} />
              </motion.button>



              {/* Stop button while a response is generating, else Send button */}
              <AnimatePresence mode="wait" initial={false}>
                {busy ? (
                  <motion.button
                    key="stop"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    onClick={onStop}
                    title="Stop generating"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground ring-1 ring-border shadow-sm transition-all hover:bg-secondary/70"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </motion.button>
                ) : hasContent ? (
                  <motion.button
                    key="send"
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
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[11px] font-medium text-muted-foreground/50 tracking-wide px-4">
        <div className="mx-auto w-12 h-px bg-gradient-to-r from-transparent via-border to-transparent mb-2.5" />
        <span className="uppercase tracking-widest whitespace-nowrap"><BrandName withAI plain /></span>
        <span className="normal-case"> can make mistakes. Consider checking important information.</span>
      </div>
    </div>
  );
}
