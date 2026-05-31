import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, Sparkles, Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import type { AnnouncementPrefill } from "@/lib/chat-store";

const ANNOUNCEMENT_CATEGORIES = [
  "General",
  "Policy Update",
  "Holiday",
  "Events",
  "Hiring",
  "Training",
  "IT Alert",
];

// Maps a manager's role to the domain stamped on the announcement.
const ROLE_TO_DOMAIN: Record<string, string> = {
  hr: "hr",
  it: "it_support",
  pmo: "pmo",
  admin: "admin",
  functional_manager: "functional_manager",
};

interface Props {
  userEmail: string;
  userRole: string;
  prefill?: AnnouncementPrefill;
  onPublished: (message: string) => void;
}

export function AnnouncementWidget({ userEmail, userRole, prefill, onPublished }: Props) {
  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-user-email": userEmail,
      "x-user-role": userRole.toLowerCase(),
    }),
    [userEmail, userRole],
  );

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [category, setCategory] = useState(prefill?.category ?? "General");
  const [expiresDays, setExpiresDays] = useState(prefill?.expiresDays ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState(false);

  const domain = prefill?.domain ?? ROLE_TO_DOMAIN[userRole.toLowerCase()] ?? "admin";

  const draftBody = async () => {
    if (!title.trim()) {
      toast.error("Enter a title first");
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch("/api/announcements/suggest", {
        method: "POST",
        headers,
        body: JSON.stringify({ title, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Couldn't draft a body");
      setBody(data.body ?? "");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setSuggesting(false);
    }
  };

  const publish = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and message are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title,
          body,
          category,
          created_by_domain: domain,
          expires_days: expiresDays ? parseInt(expiresDays) : null,
          image_url: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Publish failed");
      flyBanner(`Announcement published — "${title}"`);
      setPublished(true);
      onPublished(`📢 Announcement **"${title}"** published to everyone. Category: ${category}.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (published) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Announcement published.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Megaphone className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-semibold text-foreground">New Announcement</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
          {domain.replace(/_/g, " ")}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Office closed Friday"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Expires (days)
            </label>
            <input
              type="number"
              min="1"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value)}
              placeholder="—"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Message
            </label>
            <button
              onClick={draftBody}
              disabled={suggesting}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {suggesting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Draft body
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="What do you want everyone to know?"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <button
          onClick={publish}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publish announcement
        </button>
      </div>
    </motion.div>
  );
}
