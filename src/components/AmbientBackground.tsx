export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base tint — never pure black */}
      <div className="absolute inset-0 bg-background" />

      {/* Radial gradient wash */}
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(60% 45% at 18% 8%, color-mix(in oklab, var(--accent-blue) 22%, transparent) 0%, transparent 65%), radial-gradient(55% 45% at 95% 95%, color-mix(in oklab, var(--accent-cyan) 18%, transparent) 0%, transparent 65%)",
        }}
      />

      {/* Floating blobs */}
      <div
        className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full blur-[120px] mix-blend-screen dark:mix-blend-screen opacity-70 animate-[float-slow_14s_ease-in-out_infinite]"
        style={{ background: "color-mix(in oklab, var(--accent-blue) 45%, transparent)" }}
      />
      <div
        className="absolute -bottom-52 -right-40 h-[640px] w-[640px] rounded-full blur-[140px] mix-blend-screen opacity-60 animate-[float-slow_18s_ease-in-out_infinite]"
        style={{ background: "color-mix(in oklab, var(--accent-cyan) 40%, transparent)" }}
      />

      {/* Grid noise (very subtle) */}
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          color: "var(--foreground)",
          maskImage:
            "radial-gradient(ellipse 70% 50% at 50% 40%, black 40%, transparent 80%)",
        }}
      />
    </div>
  );
}
