// Memory Brain — the app's whole "mind" as a 3D neuron graph (R3F/drei).
// Read-only view over the learning flywheel (GET /api/memory/graph): a root "mind"
// node fans out to lobes (Capabilities, Knowledge Base, Curated Answers, Router
// Intelligence, Apps & Forms, User Memory, Lessons Learned), each with neuron leaves
// you can click to read the actual remembered content.
//
// Layout is a deterministic radial placement (root -> lobes on a ring -> leaves
// jittered around their lobe), not a physics simulation — this is a 200-node
// display graph, not a real force-directed layout problem, so a static layout is
// plenty and skips a per-frame n-body sim entirely.
// ponytail: no drag-to-reposition (OrbitControls covers exploring the graph);
// add per-node dragging only if someone actually asks to rearrange it.

import { useAuth } from "@/lib/auth-store";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, X, Brain } from "lucide-react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface GNode {
  id: string;
  label: string;
  type: "root" | "lobe" | "leaf";
  group: string;
  val: number;
  count?: number;
  detail: string;
}
interface GLink { source: string; target: string; }
interface GraphData { nodes: GNode[]; links: GLink[]; stats: Record<string, number>; }

interface PNode extends GNode {
  pos: [number, number, number];
}

const GROUP_COLOR: Record<string, string> = {
  root: "#e2f6ff",
  capability: "#00c4bb",
  knowledge: "#8b5cf6",
  curated: "#22c55e",
  routing: "#0ea5e9",
  tools: "#f59e0b",
  usermem: "#ec4899",
  lessons: "#f43f5e",
};
const GROUP_LABEL: Record<string, string> = {
  capability: "Capabilities",
  knowledge: "Knowledge Base",
  curated: "Curated Answers",
  routing: "Router Intelligence",
  tools: "Apps & Forms",
  usermem: "User Memory",
  lessons: "Lessons Learned",
};

// Deterministic radial layout: root at center, lobes on a ring, leaves jittered
// in a shell around their parent lobe. Built once per data load — no simulation.
function layout(data: GraphData): { nodes: PNode[]; links: { s: PNode; t: PNode }[] } {
  const byId = new Map<string, PNode>();
  const lobes = data.nodes.filter((n) => n.type === "lobe");
  const parentOfLeaf = new Map<string, string>();
  for (const l of data.links) {
    const a = data.nodes.find((n) => n.id === l.source);
    const b = data.nodes.find((n) => n.id === l.target);
    if (a?.type === "leaf" && b?.type === "lobe") parentOfLeaf.set(a.id, b.id);
    if (b?.type === "leaf" && a?.type === "lobe") parentOfLeaf.set(b.id, a.id);
  }

  const lobeRadius = 3.4;
  const lobePos = new Map<string, [number, number, number]>();
  lobes.forEach((lobe, i) => {
    const angle = (i / Math.max(lobes.length, 1)) * Math.PI * 2;
    lobePos.set(lobe.id, [Math.cos(angle) * lobeRadius, 0, Math.sin(angle) * lobeRadius]);
  });

  // seeded pseudo-random so layout doesn't reshuffle on re-render
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };

  const nodes: PNode[] = data.nodes.map((n) => {
    let pos: [number, number, number] = [0, 0, 0];
    if (n.type === "lobe") pos = lobePos.get(n.id) ?? [0, 0, 0];
    else if (n.type === "leaf") {
      const parent = parentOfLeaf.get(n.id);
      const base = parent ? lobePos.get(parent) ?? [0, 0, 0] : [0, 0, 0];
      const shellR = 1.3 + rand() * 1.3;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      pos = [
        base[0] + shellR * Math.sin(phi) * Math.cos(theta),
        base[1] + (rand() - 0.5) * 1.6,
        base[2] + shellR * Math.sin(phi) * Math.sin(theta),
      ];
    }
    const pn: PNode = { ...n, pos };
    byId.set(n.id, pn);
    return pn;
  });

  const links = data.links
    .map((l) => ({ s: byId.get(l.source)!, t: byId.get(l.target)! }))
    .filter((l) => l.s && l.t);

  return { nodes, links };
}

