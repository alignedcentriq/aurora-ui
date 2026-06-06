import { useState } from "react";
import { Send, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { EmailDraftData } from "@/lib/chat-store";

interface Props {
  data: EmailDraftData;
  onSent: (message: string) => void;
  userEmail?: string;
}

export function InteractiveEmailDraft({ data, onSent, userEmail }: Props) {
  const [to, setTo] = useState(data.to);
  const [subject, setSubject] = useState(data.subject);
  const [body, setBody] = useState(data.body);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!to || !subject || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/email/send-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, requester_email: userEmail || "" }),
      });
      const result = await res.json();
      setSent(true);
      onSent(result.message || "Email sent successfully.");
    } catch {
      onSent("Failed to send the email. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-3 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-400"
      >
        <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 15 }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        </motion.div>
        Email sent to <span className="font-semibold">{to}</span>
      </motion.div>
    );
  }

  const canSend = !sending && !!to.trim() && !!subject.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border bg-gradient-to-r from-blue-500/[0.07] to-transparent px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          <Mail className="h-3.5 w-3.5" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-bold uppercase tracking-widest text-foreground/80">
            Email Draft
          </span>
          <span className="text-[10px] text-muted-foreground">Edit any field, then send</span>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-2.5 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 transition-colors focus-within:border-primary/50 focus-within:bg-background">
          <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            To
          </span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@company.com"
            className="flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 transition-colors focus-within:border-primary/50 focus-within:bg-background">
          <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Subject
          </span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
            className="flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 transition-colors focus-within:border-primary/50 focus-within:bg-background">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="Write your message…"
            className="w-full resize-y bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            Sends from your account
          </span>
          <motion.button
            whileHover={canSend ? { scale: 1.02 } : undefined}
            whileTap={canSend ? { scale: 0.97 } : undefined}
            onClick={handleSend}
            disabled={!canSend}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AnimatePresence mode="wait" initial={false}>
              {sending ? (
                <motion.span key="sending" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sending…
                </motion.span>
              ) : (
                <motion.span key="send" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Send className="h-3.5 w-3.5" />
                  Send Email
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
