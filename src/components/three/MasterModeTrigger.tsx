// Master Mode's header trigger — a small glowing 3D orb, not a plain switch.
// Three.js renders the orb itself (continuous rotation + idle glow pulse, same
// technique as the cockpit's core mesh so the trigger visually previews what it
// opens); GSAP owns everything DOM-level around it — the breathing halo, the
// hover/press micro-interactions — since fighting R3F's render loop with GSAP
// for the rotation itself would just add a second, redundant clock.
import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import * as THREE from "three";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { cn } from "@/lib/utils";

function OrbMesh({ active }: { active: boolean }) {
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    const speed = active ? 0.55 : 0.26;
    if (wire.current) {
      wire.current.rotation.y += delta * speed;
      wire.current.rotation.x += delta * speed * 0.4;
    }
    const pulse =
      1 + Math.sin(state.clock.elapsedTime * (active ? 2.4 : 1.4)) * (active ? 0.1 : 0.05);
    glow.current?.scale.setScalar(pulse);
  });
  return (
    <>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshBasicMaterial
          color={active ? "#5eead4" : "#2dd4bf"}
          wireframe
          transparent
          opacity={active ? 0.95 : 0.65}
        />
      </mesh>
      <mesh ref={glow} scale={0.85}>
        {/* icosahedron, not a lat-long sphere — no pole vertices, so additive blending
            reads as one even glow instead of piling up at the seam (see MasterModePanel). */}
        <icosahedronGeometry args={[1.05, 1]} />
        <meshBasicMaterial
          color="#00c4bb"
          transparent
          opacity={active ? 0.55 : 0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

export function MasterModeTrigger({ active, onClick }: { active: boolean; onClick: () => void }) {
  const { canRender3D } = useDeviceTier();
  const wrapRef = useRef<HTMLButtonElement>(null);
  const haloRef = useRef<HTMLSpanElement>(null);

  // Idle breathing halo — a slow, continuous loop so the trigger reads as "alive"
  // at rest, not just on hover. Speeds up and brightens while the cockpit is open.
  useEffect(() => {
    if (!haloRef.current) return;
    const tween = gsap.to(haloRef.current, {
      opacity: active ? 0.9 : 0.55,
      scale: active ? 1.4 : 1.15,
      duration: active ? 1.1 : 1.9,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true,
    });
    return () => {
      tween.kill();
    };
  }, [active]);

  const handleEnter = () => {
    if (wrapRef.current) gsap.to(wrapRef.current, { scale: 1.12, duration: 0.25, ease: "back.out(2)" });
  };
  const handleLeave = () => {
    if (wrapRef.current) gsap.to(wrapRef.current, { scale: 1, duration: 0.35, ease: "power2.out" });
  };
  const handleClick = () => {
    if (wrapRef.current) {
      gsap.fromTo(
        wrapRef.current,
        { scale: 0.88 },
        { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" },
      );
    }
    onClick();
  };

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      role="switch"
      aria-checked={active}
      title={active ? "Close Master Mode" : "Open Master Mode"}
      className="group relative flex items-center gap-2 rounded-full px-1.5 py-1"
      style={{ transformOrigin: "center" }}
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center sm:h-9 sm:w-9">
        <span
          ref={haloRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-8px] rounded-full opacity-50"
          style={{
            background:
              "radial-gradient(circle, rgba(0,196,187,0.55) 0%, rgba(34,211,238,0.28) 45%, transparent 72%)",
            filter: "blur(4px)",
          }}
        />
        {canRender3D ? (
          <Canvas
            style={{ position: "absolute", inset: 0 }}
            camera={{ position: [0, 0, 3.1], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          >
            <OrbMesh active={active} />
          </Canvas>
        ) : (
          // Low-tier / reduced-motion fallback — static glow disc, no WebGL context.
          <span
            className="absolute inset-1 rounded-full"
            style={{
              background: "radial-gradient(circle at 35% 30%, #5eead4, #00c4bb 60%, #0e7490 100%)",
              boxShadow: "0 0 14px rgba(0,196,187,0.7)",
            }}
          />
        )}
      </span>
      <span
        className={cn(
          "hidden text-[11px] font-semibold tracking-wide transition-colors sm:inline",
          active ? "text-[#00c4bb]" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        Master Mode
      </span>
    </button>
  );
}
