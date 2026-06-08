import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, Sparkles, Loader2, Send, CheckCircle2, ImagePlus, X, Link2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import type { AnnouncementPrefill } from "@/lib/chat-store";

type ActionType = "url" | "form" | "app";
interface ImageAction { type: ActionType; value: string; label: string }
interface FormStub { id: number; name: string; description: string; fields: object[] }
interface AppStub { id: number; name: string; url: string; purpose: string }

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [actionType, setActionType] = useState<ActionType>("url");
  const [actionValue, setActionValue] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [imageAction, setImageAction] = useState<ImageAction | null>(null);
  const [forms, setForms] = useState<FormStub[]>([]);
  const [apps, setApps] = useState<AppStub[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const domain = prefill?.domain ?? ROLE_TO_DOMAIN[userRole.toLowerCase()] ?? "admin";

  useEffect(() => {
    if (!showLinkPicker || (forms.length > 0 && apps.length > 0)) return;
    const h = { "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() };
    fetch("/api/forms/list", { headers: h }).then(r => r.ok ? r.json() : []).then(setForms).catch(() => {});
    fetch("/api/urls/list", { headers: h }).then(r => r.ok ? r.json() : []).then(setApps).catch(() => {});
  }, [showLinkPicker]);

  const applyAction = () => {
    if (!actionValue.trim()) { toast.error("Enter a destination"); return; }
    setImageAction({ type: actionType, value: actionValue.trim(), label: actionLabel.trim() || actionValue.trim() });
    setShowLinkPicker(false);
  };

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files can be attached");
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/announcements/upload-image", {
        method: "POST",
        headers: {
          "x-user-email": userEmail,
          "x-user-role": userRole.toLowerCase(),
        },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setImageUrl(data.url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((i) => i.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) uploadImage(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) {
      e.preventDefault();
      uploadImage(file);
    }
  };

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
          image_url: imageUrl,
          image_action: imageAction,
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
          <div className="relative">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              rows={4}
              placeholder="What do you want everyone to know? Paste or drop an image to attach."
              className={`w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-primary/10 ${dragOver ? "border-primary bg-primary/5" : "border-border focus:border-primary/50"}`}
            />
            {uploadingImage && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
          </div>
          {imageUrl ? (
            <>
              <div className="relative mt-1 overflow-hidden rounded-xl border border-border">
                <img src={imageUrl} alt="Attached" className="max-h-40 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => { setImageUrl(null); setImageAction(null); setShowLinkPicker(false); }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  title="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Link action row */}
              {imageAction ? (
                <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                  <Link2 className="h-3 w-3 shrink-0 text-primary" />
                  <span className="flex-1 truncate text-[11px] text-foreground">{imageAction.label}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{imageAction.type}</span>
                  <button type="button" onClick={() => { setImageAction(null); setShowLinkPicker(true); }} className="ml-1 text-[10px] text-muted-foreground hover:text-foreground">Edit</button>
                  <button type="button" onClick={() => setImageAction(null)} className="text-muted-foreground hover:text-rose-500 transition-colors"><X className="h-3 w-3" /></button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLinkPicker((v) => !v)}
                  className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Add click action
                  <ChevronDown className={`h-3 w-3 transition-transform ${showLinkPicker ? "rotate-180" : ""}`} />
                </button>
              )}

              <AnimatePresence>
                {showLinkPicker && !imageAction && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="mt-1 overflow-hidden rounded-xl border border-border bg-muted/30 p-3 space-y-2"
                  >
                    {/* Type tabs */}
                    <div className="flex gap-1">
                      {(["url", "form", "app"] as ActionType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setActionType(t); setActionValue(""); setActionLabel(""); }}
                          className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${actionType === t ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground border border-border"}`}
                        >
                          {t === "url" ? "External URL" : t === "form" ? "Open Form" : "Open App"}
                        </button>
                      ))}
                    </div>

                    {actionType === "url" && (
                      <input
                        value={actionValue}
                        onChange={(e) => setActionValue(e.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/50"
                      />
                    )}

                    {actionType === "form" && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">Select a form</p>
                        {forms.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">No forms available</p>
                        ) : (
                          <div className="max-h-32 overflow-y-auto space-y-1 no-scrollbar">
                            {forms.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => { setActionValue(String(f.id)); setActionLabel(f.name); }}
                                className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${actionValue === String(f.id) ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted/40"}`}
                              >
                                {f.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {actionType === "app" && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">Select an app</p>
                        {apps.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">No apps available</p>
                        ) : (
                          <div className="max-h-32 overflow-y-auto space-y-1 no-scrollbar">
                            {apps.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => { setActionValue(a.url); setActionLabel(a.name); }}
                                className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${actionValue === a.url ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted/40"}`}
                              >
                                <span className="font-medium">{a.name}</span>
                                {a.purpose && <span className="ml-1.5 text-muted-foreground text-[10px]">— {a.purpose.slice(0, 40)}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={applyAction}
                      disabled={!actionValue.trim()}
                      className="w-full rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Add image
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }}
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
