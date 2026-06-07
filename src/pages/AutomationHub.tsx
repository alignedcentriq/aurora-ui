import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  Plus,
  Zap,
  Mail,
  Clock,
  Users,
  Play,
  Pause,
  Trash2,
  Edit2,
  Send,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  Search,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recipient {
  type: "individual" | "teams_group";
  email?: string;
  name?: string;
  id?: string;
  emails?: string[];
}

interface AutomationRule {
  id: number;
  name: string;
  description: string;
  created_by: string;
  created_by_role: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  email_subject: string;
  email_body: string;
  recipients_json: Recipient[];
  is_active: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

interface TeamsGroup {
  id: string;
  name: string;
  description?: string;
}

interface RuleFormState {
  name: string;
  description: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  email_subject: string;
  email_body: string;
  recipients_json: Recipient[];
}

const BLANK_FORM: RuleFormState = {
  name: "",
  description: "",
  frequency: "daily",
  day_of_week: null,
  day_of_month: null,
  hour: 9,
  email_subject: "",
  email_body: "",
  recipients_json: [],
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FREQ_LABELS: Record<string, string> = {
  daily: "Daily (weekdays)",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function describeCadence(rule: AutomationRule): string {
  const h = rule.hour.toString().padStart(2, "0") + ":00";
  if (rule.frequency === "daily") return `Every weekday at ${h}`;
  if (rule.frequency === "weekly") {
    const day = DAY_NAMES[rule.day_of_week ?? 0];
    return `Every ${day} at ${h}`;
  }
  if (rule.frequency === "monthly") {
    const dom = rule.day_of_month ?? 1;
    const suffix = dom === 1 ? "st" : dom === 2 ? "nd" : dom === 3 ? "rd" : "th";
    return `${dom}${suffix} of every month at ${h}`;
  }
  return `Custom at ${h}`;
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function recipientCount(r: Recipient[]): number {
  return r.reduce((n, x) => {
    if (x.type === "individual") return n + 1;
    return n + (x.emails?.length ?? 1);
  }, 0);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(url: string, email: string, role: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-email": email,
      "x-user-role": role,
      ...(opts?.headers as Record<string, string> | undefined),
    },
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  if (status === "sent")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
        <CheckCircle2 className="h-3 w-3" /> Sent
      </span>
    );
  if (status.startsWith("failed:no_recipients"))
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
        <AlertCircle className="h-3 w-3" /> No recipients
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
}

// ── Recipient Pill ────────────────────────────────────────────────────────────

function RecipientPill({ r, onRemove }: { r: Recipient; onRemove: () => void }) {
  const label =
    r.type === "individual"
      ? r.name || r.email || ""
      : `${r.name} (${r.emails?.length ?? 0} members)`;
  const color =
    r.type === "individual"
      ? "bg-blue-50 border-blue-200 text-blue-700"
      : "bg-purple-50 border-purple-200 text-purple-700";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5",
        color
      )}
    >
      {r.type === "individual" ? <Mail className="h-3 w-3" /> : <Users className="h-3 w-3" />}
      {label}
      <button type="button" onClick={onRemove} className="ml-0.5 hover:opacity-70">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ── Rule Form (create + edit) ─────────────────────────────────────────────────

function RuleForm({
  initial,
  onSave,
  onCancel,
  userEmail,
  userRole,
}: {
  initial: RuleFormState;
  onSave: (data: RuleFormState) => Promise<void>;
  onCancel: () => void;
  userEmail: string;
  userRole: string;
}) {
  const [form, setForm] = useState<RuleFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // MS Teams group picker
  const [groups, setGroups] = useState<TeamsGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [expandingGroup, setExpandingGroup] = useState<string | null>(null);

  // Individual email input
  const [emailInput, setEmailInput] = useState("");

  const set = (key: keyof RuleFormState, val: any) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  async function loadGroups() {
    if (groups.length > 0) return;
    setLoadingGroups(true);
    try {
      const res = await apiFetch("/api/automation/ms365/groups", userEmail, userRole);
      const data = await res.json();
      setGroups(data.groups || []);
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }

  function addIndividualEmail() {
    const raw = emailInput.trim();
    if (!raw) return;
    const addresses = raw.split(/[,;\s]+/).filter(Boolean);
    const newRecipients: Recipient[] = addresses.map((e) => ({
      type: "individual",
      email: e,
      name: e,
    }));
    set(
      "recipients_json",
      [
        ...form.recipients_json,
        ...newRecipients.filter(
          (nr) =>
            !form.recipients_json.some(
              (ex) => ex.type === "individual" && ex.email === nr.email
            )
        ),
      ]
    );
    setEmailInput("");
  }

  async function addTeamsGroup(group: TeamsGroup) {
    if (form.recipients_json.some((r) => r.type === "teams_group" && r.id === group.id)) {
      setShowGroupPicker(false);
      return;
    }
    setExpandingGroup(group.id);
    try {
      const res = await apiFetch(
        `/api/automation/ms365/groups/${group.id}/members`,
        userEmail,
        userRole
      );
      const data = await res.json();
      const memberEmails: string[] = (data.members || [])
        .map((m: any) => m.email)
        .filter(Boolean);
      const newR: Recipient = {
        type: "teams_group",
        id: group.id,
        name: group.name,
        emails: memberEmails,
      };
      set("recipients_json", [...form.recipients_json, newR]);
    } catch {
      // Fallback: add group without expanded members
      const newR: Recipient = { type: "teams_group", id: group.id, name: group.name, emails: [] };
      set("recipients_json", [...form.recipients_json, newR]);
    } finally {
      setExpandingGroup(null);
      setShowGroupPicker(false);
    }
  }

  function removeRecipient(idx: number) {
    set("recipients_json", form.recipients_json.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email_subject.trim() || !form.email_body.trim()) {
      setError("Name, subject, and body are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (err: any) {
      setError(err.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase())
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name + Description */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">
            Automation Name <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. Daily Training Reminder"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">
            Description
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="What does this automation do?"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
      </div>

      {/* Schedule */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Schedule
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Frequency</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={form.frequency}
              onChange={(e) => {
                set("frequency", e.target.value);
                set("day_of_week", null);
                set("day_of_month", null);
              }}
            >
              <option value="daily">Daily (weekdays)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {(form.frequency === "weekly") && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Day of Week</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                value={form.day_of_week ?? 0}
                onChange={(e) => set("day_of_week", Number(e.target.value))}
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {form.frequency === "monthly" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Day of Month</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                value={form.day_of_month ?? 1}
                onChange={(e) => set("day_of_month", Number(e.target.value))}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Send Time</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={form.hour}
              onChange={(e) => set("hour", Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => {
                const label = h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`;
                return <option key={h} value={h}>{label}</option>;
              })}
            </select>
          </div>
        </div>
      </div>

      {/* Email subject + body */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5" /> Email Content
        </h4>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Subject <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. Reminder: Complete Your Safety Training"
            value={form.email_subject}
            onChange={(e) => set("email_subject", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Message Body <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={6}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            placeholder={"Hi Team,\n\nThis is a reminder to complete your mandatory training by this Friday.\n\nPlease log in to the LMS portal and finish all pending modules.\n\nThank you!"}
            value={form.email_body}
            onChange={(e) => set("email_body", e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Plain text. Line breaks are preserved in the email.
          </p>
        </div>
      </div>

      {/* Recipients */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Recipients
        </h4>

        {/* Individual email input */}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Add email addresses (comma-separated)"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addIndividualEmail();
              }
            }}
          />
          <button
            type="button"
            onClick={addIndividualEmail}
            className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors flex items-center gap-1"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {/* Teams group picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowGroupPicker((p) => !p);
              loadGroups();
            }}
            className="flex items-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg px-3 py-2 transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            Add Microsoft Teams group
            {showGroupPicker ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <AnimatePresence>
            {showGroupPicker && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full mt-1 z-20 bg-background border border-border rounded-xl shadow-lg w-72 max-h-64 overflow-y-auto"
              >
                <div className="p-2 border-b border-border sticky top-0 bg-background">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      autoFocus
                      className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 bg-muted/30"
                      placeholder="Search groups…"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                    />
                  </div>
                </div>
                {loadingGroups ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Loading…</div>
                ) : filteredGroups.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    {groups.length === 0
                      ? "Connect your Microsoft account in Settings to pick groups."
                      : "No groups found."}
                  </div>
                ) : (
                  filteredGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => addTeamsGroup(g)}
                      disabled={expandingGroup === g.id}
                      className="w-full flex flex-col items-start px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-60"
                    >
                      <span className="font-medium truncate">{g.name}</span>
                      {g.description && (
                        <span className="text-xs text-muted-foreground truncate">{g.description}</span>
                      )}
                      {expandingGroup === g.id && (
                        <span className="text-xs text-muted-foreground">Fetching members…</span>
                      )}
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Recipient chips */}
        {form.recipients_json.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {form.recipients_json.map((r, i) => (
              <RecipientPill key={i} r={r} onRemove={() => removeRecipient(i)} />
            ))}
          </div>
        )}
        {form.recipients_json.length === 0 && (
          <p className="text-xs text-muted-foreground">No recipients added yet.</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Automation"}
        </button>
      </div>
    </form>
  );
}

// ── Rule Card ─────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit,
  onSendNow,
  currentUserEmail,
  currentUserRole,
}: {
  rule: AutomationRule;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSendNow: () => void;
  currentUserEmail: string;
  currentUserRole: string;
}) {
  const [sendingNow, setSendingNow] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const canManage =
    rule.created_by === currentUserEmail || currentUserRole.toLowerCase() === "super admin";

  async function handleSendNow() {
    setSendingNow(true);
    setSendResult(null);
    onSendNow();
    setSendingNow(false);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn(
        "rounded-2xl border bg-card shadow-sm p-5 transition-all",
        rule.is_active ? "border-border" : "border-border/50 opacity-70"
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              "flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
              rule.is_active
                ? "bg-amber-100 text-amber-600"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground truncate">{rule.name}</h3>
            {rule.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{rule.description}</p>
            )}
          </div>
        </div>

        {/* Active toggle + badge */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full border",
              rule.is_active
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-muted border-border text-muted-foreground"
            )}
          >
            {rule.is_active ? "Active" : "Paused"}
          </span>
          {canManage && (
            <button
              onClick={onToggle}
              title={rule.is_active ? "Pause" : "Resume"}
              className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
            >
              {rule.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{describeCadence(rule)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{recipientCount(rule.recipients_json)} recipient{recipientCount(rule.recipients_json) !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Mail className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{rule.email_subject}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <StatusBadge status={rule.last_status} />
        </div>
      </div>

      {/* Next / last run */}
      <div className="mt-3 flex gap-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
        <span>Next: <span className="text-foreground">{formatDt(rule.next_run)}</span></span>
        <span>Last: <span className="text-foreground">{formatDt(rule.last_run)}</span></span>
      </div>

      {/* Actions */}
      {canManage && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            <Edit2 className="h-3 w-3" /> Edit
          </button>
          <button
            onClick={handleSendNow}
            disabled={sendingNow}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-60"
          >
            <Send className="h-3 w-3" /> Send Now
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors ml-auto"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AutomationHub() {
  const { user } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AutomationRule | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const email = user?.email ?? "";
  const role = user?.role ?? "";

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/automation/rules", email, role);
      if (!res.ok) throw new Error("Failed to load automations");
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [email, role]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  async function handleSave(formData: RuleFormState) {
    const body = JSON.stringify(formData);
    if (editingRule) {
      const res = await apiFetch(`/api/automation/rules/${editingRule.id}`, email, role, {
        method: "PATCH",
        body,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Update failed");
      }
    } else {
      const res = await apiFetch("/api/automation/rules", email, role, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Create failed");
      }
    }
    setShowForm(false);
    setEditingRule(null);
    showToast(editingRule ? "Automation updated." : "Automation created.");
    fetchRules();
  }

  async function handleToggle(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}`, email, role, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !rule.is_active }),
    });
    if (res.ok) {
      showToast(rule.is_active ? "Automation paused." : "Automation resumed.");
      fetchRules();
    } else {
      showToast("Failed to update status.", "error");
    }
  }

  async function handleDelete(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}`, email, role, {
      method: "DELETE",
    });
    setDeleteConfirm(null);
    if (res.ok) {
      showToast("Automation deleted.");
      fetchRules();
    } else {
      showToast("Failed to delete.", "error");
    }
  }

  async function handleSendNow(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}/send-now`, email, role, {
      method: "POST",
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      showToast(`Sent to ${data.sent_to?.length ?? 0} recipient(s).`);
    } else {
      showToast(data.detail || "Send failed.", "error");
    }
  }

  function openEdit(rule: AutomationRule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  function openCreate() {
    setEditingRule(null);
    setShowForm(true);
  }

  const formInitial: RuleFormState = editingRule
    ? {
        name: editingRule.name,
        description: editingRule.description,
        frequency: editingRule.frequency,
        day_of_week: editingRule.day_of_week,
        day_of_month: editingRule.day_of_month,
        hour: editingRule.hour,
        email_subject: editingRule.email_subject,
        email_body: editingRule.email_body,
        recipients_json: editingRule.recipients_json,
      }
    : BLANK_FORM;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f5f7fa] dark:bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Zap className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Email Automation Hub</h1>
              <p className="text-xs text-muted-foreground">
                Schedule recurring emails to Teams groups or individual recipients
              </p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" /> New Automation
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Create / Edit form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="mb-6 rounded-2xl border border-border bg-card shadow-sm p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-sm text-foreground">
                  {editingRule ? "Edit Automation" : "New Automation"}
                </h2>
                <button
                  onClick={() => { setShowForm(false); setEditingRule(null); }}
                  className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <RuleForm
                key={editingRule?.id ?? "new"}
                initial={formInitial}
                onSave={handleSave}
                onCancel={() => { setShowForm(false); setEditingRule(null); }}
                userEmail={email}
                userRole={role}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rule list */}
        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-card h-36 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mb-4">
              <Zap className="h-7 w-7 text-amber-500" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">No automations yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Create your first automation to send scheduled emails — training reminders, weekly
              updates, or any recurring communication.
            </p>
            <button
              onClick={openCreate}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Create Automation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence>
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={() => handleToggle(rule)}
                  onDelete={() => setDeleteConfirm(rule)}
                  onEdit={() => openEdit(rule)}
                  onSendNow={() => handleSendNow(rule)}
                  currentUserEmail={email}
                  currentUserRole={role}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-sm w-full mx-4"
            >
              <h3 className="font-semibold text-foreground mb-2">Delete Automation?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                <span className="font-medium text-foreground">{deleteConfirm.name}</span> will be
                permanently removed and will stop sending emails.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.msg}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl shadow-lg text-sm font-medium border",
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-red-50 border-red-200 text-red-800"
            )}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
