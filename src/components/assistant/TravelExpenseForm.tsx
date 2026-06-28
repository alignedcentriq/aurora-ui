import { useState, useEffect } from "react";
import { Receipt, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  userEmail: string;
  onSubmitted: (message: string) => void;
}

interface TravelReq {
  id: number;
  ref_id: string;
  from_location: string;
  to_destination: string;
  travel_date: string;
  status: string;
  expense_limit?: number;
  expense_limit_currency?: string;
}

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "JPY", "CAD", "AUD"];

export function TravelExpenseForm({ userEmail, onSubmitted }: Props) {
  const [requests, setRequests] = useState<TravelReq[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [form, setForm] = useState({
    travel_ref_id: "",
    amount: "",
    currency: "INR",
    breakdown: "",
    over_limit_reason: "",
  });
  const [overLimit, setOverLimit] = useState<{
    limit: number;
    currency: string;
    amount: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/travel/my-requests", { headers: { "x-user-email": userEmail } })
      .then((r) => r.json())
      .then((data: TravelReq[]) => {
        const eligible = data.filter(
          (r) => r.status === "admin_approved" || r.status === "completed",
        );
        setRequests(eligible);
        if (eligible.length === 1) {
          setForm((f) => ({
            ...f,
            travel_ref_id: eligible[0].ref_id,
            currency: eligible[0].expense_limit_currency || "INR",
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReqs(false));
  }, [userEmail]);

  const selectedReq = requests.find((r) => r.ref_id === form.travel_ref_id);
  const limitCurrency = selectedReq?.expense_limit_currency || "INR";

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // When the user selects a different trip, update the currency to match the limit currency
  const handleTripChange = (ref_id: string) => {
    const req = requests.find((r) => r.ref_id === ref_id);
    setForm((f) => ({
      ...f,
      travel_ref_id: ref_id,
      currency: req?.expense_limit_currency || "INR",
    }));
    setOverLimit(null);
  };

  const isOverLimit =
    selectedReq?.expense_limit &&
    form.amount &&
    form.currency === limitCurrency &&
    parseFloat(form.amount) > selectedReq.expense_limit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.travel_ref_id || !form.amount) {
      setError("Please select a trip and enter the amount.");
      return;
    }
    setError("");
    setOverLimit(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/travel/expense", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-email": userEmail },
        body: JSON.stringify({
          travel_ref_id: form.travel_ref_id,
          amount: parseFloat(form.amount),
          currency: form.currency,
          breakdown: form.breakdown,
          over_limit_reason: form.over_limit_reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.detail && typeof data.detail === "string" && data.detail.includes("exceeds")) {
          setOverLimit({
            amount: parseFloat(form.amount),
            currency: form.currency,
            limit: selectedReq?.expense_limit || 0,
          });
          return;
        }
        throw new Error(data.detail || "Failed");
      }
      setSubmitted(true);
      onSubmitted(data.message || "Expense claim submitted. Admin will review it shortly.");
    } catch (err: any) {
      setError(err.message || "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        <p className="text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          Expense claim submitted. Admin will review and notify you.
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30";
  const labelCls =
    "block text-[11px] font-bold uppercase tracking-wider text-[#64748b] dark:text-white/50 mb-1";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-card border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl overflow-hidden shadow-sm"
    >
      <div className="flex items-center gap-2.5 px-5 py-4 bg-gradient-to-r from-[#0D9488] to-[#16A34A] text-white">
        <Receipt className="h-4.5 w-4.5" />
        <span className="text-[14px] font-bold">Post-Trip Expense Claim</span>
      </div>

      <div className="p-5 space-y-4">
        {loadingReqs ? (
          <div className="flex items-center gap-2 text-[13px] text-[#94a3b8]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your trips...
          </div>
        ) : requests.length === 0 ? (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-700 dark:text-amber-300">
              No approved trips found. Expense claims can only be filed for admin-approved travel
              requests.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className={labelCls}>
                Select Trip <span className="text-rose-400">*</span>
              </label>
              <select
                value={form.travel_ref_id}
                onChange={(e) => handleTripChange(e.target.value)}
                className={inputCls}
                required
              >
                <option value="">— Select a trip —</option>
                {requests.map((r) => (
                  <option key={r.ref_id} value={r.ref_id}>
                    {r.ref_id} — {r.from_location} → {r.to_destination} ({r.travel_date})
                    {r.expense_limit
                      ? ` · Limit: ${r.expense_limit_currency || "INR"} ${r.expense_limit.toLocaleString()}`
                      : ""}
                  </option>
                ))}
              </select>
              {selectedReq?.expense_limit && (
                <p className="text-[11px] text-[#64748b] dark:text-white/40 mt-1">
                  Approved expense limit:{" "}
                  <strong>
                    {limitCurrency} {selectedReq.expense_limit.toLocaleString()}
                  </strong>
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>
                Total Amount <span className="text-rose-400">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={form.currency}
                  onChange={(e) => {
                    set("currency", e.target.value);
                    setOverLimit(null);
                  }}
                  className="border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-2 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 w-24"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="e.g. 12500"
                  value={form.amount}
                  onChange={(e) => {
                    set("amount", e.target.value);
                    setOverLimit(null);
                  }}
                  className="flex-1 border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30"
                  required
                />
              </div>
              {isOverLimit && (
                <p className="text-[11px] text-amber-600 mt-1 font-medium">
                  ⚠ This exceeds the approved limit by {limitCurrency}{" "}
                  {(parseFloat(form.amount) - selectedReq!.expense_limit!).toLocaleString()}. A
                  reason will be required.
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>
                Expense Breakdown{" "}
                <span className="text-[#94a3b8] normal-case font-normal">(optional)</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Flight: 5,000 · Hotel: 4,000 · Meals: 1,500 · Transport: 2,000"
                value={form.breakdown}
                onChange={(e) => set("breakdown", e.target.value)}
                className={cn(inputCls, "resize-none")}
              />
            </div>

            {(overLimit || isOverLimit) && (
              <div>
                <label className={labelCls}>
                  Reason for Exceeding Limit <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Please explain why the amount exceeds the approved limit..."
                  value={form.over_limit_reason}
                  onChange={(e) => set("over_limit_reason", e.target.value)}
                  className={cn(inputCls, "resize-none border-amber-300 dark:border-amber-700")}
                  required
                />
              </div>
            )}

            {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}

            <button
              type="submit"
              disabled={submitting || requests.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-[#0D9488] hover:bg-[#0b7d72] text-white font-semibold text-[13px] py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Receipt className="h-4 w-4" />
              )}
              {submitting ? "Submitting..." : "Submit Expense Claim"}
            </button>

            <p className="text-[11px] text-center text-[#94a3b8] dark:text-white/30">
              Admin will review your claim and notify you via email.
            </p>
          </>
        )}
      </div>
    </form>
  );
}