function Node({
  node,
  dim,
  emphasized,
  onHover,
  onSelect,
}: {
  node: PNode;
  dim: boolean;
  emphasized: boolean;
  onHover: (n: PNode | null) => void;
  onSelect: (n: PNode) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const color = GROUP_COLOR[node.group] || "#8892b0";
  const r = (node.val || 4) * (node.type === "leaf" ? 0.028 : node.type === "lobe" ? 0.05 : 0.09);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(() => {
    if (!ref.current) return;
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 700 + seed);
    ref.current.scale.setScalar(pulse * (emphasized ? 1 : 0.9));
  });

  const showLabel = node.type !== "leaf";

  return (
    <group position={node.pos}>
      <mesh
        ref={ref}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(node); }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(node); }}
      >
        <sphereGeometry args={[r, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={dim ? 0.25 : emphasized ? 1.4 : 0.7}
          transparent
          opacity={dim ? 0.18 : 1}
        />
      </mesh>
      {!dim && (showLabel || emphasized) && (
        <Html center distanceFactor={11} position={[0, r + 0.35, 0]} occlude={false}>
          <div
            className="pointer-events-none whitespace-nowrap rounded-md bg-black/60 px-1.5 py-0.5 text-center backdrop-blur"
            style={{ fontSize: node.type === "root" ? 12 : node.type === "lobe" ? 10.5 : 9, color: "#dbeafe" }}
          >
            {node.type === "lobe" && node.count != null ? `${node.label} · ${node.count}` : node.label}
          </div>
        </Html>
      )}
    </group>
  );
}

