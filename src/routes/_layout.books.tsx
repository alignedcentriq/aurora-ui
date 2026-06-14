import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import { BookOpen, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/books")({
  component: BooksCatalog,
});

interface Book {
  id: number;
  title: string;
  author: string;
  category: string;
  description: string;
  total_copies: number;
  available_copies: number;
  availability_status: string;
}

const AVAILABILITY_COLOR: Record<string, string> = {
  "Available Now": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Limited Availability": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  "Currently Unavailable": "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

function BooksCatalog() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [requesting, setRequesting] = useState<number | null>(null);

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = availableOnly ? "?available_only=true" : "";
      const res = await fetch(`/api/portal/library/books${qs}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load catalog");
      setBooks(await res.json());
    } catch {
      toast.error("Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, availableOnly]);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const categories = useMemo(() => {
    const set = new Set<string>(["All"]);
    books.forEach((b) => b.category && set.add(b.category));
    return Array.from(set);
  }, [books]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return books.filter((b) => {
      if (category !== "All" && b.category !== category) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        (b.author || "").toLowerCase().includes(q) ||
        (b.description || "").toLowerCase().includes(q) ||
        (b.category || "").toLowerCase().includes(q)
      );
    });
  }, [books, search, category]);

  const requestBook = async (book: Book) => {
    setRequesting(book.id);
    try {
      const res = await fetch(`/api/portal/library/requests`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ book_id: book.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Could not submit request");
      toast.success(`Requested "${book.title}"`, {
        description: "Admin has been notified and will get back to you shortly.",
      });
      fetchBooks();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not submit request");
    } finally {
      setRequesting(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-8 py-4 sm:py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[18px] sm:text-[20px] font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" /> Company Library
          </h1>
          <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5">
            Browse available titles and request what you'd like to borrow.
          </p>
        </div>
        <Link
          to="/my-library"
          className="self-start sm:self-auto rounded-lg px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          My Library →
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-8 py-3 border-b border-[var(--border)] shrink-0">
        <div className="relative flex-1 min-w-[160px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by title, author, topic..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40 transition-colors"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[12px] sm:text-[13px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
            className="accent-primary"
          />
          Available only
        </label>
        <button
          onClick={fetchBooks}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4 sm:py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading catalog…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-[14px]">
            <BookOpen className="h-8 w-8 mb-3 opacity-40" />
            No books match your filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((book) => {
              const badge = AVAILABILITY_COLOR[book.availability_status] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
              const out = book.available_copies <= 0;
              return (
                <div
                  key={book.id}
                  className="rounded-xl border border-[var(--border)] bg-card p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-foreground leading-snug line-clamp-2">{book.title}</h3>
                      <p className="text-[12px] text-muted-foreground mt-0.5">{book.author}</p>
                    </div>
                    {book.category && (
                      <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                        {book.category}
                      </span>
                    )}
                  </div>
                  {book.description && (
                    <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-3">{book.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium border", badge)}>
                      {book.available_copies}/{book.total_copies} • {book.availability_status}
                    </span>
                    <button
                      disabled={out || requesting === book.id}
                      onClick={() => requestBook(book)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                        out
                          ? "bg-zinc-500/10 text-zinc-400 cursor-not-allowed"
                          : "bg-primary/15 text-primary hover:bg-primary/25",
                      )}
                    >
                      {requesting === book.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Requesting…
                        </>
                      ) : out ? (
                        "Unavailable"
                      ) : (
                        "Request Book"
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
