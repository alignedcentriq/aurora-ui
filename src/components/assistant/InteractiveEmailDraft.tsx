import { useState } from "react";
import { Send, Mail, CheckCircle2 } from "lucide-react";
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
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Email sent.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-muted/20">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
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
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={handleSend}
            disabled={sending || !to.trim() || !subject.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
