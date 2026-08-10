import { Download } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { downloadCsv } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function ExportCsvButton({
  rows,
  filename,
  className,
}: {
  rows: Record<string, unknown>[];
  filename: string;
  className?: string;
}) {
  const { user } = useAuth();
  if (user?.role === "Employee") return null;

  return (
    <button
      onClick={() => downloadCsv(filename, rows)}
      disabled={!rows.length}
      className={cn(
        "flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
    >
      <Download className="h-3 w-3" />
      Export CSV
    </button>
  );
}
