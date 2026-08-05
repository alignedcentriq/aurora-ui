// The Master Mode cockpit as a genuine 3D scene — replaces the old hybrid of flat SVG
// ellipses + a postage-stamp 3D core canvas. Rings, orbit particles, the breathing core,
// the connector lines, and the floating tier badges are all real objects in one Three.js
// scene now; only the ring math (radius/color per tier) carries over from the old 2D
// layout. Depth (rings passing behind/in front of the core) comes for free from actual
// perspective + the core's occlusion — no more manually splitting each ellipse into a
// front and back half-arc.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Line2, LineSegments2 } from "three-stdlib";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface SceneTierNode {
  id: string;
  tier: string;
  model: string;
  color: string;
  icon: LucideIcon;
  ring: number;
  angle: number;
}

// World-space radii — bigger rings sit further out, same relative spacing the old
// rx values had (200/300/400 => roughly 1 : 1.5 : 2). A fourth, badge-less ring is
// purely decorative ("different speeds make the system feel alive").
const RING_DEFS = [
  { radius: 3.0, color: "#fbbf24", speed: 0.09 },
  { radius: 4.3, color: "#22d3ee", speed: -0.05 },
  { radius: 5.6, color: "#818cf8", speed: 0.065 },
  { radius: 6.8, color: "#64748b", speed: -0.035 },
] as const;

const CORE_RADIUS = 2.1;
const CAMERA_BASE = new THREE.Vector3(0, 4.2, 11);

