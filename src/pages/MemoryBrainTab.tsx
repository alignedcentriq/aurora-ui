// Memory Brain — the app's whole "mind" as a 3D neuron graph (R3F/drei).
// Read-only view over the learning flywheel (GET /api/memory/graph): a root "mind"
// node fans out to lobes (Capabilities, Knowledge Base, Curated Answers, Router
// Intelligence, Apps & Forms, User Memory, Lessons Learned, Insight Bus, Feature
// Adoption, Project IQ DNA), each with neuron leaves you can click to read the
// actual remembered content — or jump straight to the real feature, where one exists.
//
// Layout starts from a deterministic radial seed (root -> lobes on a ring -> leaves
// jittered around their lobe) and then relaxes via a real d3-force-3d simulation
// (link + charge + center) driven one tick per frame — the seed keeps the settle
// from being a chaotic pop-in, the sim gives it organic drift. Cross-lobe links (a
// lesson that became a curated answer, a curated answer that feeds a capability, an
// insight signal about a specific project) are rendered as curved arcs that track
// live node positions on top of the same simulation.
// ponytail: no per-node collision force (forceCollide) — link distance + charge is
// enough spacing for a ~300-node graph; add if leaves visibly overlap.
// ponytail: no drag-to-reposition (OrbitControls covers exploring the graph);
// add per-node dragging only if someone actually asks to rearrange it.

import { useAuth } from "@/lib/auth-store";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, X, Brain } from "lucide-react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import { forceSimulation, forceLink, forceManyBody, forceCenter, type Simulation3D } from "d3-force-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type DeepLink =
  | { kind: "tab"; tab: string; sub?: string }
  | { kind: "external"; url: string };

interface GNode {
  id: string;
  label: string;
  type: "root" | "lobe" | "leaf";
  group: string;
  val: number;
  count?: number;
  detail: string;
  ts?: string | null;
  deep_link?: DeepLink | null;
}
interface GLink { source: string; target: string; }
interface GCrossLink { source: string; target: string; kind: string; }
interface GraphData {
  nodes: GNode[];
  links: GLink[];
  cross_links: GCrossLink[];
  stats: Record<string, number>;
}

interface PNode extends GNode {
  x: number;
  y: number;
  z: number;
}

const GROUP_COLOR: Record<string, string> = {
  root: "#ffd76a",
  capability: "#00c4bb",
  knowledge: "#8b5cf6",
  curated: "#22c55e",
  routing: "#0ea5e9",
  tools: "#f59e0b",
  usermem: "#ec4899",
  lessons: "#f43f5e",
  insight: "#a78bfa",
  fadopt: "#38bdf8",
  projectiq: "#34d399",
};
const GROUP_LABEL: Record<string, string> = {
  capability: "Capabilities",
  knowledge: "Knowledge Base",
  curated: "Curated Answers",
  routing: "Router Intelligence",
  tools: "Apps & Forms",
  usermem: "User Memory",
  lessons: "Lessons Learned",
  insight: "Insight Bus",
  fadopt: "Feature Adoption",
  projectiq: "Project IQ DNA",
};
// Cross-lobe link colors, one per relationship kind — dimmer than the parent-child
// lines so they read as "related" rather than "same cluster."
const CROSS_LINK_COLOR: Record<string, string> = {
  flywheel: "#fbbf24",   // a lesson that became a curated answer
  capability: "#a78bfa", // a leaf that feeds a Feature Adoption capability
  project: "#34d399",    // an insight signal about a specific Project IQ profile
};

function ageFactor(ts?: string | null): number {
  // 0 = brand new, 1 = 30+ days old. No ts (lobes/root) -> 0.5 (neutral, matches
  // the original fixed pulse look so those nodes don't change appearance).
  if (!ts) return 0.5;
  const ageDays = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  if (Number.isNaN(ageDays)) return 0.5;
  return Math.min(1, Math.max(0, ageDays / 30));
}

