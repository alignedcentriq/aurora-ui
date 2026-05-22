import { useState } from "react";
import { Send, Mail, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
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
        className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 400, damping: 15 }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        </motion.div>
        Email sent successfully.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Mail className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Email Draft
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">Edit fields below before sending</span>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>

        <div className="flex justify-end pt-1">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleSend}
            disabled={sending || !to.trim() || !subject.trim()}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send Email"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
