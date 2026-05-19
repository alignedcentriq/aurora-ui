import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import { Menu } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Mobile top bar — hidden on md+ */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 flex items-center gap-3 px-4 border-b border-border bg-background z-30">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center h-8 w-8 rounded-md text-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size="sm" />
        <BrandName className="text-[14px]" withAI={true} />
      </div>

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