function GraphScene({
  nodes,
  links,
  query,
  onSelect,
  sparkleCount,
}: {
  nodes: PNode[];
  links: { s: PNode; t: PNode }[];
  query: string;
  onSelect: (n: PNode) => void;
  sparkleCount: number;
}) {
  const [hover, setHover] = useState<PNode | null>(null);
  const q = query.trim().toLowerCase();
  const matches = (n: PNode) => !q || n.label.toLowerCase().includes(q) || n.detail.toLowerCase().includes(q);

  const near = useMemo(() => {
    const s = new Set<string>();
    if (hover) {
      s.add(hover.id);
      for (const { s: a, t: b } of links) {
        if (a.id === hover.id) s.add(b.id);
        if (b.id === hover.id) s.add(a.id);
      }
    }
    return s;
  }, [hover, links]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 4, 4]} intensity={40} color="#7dd8ff" />
      <Sparkles count={sparkleCount} scale={9} size={1.6} speed={0.3} color="#4fa9ff" opacity={0.5} />

      {links.map(({ s, t }, i) => {
        const lit = hover ? near.has(s.id) && near.has(t.id) : true;
        const dimmed = q && !(matches(s) || matches(t));
        return (
          <Line
            key={i}
            points={[s.pos, t.pos]}
            color={lit && !dimmed ? "#78b4ff" : "#3a4a68"}
            transparent
            opacity={lit && !dimmed ? 0.45 : 0.06}
            lineWidth={1}
          />
        );
      })}

      {nodes.map((n) => (
        <Node
          key={n.id}
          node={n}
          dim={Boolean(q) && !matches(n)}
          emphasized={hover ? near.has(n.id) : true}
          onHover={setHover}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls enablePan minDistance={2} maxDistance={22} autoRotate autoRotateSpeed={0.35} />
    </>
  );
}

export function MemoryBrainTab() {
  const { user } = useAuth();
  const { tier, canRender3D } = useDeviceTier();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PNode | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memory/graph", { headers: authHeaders });
      const json = (await res.json()) as GraphData;
      setData(json && Array.isArray(json.nodes) ? json : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const { nodes, links } = useMemo(() => (data ? layout(data) : { nodes: [], links: [] }), [data]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-muted-foreground">No memory graph available.</div>;
  }

  const stats = data.stats || {};
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-[#050b18]">
      {/* header + search + stats */}
      <div className="flex flex-col gap-3 border-b border-white/10 bg-[#070f22] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Brain className="h-5 w-5 text-[#00c4bb]" />
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-white">Memory Brain</h2>
            <p className="text-[11px] text-slate-400">
              Everything Centriq knows and has learned from chat — click a neuron to read it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memory…"
              aria-label="Search memory"
              className="w-48 h-auto rounded-lg border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-[12px] text-white placeholder:text-slate-500 focus-visible:border-[#00c4bb]/50 focus-visible:ring-[#00c4bb]/30"
            />
          </div>
          <Button
            onClick={load}
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-lg border-white/10 bg-white/5 text-[12px] font-medium text-slate-200 hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* stat chips */}
      <div className="flex flex-wrap gap-2 border-b border-white/5 bg-[#060d1c] px-5 py-2">
        {[
          ["Capabilities", stats.capabilities, "capability"],
          ["Policies", stats.policies, "knowledge"],
          ["Curated", stats.curated_answers, "curated"],
          ["Router ex.", stats.router_examples, "routing"],
          ["Apps/Forms", stats.tools, "tools"],
          ["User facts", stats.user_memories, "usermem"],
          ["Lessons", stats.lessons_learned, "lessons"],
        ].map(([label, val, group]) => (
          <Badge
            key={label as string}
            variant="secondary"
            className="group gap-1.5 rounded-full border border-white/10 bg-white/5 text-[11px] text-slate-300 transition-transform duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--tone)_45%,transparent)] hover:shadow-[0_6px_16px_-8px_color-mix(in_oklab,var(--tone)_50%,transparent)]"
            style={{ "--tone": GROUP_COLOR[group as string] } as React.CSSProperties}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[group as string], boxShadow: `0 0 6px ${GROUP_COLOR[group as string]}` }} />
            {label} <span className="font-semibold text-white">{(val as number) ?? 0}</span>
          </Badge>
        ))}
      </div>

      {/* 3D graph + detail panel */}
      <div className="relative flex-1 overflow-hidden">
        {canRender3D ? (
          <Canvas
            camera={{ position: [0, 3.5, 9], fov: 50 }}
            dpr={tier === "high" ? [1, 2] : 1}
            gl={{ antialias: tier === "high", powerPreference: "low-power" }}
          >
            <GraphScene
              nodes={nodes}
              links={links}
              query={query}
              onSelect={setSelected}
              sparkleCount={tier === "high" ? 120 : 45}
            />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
            The 3D memory graph is disabled on this device (low power or reduced-motion) to save
            battery — search above still works.
          </div>
        )}

        {selected && (
          <div
            className="absolute right-3 top-3 bottom-3 w-[320px] overflow-y-auto rounded-xl bg-[#0a1428]/95 p-4 backdrop-blur motion-safe:animate-fade-in"
            style={{
              border: `1px solid color-mix(in oklab, ${GROUP_COLOR[selected.group]} 35%, transparent)`,
              boxShadow: `0 0 0 1px color-mix(in oklab, ${GROUP_COLOR[selected.group]} 12%, transparent), 0 20px 60px -20px color-mix(in oklab, ${GROUP_COLOR[selected.group]} 40%, black)`,
            }}
          >
            <button
              onClick={() => setSelected(null)}
              aria-label="Close detail panel"
              className="absolute right-3 top-3 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[selected.group], boxShadow: `0 0 8px ${GROUP_COLOR[selected.group]}` }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {GROUP_LABEL[selected.group] || selected.type}
              </span>
            </div>
            <h3 className="mb-3 pr-6 text-[15px] font-bold leading-snug text-white">{selected.label}</h3>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-300">{selected.detail}</p>
          </div>
        )}

        <p className="pointer-events-none absolute bottom-3 left-4 text-[10px] text-slate-500">
          Drag to orbit · scroll to zoom · click a neuron to inspect
        </p>
      </div>
    </div>
  );
}
