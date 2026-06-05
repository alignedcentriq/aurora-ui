import { useState } from "react";
import { UserPlus, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import type { VisitorPassPrefill } from "@/lib/chat-store";

interface Props {
  userEmail: string;
  prefill?: VisitorPassPrefill;
  onSubmitted: (message: string) => void;
}

// Today in YYYY-MM-DD (local) — used as the date picker's min so a past visit
// date can't be selected. The backend guards this too, as a backstop.
const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().split("T")[0];
};

export function VisitorPassForm({ userEmail, prefill, onSubmitted }: Props) {
  const [visitorName, setVisitorName] = useState(prefill?.visitorName ?? "");
  const [visitDate, setVisitDate] = useState(prefill?.visitDate ?? "");
  const [visitTime, setVisitTime] = useState(prefill?.visitTime ?? "");
  const [purpose, setPurpose] = useState(prefill?.purpose ?? "");
  const [visitorCompany, setVisitorCompany] = useState(prefill?.visitorCompany ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = visitorName.trim() && visitDate && purpose.trim() && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/visitor-pass/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          visitor_name: visitorName.trim(),
          visit_date: visitDate,
          visit_time: visitTime,
          purpose: purpose.trim(),
          visitor_company: visitorCompany.trim(),
        }),
      });
      const result = await res.json();
      setSubmitted(true);
      onSubmitted(result.message || "Visitor pass request submitted.");
    } catch {
      onSubmitted("Failed to submit the request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
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
        Visitor pass requested successfully.
      </motion.div>
    );
  }

  const inputCls =
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow";

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onSubmit={handleSubmit}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <UserPlus className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Visitor Pass Request
        </span>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            Visitor Name <span className="text-destructive">*</span>
          </label>
          <input
            required
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            placeholder="Full name of the person visiting"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Visit Date <span className="text-destructive">*</span>
            </label>
            <input
              required
              type="date"
              min={todayISO()}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Visit Time <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              type="time"
              value={visitTime}
              onChange={(e) => setVisitTime(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            Visitor's Company <span className="text-muted-foreground/60">(optional)</span>
          </label>
          <input
            value={visitorCompany}
            onChange={(e) => setVisitorCompany(e.target.value)}
            placeholder="e.g. Acme Corp"
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            Purpose of Visit <span className="text-destructive">*</span>
          </label>
          <textarea
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Client meeting, interview, vendor demo"
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="flex justify-end pt-1">
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </motion.button>
        </div>
      </div>
    </motion.form>
  );
}