// Radial seed (root at center, lobes on a ring, leaves jittered in a shell around
// their parent lobe) fed into a d3-force-3d simulation that relaxes it into organic
// motion — the seed avoids a chaotic pop-in from d3's default spiral placement.
function layout(data: GraphData): {
  nodes: PNode[];
  links: { s: PNode; t: PNode }[];
  crossLinks: { s: PNode; t: PNode; kind: string }[];
  sim: Simulation3D<PNode>;
} {
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
    const pn: PNode = { ...n, x: pos[0], y: pos[1], z: pos[2] };
    byId.set(n.id, pn);
    return pn;
  });

  const links = data.links
    .map((l) => ({ s: byId.get(l.source)!, t: byId.get(l.target)! }))
    .filter((l) => l.s && l.t);

  const crossLinks = (data.cross_links || [])
    .map((l) => ({ s: byId.get(l.source)!, t: byId.get(l.target)!, kind: l.kind }))
    .filter((l) => l.s && l.t);

  // Root<->lobe edges keep the 3.4 ring distance; anything touching a leaf relaxes
  // to the mid-point of the old jitter shell (1.3-2.6). Link strength is forced to
  // 1 — d3's default halves it for high-degree nodes (root/lobes have many
  // neighbors), which was too weak to hold the tree shape against charge and let
  // the whole graph balloon past the camera's view. distanceMax bounds how far
  // the many-body repulsion reaches so ~300 nodes can't compound into runaway
  // spread the way an uncapped charge does.
  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink<PNode, { source: string; target: string }>(data.links)
        .id((d) => d.id)
        .distance((l) => (l.source.type === "leaf" || l.target.type === "leaf" ? 1.9 : 3.4))
        .strength(1),
    )
    .force("charge", forceManyBody().strength(-0.15).distanceMax(1.6))
    .force("center", forceCenter())
    .stop();

  return { nodes, links, crossLinks, sim };
}

