import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type TableContextType = {
  page: number;
  setPage: (p: number) => void;
  itemsPerPage: number;
  setTotalItems: (t: number) => void;
  paginate: boolean;
};

const TableContext = React.createContext<TableContextType | null>(null);

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { paginate?: boolean; itemsPerPage?: number }
>(({ className, paginate = false, itemsPerPage = 10, children, ...props }, ref) => {
  const [page, setPage] = React.useState(1);
  const [totalItems, setTotalItems] = React.useState(0);

  // If the data changes and the current page is now empty, go back to a valid page
  React.useEffect(() => {
    if (paginate && totalItems > 0) {
      const maxPage = Math.ceil(totalItems / itemsPerPage);
      if (page > maxPage) {
        setPage(maxPage);
      }
    }
  }, [totalItems, itemsPerPage, page, paginate]);

  return (
    <TableContext.Provider value={{ page, setPage, itemsPerPage, setTotalItems, paginate }}>
      <div className="flex flex-col w-full">
        <div className="relative w-full overflow-auto rounded-xl border border-border/60 shadow-sm">
          <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props}>
            {children}
          </table>
        </div>
        {paginate && totalItems > itemsPerPage && (
          <div className="flex items-center justify-between px-4 py-3 border border-t-0 border-border/60 rounded-b-xl bg-card">
            <div className="text-xs text-muted-foreground font-medium">
              Showing {(page - 1) * itemsPerPage + 1} to {Math.min(page * itemsPerPage, totalItems)} of {totalItems} entries
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border/60 hover:bg-secondary disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page * itemsPerPage >= totalItems}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border/60 hover:bg-secondary disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </TableContext.Provider>
  );
});
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "bg-gradient-to-b from-muted/60 to-muted/30 [&_tr]:border-b [&_tr]:border-border/60",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(TableContext);
  
  // Flatten children (resolves .map() returning arrays)
  const childrenArray = React.Children.toArray(children);
  
  // Need a stable ref to avoid dependency cycle in useEffect if we used childrenArray directly
  const itemsCount = childrenArray.length;
  
  React.useEffect(() => {
    if (ctx && ctx.paginate) {
      ctx.setTotalItems(itemsCount);
    }
  }, [itemsCount, ctx]);

  let content = childrenArray;
  if (ctx && ctx.paginate) {
    const start = (ctx.page - 1) * ctx.itemsPerPage;
    content = childrenArray.slice(start, start + ctx.itemsPerPage);
  }

  return (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {content}
    </tbody>
  );
});
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border/50 transition-colors duration-150 hover:bg-primary/[0.03] data-[state=selected]:bg-primary/5",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-3 text-left align-middle text-xs font-bold uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
