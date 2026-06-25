import { useState } from "react";
import { Plane, Globe, Hotel, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  userEmail: string;
  onSubmitted: (message: string) => void;
}

export function TravelRequestForm({ userEmail, onSubmitted }: Props) {
  const [form, setForm] = useState({
    business_reason: "",
    from_location: "",
    to_destination: "",
    travel_date: "",
    return_date: "",
    mode_of_travel: "Flight",
    is_international: false,
    visa_required: false,
    accommodation_required: false,
    estimated_cost: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.business_reason.trim() ||
      !form.from_location.trim() ||
      !form.to_destination.trim() ||
      !form.travel_date
    ) {
      setError("Please fill in all required fields.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/travel/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-email": userEmail },
        body: JSON.stringify({
          business_reason: form.business_reason,
          from_location: form.from_location,
          to_destination: form.to_destination,
          travel_date: form.travel_date,
          return_date: form.return_date,
          is_international: form.is_international,
          visa_required: form.visa_required,
          mode_of_travel: form.mode_of_travel,
          accommodation_required: form.accommodation_required,
          estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : 0,
          notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submission failed");
      setSubmitted(true);
      onSubmitted(
        data.message || "Travel request submitted. Your manager has been notified for approval.",
      );
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
          Travel request submitted. Your manager will receive an approval email.
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
      <div className="flex items-center gap-2.5 px-5 py-4 bg-gradient-to-r from-[#1B6FC8] to-[#0D9488] text-white">
        <Plane className="h-4.5 w-4.5" />
        <span className="text-[14px] font-bold">Business Travel Request</span>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <label className={labelCls}>
            Business Reason <span className="text-rose-400">*</span>
          </label>
          <textarea
            rows={2}
            placeholder="e.g. Client meeting, conference, site visit..."
            value={form.business_reason}
            onChange={(e) => set("business_reason", e.target.value)}
            className={cn(inputCls, "resize-none")}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              From <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Pune"
              value={form.from_location}
              onChange={(e) => set("from_location", e.target.value)}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className={labelCls}>
              To (Destination) <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Mumbai / London"
              value={form.to_destination}
              onChange={(e) => set("to_destination", e.target.value)}
              className={inputCls}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              Travel Date <span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              value={form.travel_date}
              onChange={(e) => set("travel_date", e.target.value)}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className={labelCls}>
              Return Date <span className="text-[#94a3b8] normal-case font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={form.return_date}
              onChange={(e) => set("return_date", e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Mode of Travel</label>
            <select
              value={form.mode_of_travel}
              onChange={(e) => set("mode_of_travel", e.target.value)}
              className={inputCls}
            >
              {["Flight", "Train", "Car", "Bus", "Other"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Estimated Cost (INR)</label>
            <input
              type="number"
              placeholder="e.g. 15000"
              value={form.estimated_cost}
              onChange={(e) => set("estimated_cost", e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_international}
              onChange={(e) => {
                set("is_international", e.target.checked);
                if (e.target.checked) set("visa_required", true);
              }}
              className="h-4 w-4 rounded border-[#e2e8f0] accent-[#00a29a]"
            />
            <span className="text-[12px] font-medium text-[#374151] dark:text-white/70 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-violet-500" /> International Travel
            </span>
          </label>
          {form.is_international && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.visa_required}
                onChange={(e) => set("visa_required", e.target.checked)}
                className="h-4 w-4 rounded border-[#e2e8f0] accent-[#00a29a]"
              />
              <span className="text-[12px] font-medium text-[#374151] dark:text-white/70">
                Visa Required
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.accommodation_required}
              onChange={(e) => set("accommodation_required", e.target.checked)}
              className="h-4 w-4 rounded border-[#e2e8f0] accent-[#00a29a]"
            />
            <span className="text-[12px] font-medium text-[#374151] dark:text-white/70 flex items-center gap-1.5">
              <Hotel className="h-3.5 w-3.5 text-blue-500" /> Accommodation Needed
            </span>
          </label>
        </div>

        <div>
          <label className={labelCls}>
            Additional Notes{" "}
            <span className="text-[#94a3b8] normal-case font-normal">(optional)</span>
          </label>
          <textarea
            rows={2}
            placeholder="Any other details..."
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            className={cn(inputCls, "resize-none")}
          />
        </div>

        {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 bg-[#00a29a] hover:bg-[#00918a] text-white font-semibold text-[13px] py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plane className="h-4 w-4" />
          )}
          {submitting ? "Submitting..." : "Submit Travel Request"}
        </button>

        <p className="text-[11px] text-center text-[#94a3b8] dark:text-white/30">
          Your reporting manager will be emailed for approval. Admin will then arrange tickets and
          accommodation.
        </p>
      </div>
    </form>
  );
}