function Node({
  node,
  dim,
  emphasized,
  isHovered,
  onHover,
  onSelect,
}: {
  node: PNode;
  dim: boolean;
  emphasized: boolean;
  isHovered: boolean;
  onHover: (n: PNode | null) => void;
  onSelect: (n: PNode) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const leafRef = useRef<THREE.Mesh>(null);
  const color = GROUP_COLOR[node.group] || "#8892b0";
  // root gets its own modest scale — it used to inherit a val=26 straight into a 0.09
  // multiplier, which made its halo (radius*1.7) bigger than the whole lobe ring and
  // engulfed the entire graph in one flat grey disc.
  const r = (node.val || 4) * (node.type === "leaf" ? 0.028 : node.type === "lobe" ? 0.05 : 0.045);
  const haloMult = node.type === "root" ? 1.25 : 1.7;
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  const isCluster = node.type !== "leaf";
  // Recency: newer leaves pulse faster and brighter; older ones settle. 0.5 (no ts)
  // reproduces the original fixed cadence exactly.
  const age = useMemo(() => ageFactor(node.ts), [node.ts]);
  const pulseDivisor = 400 + age * 600;
  const pulseAmp = 0.2 - age * 0.1;
  const recencyGlow = (0.5 - age) * 0.3;

  useFrame((_, delta) => {
    groupRef.current?.position.set(node.x, node.y, node.z);
    const pulse = (1 - pulseAmp) + pulseAmp * Math.sin(performance.now() / pulseDivisor + seed);
    if (isCluster) {
      haloRef.current?.scale.setScalar(pulse * (emphasized ? 1.1 : 1));
      if (wireRef.current) {
        wireRef.current.rotation.y += delta * 0.15;
        wireRef.current.rotation.x += delta * 0.06;
      }
    } else {
      leafRef.current?.scale.setScalar(pulse * (emphasized ? 1 : 0.9));
    }
  });

  const hoverHandlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(node); },
    onPointerOut: () => onHover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(node); },
  };

  return (
    <group ref={groupRef} position={[node.x, node.y, node.z]}>
      {isCluster ? (
        <>
          {/* soft glow blob — the fuzzy halo behind the wireframe core */}
          <mesh ref={haloRef} {...hoverHandlers}>
            <sphereGeometry args={[r * haloMult, 16, 16]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={dim ? 0.04 : emphasized ? 0.22 : 0.14}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {/* faceted geodesic wireframe core, slowly tumbling */}
          <mesh ref={wireRef}>
            <icosahedronGeometry args={[r, 1]} />
            <meshBasicMaterial
              color={color}
              wireframe
              transparent
              opacity={dim ? 0.15 : emphasized ? 1 : 0.55}
            />
          </mesh>
          {/* bright nucleus — only the root "mind" node gets a solid glowing core */}
          {node.type === "root" && (
            <mesh>
              <sphereGeometry args={[r * 0.45, 16, 16]} />
              <meshBasicMaterial color={color} transparent opacity={dim ? 0.15 : 0.9} />
            </mesh>
          )}
        </>
      ) : (
        <mesh ref={leafRef} {...hoverHandlers}>
          <sphereGeometry args={[r, 20, 20]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={dim ? 0.25 : Math.max(0.3, (emphasized ? 1.4 : 0.7) + recencyGlow)}
            transparent
            opacity={dim ? 0.18 : 1}
          />
        </mesh>
      )}
      {!dim && isHovered && (
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

function arcPoints(s: PNode, t: PNode): THREE.Vector3[] {
  const sv = new THREE.Vector3(s.x, s.y, s.z);
  const tv = new THREE.Vector3(t.x, t.y, t.z);
  // Pull the control point toward the origin so cross-lobe links arc through
  // the center instead of cutting a straight line across the sphere.
  const mid = sv.clone().add(tv).multiplyScalar(0.5).multiplyScalar(0.35);
  return new THREE.QuadraticBezierCurve3(sv, mid, tv).getPoints(20);
}

function CrossLinkArc({ s, t, kind, dim }: { s: PNode; t: PNode; kind: string; dim: boolean }) {
  const lineRef = useRef<Line2>(null);
  const initialPoints = useMemo(() => arcPoints(s, t), [s, t]);

  useFrame(() => {
    const pts = arcPoints(s, t);
    lineRef.current?.geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    lineRef.current?.computeLineDistances(); // dashed material needs fresh distances as the arc moves
  });

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      color={CROSS_LINK_COLOR[kind] || "#a78bfa"}
      transparent
      opacity={dim ? 0.04 : 0.35}
      lineWidth={1.5}
      dashed
      dashScale={4}
    />
  );
}

function LinkLine({ s, t, color, opacity }: { s: PNode; t: PNode; color: string; opacity: number }) {
  const lineRef = useRef<Line2>(null);
  const initialPoints = useMemo(
    () => [[s.x, s.y, s.z] as [number, number, number], [t.x, t.y, t.z] as [number, number, number]],
    [s, t],
  );

  useFrame(() => {
    lineRef.current?.geometry.setPositions([s.x, s.y, s.z, t.x, t.y, t.z]);
  });

  return (
    <Line ref={lineRef} points={initialPoints} color={color} transparent opacity={opacity} lineWidth={1} />
  );
}

function GraphScene({
  nodes,
  links,
  crossLinks,
  sim,
  hiddenGroups,
  query,
  onSelect,
  sparkleCount,
}: {
  nodes: PNode[];
  links: { s: PNode; t: PNode }[];
  crossLinks: { s: PNode; t: PNode; kind: string }[];
  sim: Simulation3D<PNode>;
  hiddenGroups: Set<string>;
  query: string;
  onSelect: (n: PNode) => void;
  sparkleCount: number;
}) {
  const [hover, setHover] = useState<PNode | null>(null);
  useFrame(() => {
    if (sim.alpha() > sim.alphaMin()) sim.tick();
  });
  const q = query.trim().toLowerCase();
  const matches = (n: PNode) => !q || n.label.toLowerCase().includes(q) || n.detail.toLowerCase().includes(q);

  const visibleNodes = useMemo(
    () => nodes.filter((n) => n.type === "root" || !hiddenGroups.has(n.group)),
    [nodes, hiddenGroups],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleLinks = useMemo(
    () => links.filter((l) => visibleIds.has(l.s.id) && visibleIds.has(l.t.id)),
    [links, visibleIds],
  );
  const visibleCrossLinks = useMemo(
    () => crossLinks.filter((l) => visibleIds.has(l.s.id) && visibleIds.has(l.t.id)),
    [crossLinks, visibleIds],
  );

  const near = useMemo(() => {
    const s = new Set<string>();
    if (hover) {
      s.add(hover.id);
      for (const { s: a, t: b } of visibleLinks) {
        if (a.id === hover.id) s.add(b.id);
        if (b.id === hover.id) s.add(a.id);
      }
    }
    return s;
  }, [hover, visibleLinks]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 4, 4]} intensity={40} color="#7dd8ff" />
      <Sparkles count={sparkleCount} scale={9} size={1.6} speed={0.3} color="#4fa9ff" opacity={0.5} />

      {visibleLinks.map(({ s, t }, i) => {
        const lit = hover ? near.has(s.id) && near.has(t.id) : true;
        const dimmed = q && !(matches(s) || matches(t));
        return (
          <LinkLine
            key={i}
            s={s}
            t={t}
            color={lit && !dimmed ? "#78b4ff" : "#3a4a68"}
            opacity={lit && !dimmed ? 0.45 : 0.06}
          />
        );
      })}

      {visibleCrossLinks.map((cl, i) => {
        const dimmed = Boolean(q) && !(matches(cl.s) || matches(cl.t));
        return <CrossLinkArc key={`x${i}`} s={cl.s} t={cl.t} kind={cl.kind} dim={dimmed} />;
      })}

      {visibleNodes.map((n) => (
        <Node
          key={n.id}
          node={n}
          dim={Boolean(q) && !matches(n)}
          emphasized={hover ? near.has(n.id) : true}
          isHovered={hover?.id === n.id}
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
  const navigate = useNavigate();
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
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());

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

  const { nodes, links, crossLinks, sim } = useMemo(
    () => (data ? layout(data) : { nodes: [], links: [], crossLinks: [], sim: forceSimulation<PNode>([], 3).stop() }),
    [data],
  );

  const toggleGroup = useCallback((group: string) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // Deep-link on click where a real destination exists (Feature Adoption / Project IQ /
  // Feedback Triage tabs, or an Apps & Forms external URL); otherwise fall back to the
  // read-only inspect panel, same as before this leaf had a destination.
  const handleSelect = useCallback((n: PNode) => {
    const dl = n.deep_link;
    if (dl?.kind === "external") {
      window.open(dl.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (dl?.kind === "tab") {
      navigate({ to: "/control-hub", search: { tab: dl.tab, sub: dl.sub } });
      return;
    }
    setSelected(n);
  }, [navigate]);

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
              Everything Centriq knows and has learned from chat — click a neuron to read it
              or jump to it, click a stat chip to show/hide that lobe.
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

      {/* stat chips — click to show/hide that lobe */}
      <div className="flex flex-wrap gap-2 border-b border-white/5 bg-[#060d1c] px-5 py-2">
        {[
          ["Capabilities", stats.capabilities, "capability"],
          ["Policies", stats.policies, "knowledge"],
          ["Curated", stats.curated_answers, "curated"],
          ["Router ex.", stats.router_examples, "routing"],
          ["Apps/Forms", stats.tools, "tools"],
          ["User facts", stats.user_memories, "usermem"],
          ["Lessons", stats.lessons_learned, "lessons"],
          ["Insights", stats.insight_signals, "insight"],
          ["Adoption", stats.feature_adoption, "fadopt"],
          ["Project IQ", stats.project_profiles, "projectiq"],
        ].map(([label, val, group]) => {
          const hidden = hiddenGroups.has(group as string);
          return (
            <Badge
              key={label as string}
              variant="secondary"
              role="button"
              tabIndex={0}
              aria-pressed={!hidden}
              onClick={() => toggleGroup(group as string)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleGroup(group as string);
                }
              }}
              className="group cursor-pointer gap-1.5 rounded-full border border-white/10 bg-white/5 text-[11px] text-slate-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--tone)_45%,transparent)] hover:shadow-[0_6px_16px_-8px_color-mix(in_oklab,var(--tone)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c4bb]"
              style={{ "--tone": GROUP_COLOR[group as string], opacity: hidden ? 0.35 : 1 } as React.CSSProperties}
              title={hidden ? "Hidden — click to show" : "Click to hide this lobe"}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[group as string], boxShadow: hidden ? "none" : `0 0 6px ${GROUP_COLOR[group as string]}` }} />
              {label} <span className="font-semibold text-white">{(val as number) ?? 0}</span>
            </Badge>
          );
        })}
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
              crossLinks={crossLinks}
              sim={sim}
              hiddenGroups={hiddenGroups}
              query={query}
              onSelect={handleSelect}
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
          Drag to orbit · scroll to zoom · click a neuron to inspect or jump to it
        </p>
      </div>
    </div>
  );
}
