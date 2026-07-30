// Master Mode landing — "Synaptic Layer / Model Council": a glowing neural core
// orbited by the four inference tiers this app actually runs, all served locally
// via Ollama (see backend/app/config.py). No ChatGPT / Claude / Gemini here.
import { useDeviceTier } from "@/hooks/use-device-tier";
import { useNavigate } from "@tanstack/react-router";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import { Brain, Network, Wrench, Zap, type LucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

interface ModelNode {
  id: string;
  tier: string;
  model: string;
  role: string;
  color: string;
  confidence: number;
  icon: LucideIcon;
}

const MODELS: ModelNode[] = [
  { id: "reasoning", tier: "Reasoning", model: "gpt-oss:latest", role: "Deep answers · intent routing", color: "#22d3ee", confidence: 88, icon: Brain },
  { id: "service", tier: "Tool-Calling", model: "llama3.1:8b", role: "Actions · summaries", color: "#818cf8", confidence: 91, icon: Wrench },
  { id: "router", tier: "Routing", model: "llama3.2:3b", role: "Fast triage · general chat", color: "#fbbf24", confidence: 76, icon: Zap },
  { id: "embeddings", tier: "Embeddings", model: "nomic-embed-text", role: "Semantic search · RAG", color: "#34d399", confidence: 95, icon: Network },
];

const NODE_RADIUS = 3.2;

// Clickable — this core is Memory Brain's entry point from the landing page.
function Core({ onActivate }: { onActivate: () => void }) {
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (wire.current) {
      wire.current.rotation.y = t * 0.15;
      wire.current.rotation.x = t * 0.08;
    }
    glow.current?.scale.setScalar((1 + Math.sin(t * 1.4) * 0.05) * (hovered ? 1.15 : 1));
  });
  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); gl.domElement.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); gl.domElement.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onActivate(); }}
    >
      <mesh ref={wire}>
        <icosahedronGeometry args={[0.9, 2]} />
        <meshBasicMaterial color="#67e8f9" wireframe transparent opacity={hovered ? 0.85 : 0.55} />
      </mesh>
      <mesh ref={glow}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={hovered ? 0.3 : 0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {hovered && (
        <Html center distanceFactor={9} position={[0, 1.25, 0]} occlude={false}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-white/10 bg-black/60 px-2.5 py-1 text-center text-[11px] text-cyan-200 backdrop-blur-sm">
            Open Memory Brain
          </div>
        </Html>
      )}
    </group>
  );
}

function ModelBadge({
  node,
  position,
  selectedId,
  onSelect,
}: {
  node: ModelNode;
  position: [number, number, number];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const isSelected = selectedId === node.id;
  const isDimmed = selectedId !== null && !isSelected;

  return (
    <group>
      <Line
        points={[[0, 0, 0], position]}
        color={node.color}
        transparent
        opacity={isSelected ? 0.85 : isDimmed ? 0.06 : 0.18}
        lineWidth={1}
      />
      {/* billboarded HTML badge, not a textured mesh — generic tier icon, not a brand logo */}
      <Html position={position} center distanceFactor={9} style={{ pointerEvents: "auto" }}>
        <div
          onClick={() => onSelect(isSelected ? null : node.id)}
          className="flex cursor-pointer select-none flex-col items-center transition-all duration-300"
          style={{ transform: `scale(${isSelected ? 1.15 : isDimmed ? 0.85 : 1})`, opacity: isDimmed ? 0.45 : 1 }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-sm"
            style={{
              border: `2px solid ${node.color}`,
              background: "rgba(8,11,20,0.65)",
              color: node.color,
              boxShadow: `0 0 ${isSelected ? 22 : 10}px ${node.color}90`,
            }}
          >
            <node.icon size={20} strokeWidth={2} />
          </div>
          <div className="mt-2 whitespace-nowrap rounded-md border border-white/10 bg-black/50 px-2.5 py-1 text-center backdrop-blur-sm">
            <div className="text-[13px] font-medium text-slate-100">{node.tier}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{node.model}</div>
          </div>
        </div>
      </Html>
    </group>
  );
}

function Scene({
  selectedId,
  onSelect,
  onOpenMemoryBrain,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenMemoryBrain: () => void;
}) {
  const grid = useMemo(() => {
    const g = new THREE.PolarGridHelper(5.2, 8, 8, 64, 0x2a3550, 0x1b2338);
    g.position.y = -1.3;
    return g;
  }, []);

  return (
    <>
      <Core onActivate={onOpenMemoryBrain} />
      <Sparkles count={140} scale={1.8} size={2.4} speed={0.3} color="#bef2ff" opacity={0.85} />
      <primitive object={grid} />
      {MODELS.map((node, i) => {
        const angle = (i / MODELS.length) * Math.PI * 2 + Math.PI / 4;
        const position: [number, number, number] = [
          Math.cos(angle) * NODE_RADIUS,
          0.15 * Math.sin(angle * 2),
          Math.sin(angle) * NODE_RADIUS,
        ];
        return <ModelBadge key={node.id} node={node} position={position} selectedId={selectedId} onSelect={onSelect} />;
      })}
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.6}
        minPolarAngle={1.3}
        maxPolarAngle={1.3}
      />
    </>
  );
}

export function MasterModeLanding() {
  const { tier, canRender3D } = useDeviceTier();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = MODELS.find((m) => m.id === selectedId) ?? null;
  const openMemoryBrain = () => navigate({ to: "/control-hub", search: { tab: "memory-brain" } });

  return (
    <div
      className="relative h-screen w-full overflow-hidden text-slate-200"
      style={{ background: "radial-gradient(120% 100% at 50% 15%, #0b101c 0%, #05070d 70%)" }}
    >
      {canRender3D ? (
        <Canvas
          camera={{ position: [0, 2.6, 7.2], fov: 45 }}
          dpr={tier === "high" ? [1, 2] : 1}
          gl={{ antialias: tier === "high", powerPreference: "low-power" }}
        >
          <Scene selectedId={selectedId} onSelect={setSelectedId} onOpenMemoryBrain={openMemoryBrain} />
        </Canvas>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
          The 3D model council is disabled on this device (low power or reduced-motion) to save battery.
        </div>
      )}

      <div className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
        Real-time synaptic activity
      </div>

      <div className="pointer-events-none absolute bottom-8 left-8 text-[11px] tracking-wide text-slate-500">
        Local inference · Ollama · no cloud calls
      </div>

      {selected && (
        <div className="absolute right-8 top-1/2 w-[240px] -translate-y-1/2 rounded-xl border border-white/10 bg-[#090c16]/75 p-[18px] backdrop-blur-md">
          <button
            onClick={() => setSelectedId(null)}
            aria-label="Close"
            className="absolute right-3.5 top-3 text-slate-400 hover:text-white"
          >
            ✕
          </button>
          <div className="text-[16px] font-medium text-slate-100">{selected.tier}</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">{selected.model}</div>
          <div className="mt-2 text-[12px] leading-snug text-slate-400">{selected.role}</div>
          <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
            <span>Confidence</span>
            <span>{selected.confidence}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            {/* ponytail: confidence/status are illustrative, not live telemetry — wire to real per-tier metrics if this needs to reflect actual load */}
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${selected.confidence}%`, background: selected.color }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
            <span>Status</span>
            <span className="text-emerald-400">Active</span>
          </div>
        </div>
      )}
    </div>
  );
}
