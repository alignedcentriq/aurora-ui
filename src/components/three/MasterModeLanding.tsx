// Master Mode landing — a 3D round-table scene: the app's real LLM tiers seated
// around a glowing "mind" at the center. Bigger parameter count -> bigger avatar.
//
// This is a stylized/geometric sci-fi scene, not a photoreal render: literal
// rigged humanoid characters and PBR photo textures require authored 3D assets
// (.glb characters, texture maps) from a pipeline like Blender/Sketchfab — not
// something proceduralized in code, and not something fetched from the open
// web here (untrusted downloads are off-limits). Everything below is built
// from primitives + textures generated at runtime on a 2D <canvas> (wood grain,
// city-window skyline) instead — no external asset fetch, works offline.
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, Html, Lightformer, OrbitControls, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BrainCircuit } from "lucide-react";

interface ModelSeat {
  id: string;
  label: string;
  role: string;
  model: string;
  paramsB: number;
  color: string;
  style: "chrome" | "holo" | "iridescent" | "matte";
}

// The real tiers this app runs on ml01 (see backend/app/config.py). Tiers that
// share a model are folded into one seat — no fabricated vendors/models. Each
// gets a distinct material treatment so the roster reads as a varied cast, the
// way the reference image mixes robot / hologram / painted-figure looks.
const ROSTER: ModelSeat[] = [
  { id: "agent", label: "Reasoning Agent", role: "Agent tier · deep answers", model: "gpt-oss:latest", paramsB: 20, color: "#00e6d8", style: "chrome" },
  { id: "service", label: "Tool-Calling Agent", role: "Service + Summarizer", model: "llama3.1:8b", paramsB: 8, color: "#a78bfa", style: "iridescent" },
  { id: "router", label: "Router", role: "Router + General", model: "llama3.2:3b", paramsB: 3, color: "#38bdf8", style: "holo" },
  { id: "embed", label: "Embeddings", role: "Semantic search / RAG", model: "nomic-embed-text", paramsB: 0.137, color: "#fbbf24", style: "matte" },
];

// log-scaled so an 8B model doesn't dwarf a 3B one into invisibility, while a
// 20B model still clearly reads as "the big one".
function paramScale(paramsB: number) {
  return 0.68 + Math.log2(paramsB + 1) * 0.32;
}

