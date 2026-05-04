export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base tint — never pure black */}
      <div className="absolute inset-0 bg-background" />

      {/* Floating blobs — these are soft solid colors, not technical gradients */}
      <div
        className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full blur-[120px] mix-blend-screen dark:mix-blend-screen opacity-70 animate-[float-slow_14s_ease-in-out_infinite]"
        style={{ background: "color-mix(in oklab, var(--accent-blue) 45%, transparent)" }}
      />
      <div
        className="absolute -bottom-52 -right-40 h-[640px] w-[640px] rounded-full blur-[140px] mix-blend-screen opacity-60 animate-[float-slow_18s_ease-in-out_infinite]"
        style={{ background: "color-mix(in oklab, var(--accent-cyan) 40%, transparent)" }}
      />
    </div>
  );
}
