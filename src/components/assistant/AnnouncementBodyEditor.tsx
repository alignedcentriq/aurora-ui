import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ImagePlus, Link2, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

type ActionType = "url" | "form" | "app";
export interface ImageAction {
  type: ActionType;
  value: string;
  label: string;
}
interface FormStub {
  id: number;
  name: string;
  description: string;
  fields: object[];
}
interface AppStub {
  id: number;
  name: string;
  url: string;
  purpose: string;
}

interface Props {
  body: string;
  onBodyChange: (v: string) => void;
  imageUrl: string | null;
  onImageUrlChange: (v: string | null) => void;
  imageAction: ImageAction | null;
  onImageActionChange: (v: ImageAction | null) => void;
  authHeaders: Record<string, string>;
  title: string;
  category: string;
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function AnnouncementBodyEditor({
  body,
  onBodyChange,
  imageUrl,
  onImageUrlChange,
  imageAction,
  onImageActionChange,
  authHeaders,
  title,
  category,
  placeholder = "What do you want everyone to know? Paste or drop an image to attach.",
  rows = 8,
  className = "",
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [actionType, setActionType] = useState<ActionType>("url");
  const [actionValue, setActionValue] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [forms, setForms] = useState<FormStub[]>([]);
  const [apps, setApps] = useState<AppStub[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files can be attached");
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { "Content-Type": _ct, ...uploadHeaders } = authHeaders;
      const res = await fetch("/api/announcements/upload-image", {
        method: "POST",
        headers: uploadHeaders,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      onImageUrlChange(data.url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const f = imageItem.getAsFile();
      if (f) uploadImage(f);
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

  const handleSuggest = async () => {
    if (!title.trim()) {
      toast.error("Enter a title first");
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch("/api/announcements/suggest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Couldn't draft body");
      onBodyChange(data.body ?? "");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setSuggesting(false);
    }
  };

  const loadFormsAndApps = () => {
    const h = {
      "x-user-email": authHeaders["x-user-email"],
      "x-user-role": authHeaders["x-user-role"],
    };
    if (forms.length === 0)
      fetch("/api/forms/list", { headers: h })
        .then((r) => (r.ok ? r.json() : []))
        .then(setForms)
        .catch(() => {});
    if (apps.length === 0)
      fetch("/api/urls/list", { headers: h })
        .then((r) => (r.ok ? r.json() : []))
        .then(setApps)
        .catch(() => {});
  };

  const applyAction = () => {
    if (!actionValue.trim()) {
      toast.error("Enter a destination");
      return;
    }
    onImageActionChange({
      type: actionType,
      value: actionValue.trim(),
      label: actionLabel.trim() || actionValue.trim(),
    });
    setShowLinkPicker(false);
  };

  const removeImage = () => {
    onImageUrlChange(null);
    onImageActionChange(null);
    setShowLinkPicker(false);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Message label + AI draft action */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Message
        </span>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          title="Write the message for you from the title — you can edit it after"
          className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-600 hover:bg-violet-500/20 disabled:opacity-50 transition-colors dark:text-violet-300"
        >
          {suggesting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Writing…
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              Draft with AI
            </>
          )}
        </button>
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          rows={rows}
          placeholder={placeholder}
          className={`w-full resize-y rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-primary/10 ${dragOver ? "border-primary bg-primary/5" : "border-border focus:border-primary/50"}`}
        />
        {uploadingImage && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Image area */}
      {imageUrl ? (
        <>
          <div className="relative overflow-hidden rounded-xl border border-border">
            <img src={imageUrl} alt="Attached" className="max-h-48 w-full object-cover" />
            <button
              type="button"
              onClick={removeImage}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              title="Remove image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {imageAction ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
              <Link2 className="h-3 w-3 shrink-0 text-primary" />
              <span className="flex-1 truncate text-[11px] text-foreground">
                {imageAction.label}
              </span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {imageAction.type}
              </span>
              <button
                type="button"
                onClick={() => {
                  onImageActionChange(null);
                  setShowLinkPicker(true);
                }}
                className="ml-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onImageActionChange(null)}
                className="text-muted-foreground hover:text-rose-500 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowLinkPicker((v) => !v);
                loadFormsAndApps();
              }}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Link2 className="h-3.5 w-3.5" />
              Add click action
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showLinkPicker ? "rotate-180" : ""}`}
              />
            </button>
          )}

          <AnimatePresence>
            {showLinkPicker && !imageAction && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden rounded-xl border border-border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex gap-1">
                  {(["url", "form", "app"] as ActionType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setActionType(t);
                        setActionValue("");
                        setActionLabel("");
                        if (t !== "url") loadFormsAndApps();
                      }}
                      className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${actionType === t ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground border border-border"}`}
                    >
                      {t === "url" ? "URL" : t === "form" ? "Form" : "App"}
                    </button>
                  ))}
                </div>

                {actionType === "url" && (
                  <input
                    value={actionValue}
                    onChange={(e) => setActionValue(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50"
                  />
                )}

                {actionType === "form" && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">Select a form</p>
                    {forms.length === 0 ? (
                      <p className="text-[11px] italic text-muted-foreground">No forms available</p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {forms.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              setActionValue(String(f.id));
                              setActionLabel(f.name);
                            }}
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
                      <p className="text-[11px] italic text-muted-foreground">No apps available</p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {apps.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => {
                              setActionValue(a.url);
                              setActionLabel(a.name);
                            }}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${actionValue === a.url ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted/40"}`}
                          >
                            <span className="font-medium">{a.name}</span>
                            {a.purpose && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">
                                — {a.purpose.slice(0, 40)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <input
                  value={actionLabel}
                  onChange={(e) => setActionLabel(e.target.value)}
                  placeholder="Button label (optional)"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={applyAction}
                  disabled={!actionValue.trim()}
                  className="w-full rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40 transition-colors"
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
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
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
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadImage(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