function useTabVisible() {
  const visible = useRef(true);
  useEffect(() => {
    const onChange = () => {
      visible.current = !document.hidden;
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

// ── breathing core ──────────────────────────────────────────────────────────
function Core() {
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const tabVisible = useTabVisible();
  const baseRef = useRef<Float32Array | null>(null);

  // A ref-held singleton, not useMemo — the vertex-breathing effect below has to
  // mutate this geometry's position attribute every frame, and useMemo'd values
  // are meant to be treated as immutable outputs. Refs are the sanctioned escape
  // hatch for exactly this kind of imperative, per-frame Three.js mutation.
  const geometryRef = useRef<THREE.IcosahedronGeometry | null>(null);
  if (!geometryRef.current) geometryRef.current = new THREE.IcosahedronGeometry(CORE_RADIUS, 3);
  const geometry = geometryRef.current;

  useEffect(() => {
    baseRef.current = geometry.attributes.position.array.slice() as Float32Array;
    return () => geometry.dispose();
  }, [geometry]);

  useFrame((state, delta) => {
    if (!tabVisible.current) return;
    if (wire.current) {
      wire.current.rotation.y += delta * 0.1;
      wire.current.rotation.x += delta * 0.04;
    }
    const t = state.clock.elapsedTime;
    glow.current?.scale.setScalar(1 + Math.sin(t * 1.1) * 0.05);

    // Vertex "breathing" — nudge each vertex along its own radial direction by a
    // small, per-vertex-phased sine offset. Cheap approximation of simplex noise:
    // real simplex would cost a dependency for a wobble nobody will scrutinize
    // vertex-by-vertex.
    const base = baseRef.current;
    const attr = geometry.attributes.position;
    if (base) {
      for (let i = 0; i < attr.count; i++) {
        const ix = i * 3;
        const bx = base[ix];
        const by = base[ix + 1];
        const bz = base[ix + 2];
        const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        const jitter = 1 + 0.02 * Math.sin(t * 1.6 + i * 0.6);
        attr.setXYZ(
          i,
          (bx / len) * len * jitter,
          (by / len) * len * jitter,
          (bz / len) * len * jitter,
        );
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <>
      <mesh ref={wire} geometry={geometry}>
        <meshBasicMaterial color="#a5f3fc" wireframe transparent opacity={0.5} />
      </mesh>
      <mesh ref={glow} scale={0.88}>
        {/* icosahedron, not a lat-long sphere — no pole singularity, so additive
            blending reads as one even glow instead of piling up at the seam. */}
        <icosahedronGeometry args={[CORE_RADIUS, 2]} />
        <meshBasicMaterial
          color="#0e7490"
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

// ── revolving rings ─────────────────────────────────────────────────────────
function Ring({ radius, color, speed }: { radius: number; color: string; speed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const tabVisible = useTabVisible();
  useFrame((_, delta) => {
    if (!tabVisible.current) return;
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.012, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </mesh>
  );
}

// ── orbiting particles (instanced) ──────────────────────────────────────────
function OrbitParticles({
  radius,
  color,
  count,
  speed,
}: {
  radius: number;
  color: string;
  count: number;
  speed: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tabVisible = useTabVisible();
  const offsets = useMemo(
    () => Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2),
    [count],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!tabVisible.current || !ref.current) return;
    const t = state.clock.elapsedTime;
    offsets.forEach((offset, i) => {
      const angle = offset + t * speed;
      const wobble = Math.sin(t * 2 + i) * 0.08;
      dummy.position.set(Math.cos(angle) * radius, wobble, Math.sin(angle) * radius);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

// ── background starfield ────────────────────────────────────────────────────
function BackgroundField({ count = 500 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const tabVisible = useTabVisible();
  const { positions, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16 - 4;
      seeds[i] = Math.random() * Math.PI * 2;
    }
    return { positions, seeds };
  }, [count]);
  const baseY = useMemo(() => positions.filter((_, i) => i % 3 === 1), [positions]);

  useFrame((state) => {
    if (!tabVisible.current || !ref.current) return;
    const t = state.clock.elapsedTime;
    const attr = ref.current.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      attr.setY(i, baseY[i] + Math.sin(t * 0.3 + seeds[i]) * 0.2);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#94a3b8"
        size={0.035}
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// ── radar sweep ──────────────────────────────────────────────────────────────
function RadarSweep() {
  const ref = useRef<THREE.Mesh>(null);
  const tabVisible = useTabVisible();
  const geometry = useMemo(() => {
    const segments = 24;
    const spanDeg = 42;
    const outer = 7.2;
    const positions: number[] = [0, 0, 0];
    const colors: number[] = [0.13, 0.83, 0.93];
    for (let i = 0; i <= segments; i++) {
      const a = (-spanDeg / 2 + (spanDeg * i) / segments) * (Math.PI / 180);
      positions.push(Math.cos(a) * outer, 0, Math.sin(a) * outer);
      // Fade to black toward the wedge's edges — additive blending against the
      // dark backdrop makes that read as fading to transparent.
      const edgeFade = 1 - Math.abs(i / segments - 0.5) * 2;
      colors.push(0.13 * edgeFade, 0.83 * edgeFade, 0.93 * edgeFade);
    }
    const geo = new THREE.BufferGeometry();
    const idx: number[] = [];
    for (let i = 1; i < segments + 1; i++) idx.push(0, i, i + 1);
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (!tabVisible.current) return;
    if (ref.current) ref.current.rotation.y += delta * ((Math.PI * 2) / 10);
  });

  return (
    <mesh ref={ref} geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── energy pulse ─────────────────────────────────────────────────────────────
function EnergyPulse() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const tabVisible = useTabVisible();
  useFrame((state) => {
    if (!tabVisible.current || !ref.current || !mat.current) return;
    const cycle = 5;
    const phase = (state.clock.elapsedTime % cycle) / cycle;
    const scale = 1 + phase * 3.2;
    ref.current.scale.setScalar(scale);
    mat.current.opacity = (1 - phase) * 0.4;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[CORE_RADIUS * 0.98, CORE_RADIUS * 1.08, 48]} />
      <meshBasicMaterial
        ref={mat}
        color="#67e8f9"
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── camera micro-motion ──────────────────────────────────────────────────────
function CameraRig() {
  const { camera } = useThree();
  const tabVisible = useTabVisible();
  useFrame((state) => {
    if (!tabVisible.current) return;
    const t = state.clock.elapsedTime;
    camera.position.set(
      CAMERA_BASE.x + Math.sin(t * 0.15) * 0.18,
      CAMERA_BASE.y + Math.cos(t * 0.12) * 0.1,
      CAMERA_BASE.z,
    );
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// ── floating tier node + connector line ─────────────────────────────────────
function TierNode3D({
  node,
  isSelected,
  isDimmed,
  fullscreen,
  onSelect,
}: {
  node: SceneTierNode;
  isSelected: boolean;
  isDimmed: boolean;
  fullscreen: boolean;
  onSelect: () => void;
}) {
  const ring = RING_DEFS[node.ring];
  const rad = (node.angle * Math.PI) / 180;
  // Height rises with ring index — outer-ring nodes float visibly higher than inner
  // ones, so two badges on different rings don't project to the same screen spot
  // just because perspective compresses their depth difference (this camera looks
  // down at an angle, so pure XZ separation isn't enough to guarantee they stay apart).
  const y = 0.3 + node.ring * 0.55;
  const pos: [number, number, number] = [
    Math.cos(rad) * ring.radius,
    y,
    Math.sin(rad) * ring.radius,
  ];
  const lineRef = useRef<Line2 | LineSegments2>(null);
  const tabVisible = useTabVisible();
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (!tabVisible.current) return;
    const material = lineRef.current?.material;
    if (material) {
      material.opacity = 0.2 + (Math.sin(state.clock.elapsedTime * 1.2 + seed) * 0.5 + 0.5) * 0.6;
    }
  });

  return (
    <>
      <Line
        ref={lineRef}
        points={[[0, 0, 0], pos]}
        color={node.color}
        lineWidth={1}
        transparent
        opacity={0.4}
      />
      <Html position={pos} center transform={false} occlude={false} zIndexRange={[10, 0]}>
        <button
          onClick={onSelect}
          className="flex flex-col items-center transition-opacity duration-300"
          style={{ opacity: isDimmed ? 0.4 : 1, pointerEvents: "auto" }}
          aria-pressed={isSelected}
        >
          <span
            className={cn(
              "flex items-center justify-center rounded-full transition-all duration-300",
              fullscreen ? "h-12 w-12 sm:h-14 sm:w-14" : "h-10 w-10",
            )}
            style={{
              border: `2px solid ${node.color}`,
              background: isSelected ? node.color : "#080d18",
              color: isSelected ? "#080d18" : node.color,
              boxShadow: `0 0 ${isSelected ? 22 : 10}px ${node.color}80`,
            }}
          >
            <node.icon
              className={fullscreen ? "h-5 w-5 sm:h-6 sm:w-6" : "h-4 w-4"}
              strokeWidth={2.25}
            />
          </span>
          <span className="mt-1.5 whitespace-nowrap rounded-md border border-white/10 bg-[#080d18]/95 px-2 py-0.5 text-center">
            <span
              className={cn(
                "block font-semibold text-slate-100",
                fullscreen ? "text-xs sm:text-sm" : "text-[11px]",
              )}
            >
              {node.tier}
            </span>
            <span
              className={cn(
                "block uppercase tracking-wider text-slate-500",
                fullscreen ? "text-[10px]" : "text-[8px]",
              )}
            >
              {node.model}
            </span>
          </span>
        </button>
      </Html>
    </>
  );
}

export function MasterModeScene({
  tiers,
  selectedId,
  onSelect,
  fullscreen,
  tier,
  className,
}: {
  tiers: SceneTierNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  fullscreen: boolean;
  tier: "high" | "medium" | "low";
  className?: string;
}) {
  return (
    <Canvas
      className={className}
      camera={{ position: CAMERA_BASE.toArray(), fov: 42 }}
      dpr={tier === "high" ? [1, 2] : 1}
      gl={{ antialias: tier === "high", powerPreference: "low-power" }}
    >
      <CameraRig />
      <BackgroundField count={tier === "high" ? 500 : 220} />
      <RadarSweep />
      {RING_DEFS.map((r, i) => (
        <Ring key={i} radius={r.radius} color={r.color} speed={r.speed} />
      ))}
      {RING_DEFS.map((r, i) => (
        <OrbitParticles
          key={i}
          radius={r.radius}
          color={r.color}
          speed={r.speed * 4}
          count={i === 3 ? 6 : 9}
        />
      ))}
      <Core />
      <EnergyPulse />
      {tiers.map((node) => (
        <TierNode3D
          key={node.id}
          node={node}
          isSelected={selectedId === node.id}
          isDimmed={selectedId !== null && selectedId !== node.id}
          fullscreen={fullscreen}
          onSelect={() => onSelect(selectedId === node.id ? null : node.id)}
        />
      ))}
      {tier === "high" && (
        <EffectComposer>
          <Bloom luminanceThreshold={0.15} luminanceSmoothing={0.9} intensity={0.55} mipmapBlur />
        </EffectComposer>
      )}
    </Canvas>
  );
}