// ── procedural textures (drawn on a 2D canvas, once, client-side only) ──────
function useWoodTexture() {
  return useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, "#3f2716");
    grad.addColorStop(0.5, "#6b4226");
    grad.addColorStop(1, "#33200f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 140; i++) {
      const y = Math.random() * size;
      ctx.strokeStyle = `rgba(15,8,3,${0.04 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 5);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }, []);
}

function useSkylineTexture() {
  return useMemo(() => {
    const w = 512, h = 768;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0a1330");
    sky.addColorStop(1, "#1c2b4a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = 20 + Math.random() * 40;
      const bh = 160 + Math.random() * 420;
      ctx.fillStyle = "#050914";
      ctx.fillRect(x, h - bh, bw, bh);
      for (let wy = h - bh + 10; wy < h - 10; wy += 14) {
        for (let wx = x + 4; wx < x + bw - 6; wx += 10) {
          if (Math.random() > 0.55) {
            ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,200,120,0.9)" : "rgba(150,210,255,0.85)";
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += bw + 4;
    }
    return new THREE.CanvasTexture(canvas);
  }, []);
}

function Brain() {
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (core.current) {
      core.current.rotation.y += dt * 0.25;
      const s = 1 + Math.sin(performance.now() / 900) * 0.05;
      core.current.scale.setScalar(s);
    }
    if (shell.current) shell.current.rotation.y -= dt * 0.08;
  });
  return (
    <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6}>
      <group position={[0, 1.55, 0]}>
        <mesh ref={core}>
          <icosahedronGeometry args={[0.85, 2]} />
          <meshStandardMaterial color="#7dd8ff" emissive="#2fc7ff" emissiveIntensity={2.4} roughness={0.25} metalness={0.4} wireframe />
        </mesh>
        <mesh ref={shell}>
          <icosahedronGeometry args={[1.08, 1]} />
          <meshBasicMaterial color="#0a2540" wireframe transparent opacity={0.35} />
        </mesh>
        <pointLight color="#4fd8ff" intensity={12} distance={7} />
        <Sparkles count={90} scale={2.6} size={2.5} speed={0.4} color="#8fe8ff" />
        <Html center position={[0, -1.55, 0]} distanceFactor={10} occlude={false}>
          <div className="whitespace-nowrap rounded-full border border-[#00c4bb]/40 bg-[#050b18]/80 px-3 py-1 text-[11px] font-semibold tracking-wide text-[#8fe8ff] backdrop-blur">
            Centriq Mind
          </div>
        </Html>
      </group>
    </Float>
  );
}

function Chair({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.62, 0.08, 0.6]} />
        <meshStandardMaterial color="#111827" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.75, -0.28]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[0.56, 0.7, 0.08]} />
        <meshStandardMaterial color="#111827" roughness={0.6} metalness={0.2} emissive={color} emissiveIntensity={0.08} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.42, 10]} />
        <meshStandardMaterial color="#1f2937" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.04, 5]} />
        <meshStandardMaterial color="#0b0f19" metalness={0.8} roughness={0.4} />
      </mesh>
    </group>
  );
}

// Per-seat material so the roster reads as a varied cast rather than four
// identical color-swapped blobs — chrome robot / translucent hologram /
// iridescent clearcoat / matte-small, echoing the reference's mixed cast.
function bodyMaterial(style: ModelSeat["style"], color: string) {
  switch (style) {
    case "chrome":
      return <meshStandardMaterial color="#e6edf5" emissive={color} emissiveIntensity={0.3} roughness={0.12} metalness={0.95} />;
    case "holo":
      return (
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.9}
          roughness={0.3}
          metalness={0.1}
          transparent
          opacity={0.55}
          wireframe={false}
        />
      );
    case "iridescent":
      return (
        <meshPhysicalMaterial
          color="#241b33"
          emissive={color}
          emissiveIntensity={0.2}
          roughness={0.2}
          metalness={0.4}
          clearcoat={1}
          clearcoatRoughness={0.15}
          iridescence={1}
          iridescenceIOR={1.4}
        />
      );
    case "matte":
    default:
      return <meshStandardMaterial color="#1c2333" emissive={color} emissiveIntensity={0.25} roughness={0.55} metalness={0.25} />;
  }
}

// A seated figure built from primitives: torso, neck, head, two bent legs,
// two resting arms. Not a rigged character — a legible "sitting robot" silhouette.
function Avatar({ seat, angle, radius }: { seat: ModelSeat; angle: number; radius: number }) {
  const scale = paramScale(seat.paramsB);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const bob = useRef<THREE.Group>(null);
  const visor = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame(() => {
    const t = performance.now() / 1000 + seed;
    if (bob.current) bob.current.position.y = 0.04 * Math.sin(t);
    if (visor.current) {
      const mat = visor.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + 0.6 * Math.sin(t * 2.2);
    }
  });

  const facing = Math.atan2(-x, -z);
  const body = bodyMaterial(seat.style, seat.color);

  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <Chair color={seat.color} />
      <group ref={bob} scale={scale}>
        {/* thighs (hip -> knee, nearly horizontal) + shins (knee -> floor) */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[0.15 * side, 0.48, -0.16]} rotation={[1.15, 0, 0]}>
              <capsuleGeometry args={[0.11, 0.34, 4, 8]} />
              {body}
            </mesh>
            <mesh position={[0.15 * side, 0.24, -0.32]} rotation={[0.18, 0, 0]}>
              <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
              {body}
            </mesh>
          </group>
        ))}
        {/* torso */}
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.27, 0.5, 6, 12]} />
          {body}
        </mesh>
        {/* arms, resting forward toward the table */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0.32 * side, 0.76, -0.26]} rotation={[0.55, 0, 0.15 * side]}>
            <capsuleGeometry args={[0.08, 0.46, 4, 8]} />
            {body}
          </mesh>
        ))}
        {/* neck + head */}
        <mesh position={[0, 1.32, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.14, 10]} />
          {body}
        </mesh>
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.23, 20, 20]} />
          <meshStandardMaterial color="#e7f4ff" roughness={0.25} metalness={0.1} />
        </mesh>
        {/* glowing visor band = the "face" */}
        <mesh ref={visor} position={[0, 1.55, 0.19]}>
          <boxGeometry args={[0.28, 0.05, 0.04]} />
          <meshStandardMaterial color={seat.color} emissive={seat.color} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        <pointLight color={seat.color} intensity={2.2} distance={2.4} position={[0, 1.1, 0.3]} />
      </group>
      <Html position={[0, 2.35 * scale + 0.3, 0]} center distanceFactor={9} occlude={false}>
        <div className="w-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0a1428]/90 px-2.5 py-1.5 text-center shadow-[0_0_18px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="text-[11px] font-bold leading-tight text-white">{seat.label}</div>
          <div className="mt-0.5 text-[9.5px] leading-tight text-slate-400">{seat.role}</div>
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: `color-mix(in oklab, ${seat.color} 20%, transparent)`, color: seat.color }}
          >
            {seat.model} · {seat.paramsB >= 1 ? `${seat.paramsB}B` : `${Math.round(seat.paramsB * 1000)}M`}
          </div>
        </div>
      </Html>
    </group>
  );
}

function Table() {
  const wood = useWoodTexture();
  return (
    <group>
      <mesh position={[0, 0.4, 0]} receiveShadow>
        <cylinderGeometry args={[3.6, 3.6, 0.14, 64]} />
        <meshPhysicalMaterial map={wood} roughness={0.28} metalness={0.1} clearcoat={0.7} clearcoatRoughness={0.2} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[3.3, 3.3, 0.32, 64]} />
        <meshStandardMaterial color="#0e1a33" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.471, 0]}>
        <ringGeometry args={[3.35, 3.6, 64]} />
        <meshBasicMaterial color="#00e6d8" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.5, 0.7, 0.5, 24]} />
        <meshStandardMaterial color="#0b0f19" metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Floor() {
  return (
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[16, 64]} />
      <meshStandardMaterial color="#050a16" roughness={0.15} metalness={0.6} />
    </mesh>
  );
}

// Floor-to-ceiling "windows" on either side showing a canvas-drawn night
// skyline — the office-at-night backdrop from the reference, without a photo.
function Windows() {
  const sky = useSkylineTexture();
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 9.5, 4, -2]} rotation={[0, side * -0.35, 0]}>
          <planeGeometry args={[9, 9]} />
          <meshBasicMaterial map={sky} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 4, -9.5]}>
        <planeGeometry args={[10, 9]} />
        <meshBasicMaterial map={sky} toneMapped={false} />
      </mesh>
    </>
  );
}

function Scene() {
  const radius = 5.2;
  return (
    <>
      <color attach="background" args={["#040711"]} />
      <fog attach="fog" args={["#040711", 14, 30]} />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={["#1a2b4a", "#020409", 0.35]} />
      <spotLight position={[0, 8, 0]} angle={0.5} penumbra={0.6} intensity={30} color="#bfe9ff" castShadow />

      <Environment resolution={256}>
        <Lightformer intensity={2} rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]} scale={[10, 10, 1]} color="#7dd8ff" />
        <Lightformer intensity={1.2} rotation={[0, Math.PI / 2, 0]} position={[-6, 1.5, 0]} scale={[10, 3, 1]} color="#38bdf8" />
        <Lightformer intensity={1.2} rotation={[0, -Math.PI / 2, 0]} position={[6, 1.5, 0]} scale={[10, 3, 1]} color="#00e6d8" />
      </Environment>

      <Windows />
      <Floor />
      <Table />
      <Brain />
      {ROSTER.map((seat, i) => (
        <Avatar key={seat.id} seat={seat} angle={(i / ROSTER.length) * Math.PI * 2 - Math.PI / 2} radius={radius} />
      ))}

      <EffectComposer>
        <Bloom luminanceThreshold={0.25} luminanceSmoothing={0.85} intensity={1.5} mipmapBlur />
        <Vignette eskil={false} offset={0.15} darkness={0.65} />
      </EffectComposer>

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={14}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.1}
        autoRotate
        autoRotateSpeed={0.6}
      />
    </>
  );
}

export function MasterModeLanding() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#040711]">
      <Canvas shadows camera={{ position: [0, 5.2, 9.5], fov: 45 }}>
        <Scene />
      </Canvas>

      <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0a1428]/70 px-3.5 py-2.5 backdrop-blur">
        <BrainCircuit className="h-5 w-5 text-[#00c4bb]" />
        <div>
          <div className="text-[13px] font-bold leading-tight text-white">Master Mode</div>
          <div className="text-[10.5px] leading-tight text-slate-400">Every model tier, live at the table</div>
        </div>
      </div>

      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-slate-500">
        Drag to orbit · scroll to zoom · size = parameter count
      </p>
    </div>
  );
}
