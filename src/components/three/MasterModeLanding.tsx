import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Center,
  ContactShadows,
  Environment,
  Lightformer,
  MeshReflectorMaterial,
  OrbitControls,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface ModelPanel {
  id: string;
  model: string;
  tier: string;
  role: string;
  color: string;
}

// These are the ONLY models this app actually runs — every tier is served locally via
// Ollama (see backend/app/config.py). There is no ChatGPT / Claude / Gemini / Mixtral /
// Falcon / Stable Diffusion / DALL·E here, so the boardroom seats exactly four status
// panels, one per real inference tier:
//   gpt-oss:latest    → AGENT_MODEL_NAME / LLM_MODEL_NAME (intent router + domain agents)
//   llama3.1:8b       → SERVICE_MODEL_NAME / SUMMARIZER_MODEL_NAME (tool-calling + summaries)
//   llama3.2:3b       → ROUTER_MODEL_NAME / GENERAL_MODEL_NAME / FAST_MODEL_NAME
//   nomic-embed-text  → EMBEDDING_MODEL_NAME (semantic router + RAG + answer cache)
const AI_MODELS: ModelPanel[] = [
  { id: "reasoning", model: "gpt-oss:latest", tier: "Reasoning", role: "Deep answers · intent routing", color: "#00c4bb" },
  { id: "service", model: "llama3.1:8b", tier: "Tool-Calling", role: "Actions · summaries", color: "#5446e5" },
  { id: "router", model: "llama3.2:3b", tier: "Routing", role: "Fast triage · general chat", color: "#2563eb" },
  { id: "embeddings", model: "nomic-embed-text", tier: "Embeddings", role: "Semantic search · RAG", color: "#d97706" },
];

const ASSET_BASE = import.meta.env.BASE_URL;
const MODEL_URLS = {
  table: `${ASSET_BASE}models/antique_round_table.glb`,
  room: `${ASSET_BASE}models/office.glb`,
} as const;

// Real photographic city skyline behind the boardroom glass. Panoramic night shot of
// Taipei by Li Chen LIN, CC BY 2.0 (Wikimedia Commons), downscaled to 4096px and stored
// locally at public/textures/skyline.jpg so nothing is fetched from a CDN at runtime.
const SKYLINE_URL = `${ASSET_BASE}textures/skyline.jpg`;

// Canvas-drawn "monitor" readout rather than drei <Text> — Troika's default font is
// fetched from fonts.gstatic.com, and this deployment blocks external asset CDNs (same
// reason the room uses procedural IBL instead of an HDR preset). Canvas 2D text renders
// with locally-installed system fonts, so nothing leaves the machine.
function createPanelTexture(panel: ModelPanel) {
  const scale = 2;
  const w = 720;
  const h = 460;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#0a0c11";
  ctx.fillRect(0, 0, w, h);

  // Faint top-down sheen so the panel reads as a glass screen, not a flat poster.
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, "rgba(255,255,255,0.06)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // Accent bar in the model's own color along the top edge
  ctx.fillStyle = panel.color;
  ctx.fillRect(0, 0, w, 6);

  const padX = 44;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "rgba(226,232,240,0.55)";
  ctx.font = "600 22px 'Inter', 'Helvetica Neue', system-ui, sans-serif";
  ctx.fillText(panel.tier.toUpperCase(), padX, 66);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 54px 'Inter', 'Helvetica Neue', system-ui, sans-serif";
  ctx.fillText(panel.model, padX, 146);

  ctx.fillStyle = panel.color;
  ctx.font = "600 27px 'Inter', 'Helvetica Neue', system-ui, sans-serif";
  ctx.fillText(panel.role, padX, 192);

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, 224);
  ctx.lineTo(w - padX, 224);
  ctx.stroke();

  ctx.fillStyle = "rgba(226,232,240,0.45)";
  ctx.font = "600 20px 'Inter', 'Helvetica Neue', system-ui, sans-serif";
  ctx.fillText("ACTIVITY", padX, h - 74);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(226,232,240,0.4)";
  ctx.font = "500 20px 'Inter', 'Helvetica Neue', system-ui, sans-serif";
  ctx.fillText("OLLAMA · LOCAL", w - padX, h - 30);
  ctx.textAlign = "left";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const PANEL_WIDTH = 1.1;
const PANEL_HEIGHT = (PANEL_WIDTH * 460) / 720;
const STAND_HEIGHT = 0.95;

// A slim standing monitor for each model tier, facing the table — the "sleek holographic
// status panel" a real enterprise product would use instead of a humanoid figure.
function StatusPanel({ panel, angle, radius }: { panel: ModelPanel; angle: number; radius: number }) {
  const group = useRef<THREE.Group>(null);
  const dot = useRef<THREE.Mesh>(null);
  const bar = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  const texture = useMemo(() => createPanelTexture(panel), [panel]);

  const trackWidth = PANEL_WIDTH * 0.5;
  // Translate the geometry so its own origin sits at the left edge — scaling `bar` on
  // its local X then grows the meter rightward from a fixed pin instead of from center.
  const barGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(trackWidth, 0.014);
    g.translate(trackWidth / 2, 0, 0);
    return g;
  }, [trackWidth]);

  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;

  useLayoutEffect(() => {
    // lookAt aligns local -Z at the target; the screen assembly below is rotated 180°
    // so its own -Z (its front face) ends up pointing at the table too.
    group.current?.lookAt(0, STAND_HEIGHT + PANEL_HEIGHT / 2, 0);
  }, []);

  useFrame(() => {
    const t = performance.now() / 1000;
    if (dot.current) {
      const mat = dot.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2 + seed));
    }
    if (bar.current) {
      // Two summed sines read as gentle, irregular "live load" rather than a metronome.
      const load =
        0.3 + 0.32 * (0.5 + 0.5 * Math.sin(t * 0.6 + seed)) + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.7 + seed * 2));
      bar.current.scale.x = Math.max(0.05, load);
    }
  });

  return (
    <group position={[x, 0, z]} ref={group}>
      <mesh position={[0, STAND_HEIGHT / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.06, STAND_HEIGHT, 16]} />
        <meshStandardMaterial color="#1b1f27" roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.015, 0]} receiveShadow>
        <cylinderGeometry args={[0.22, 0.25, 0.03, 24]} />
        <meshStandardMaterial color="#14171d" roughness={0.4} metalness={0.6} />
      </mesh>

      <group position={[0, STAND_HEIGHT + PANEL_HEIGHT / 2, 0]} rotation={[0, Math.PI, 0]}>
        {/* Soft additive halo bleeding past the bezel — a subtle holographic edge glow
            rather than a literal hologram. */}
        <mesh position={[0, 0, -0.012]}>
          <planeGeometry args={[PANEL_WIDTH * 1.22, PANEL_HEIGHT * 1.32]} />
          <meshBasicMaterial
            color={panel.color}
            transparent
            opacity={0.16}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* bezel */}
        <mesh position={[0, 0, -0.006]}>
          <planeGeometry args={[PANEL_WIDTH * 1.07, PANEL_HEIGHT * 1.1]} />
          <meshStandardMaterial color="#0b0d12" roughness={0.4} metalness={0.5} />
        </mesh>
        {/* screen */}
        <mesh>
          <planeGeometry args={[PANEL_WIDTH, PANEL_HEIGHT]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        {/* live status dot, pulsing independently per panel via `seed` */}
        <mesh ref={dot} position={[-PANEL_WIDTH / 2 + 0.07, -PANEL_HEIGHT / 2 + 0.07, 0.002]}>
          <circleGeometry args={[0.02, 20]} />
          <meshBasicMaterial color={panel.color} transparent opacity={0.85} toneMapped={false} />
        </mesh>
        {/* activity meter: static track + animated fill pinned to the left edge */}
        <mesh position={[0, -PANEL_HEIGHT / 2 + 0.055, 0.001]}>
          <planeGeometry args={[trackWidth, 0.014]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.1} toneMapped={false} />
        </mesh>
        <mesh ref={bar} geometry={barGeometry} position={[-trackWidth / 2, -PANEL_HEIGHT / 2 + 0.055, 0.002]}>
          <meshBasicMaterial color={panel.color} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function createWoodTextures() {
  const size = 512;
  const heightCanvas = document.createElement("canvas");
  heightCanvas.width = heightCanvas.height = size;
  const hctx = heightCanvas.getContext("2d")!;
  const heightImg = hctx.createImageData(size, size);

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d")!;
  const colorImg = cctx.createImageData(size, size);

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext("2d")!;
  const roughImg = rctx.createImageData(size, size);

  const cx = size / 2;
  const cy = size / 2;
  const baseH = 22;
  const baseS = 52;

  // Round conference tables are built from radial wedge planks (like pie slices), each
  // with its own straight grain running lengthwise (center-to-rim) and a visible seam
  // at the boundary — not a single tree-slice's concentric growth rings.
  const WEDGES = 16;
  const wedgeWidth = (Math.PI * 2) / WEDGES;
  const wedgeSeed = (i: number) => {
    const s = Math.sin(i * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) + Math.PI; // 0..2π

      const wedgeIndexF = angle / wedgeWidth;
      const wedgeIndex = Math.floor(wedgeIndexF);
      const localAngle = (wedgeIndexF - wedgeIndex - 0.5) * wedgeWidth; // centered, -half..+half
      const seed = wedgeSeed(wedgeIndex);

      // Grain streaks run lengthwise along the radius; arc-length coordinate keeps
      // streak spacing consistent whether near the hub or the rim.
      const arc = localAngle * dist;
      const grain = Math.sin(arc * 1.35 + seed * 12 + Math.sin(dist * 0.045 + seed * 6) * 1.4) * 0.5 + 0.5;
      const grainFine = Math.sin(arc * 4.1 + seed * 8) * 0.5 + 0.5;
      const longGrain = Math.sin(dist * 0.05 + seed * 4) * 0.5 + 0.5;
      const noise = Math.random() * 0.05;
      let v = Math.min(1, Math.max(0, grain * 0.5 + grainFine * 0.2 + longGrain * 0.15 + noise));

      // Darken seam line at each wedge boundary, like the glue-line between planks
      const distToSeam = wedgeWidth / 2 - Math.abs(localAngle);
      const seamMask = distToSeam < 0.03 ? Math.max(0.35, distToSeam / 0.03) : 1;
      v *= seamMask;

      const idx = (y * size + x) * 4;
      const g = Math.round(v * 255);
      heightImg.data[idx] = heightImg.data[idx + 1] = heightImg.data[idx + 2] = g;
      heightImg.data[idx + 3] = 255;

      // Per-plank hue/lightness jitter so adjacent wedges read as separate boards
      const l = Math.max(6, Math.min(46, 22 - v * 12 + (seed - 0.5) * 6)) * seamMask + (1 - seamMask) * 4;
      const [r, gc, b] = hslToRgb(baseH + (seed - 0.5) * 6, baseS, l);
      colorImg.data[idx] = r;
      colorImg.data[idx + 1] = gc;
      colorImg.data[idx + 2] = b;
      colorImg.data[idx + 3] = 255;

      const rough = Math.round((0.12 + v * 0.45) * 255);
      roughImg.data[idx] = roughImg.data[idx + 1] = roughImg.data[idx + 2] = rough;
      roughImg.data[idx + 3] = 255;
    }
  }
  hctx.putImageData(heightImg, 0, 0);
  cctx.putImageData(colorImg, 0, 0);
  rctx.putImageData(roughImg, 0, 0);

  // Derive a normal map from the height map via finite differences.
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext("2d")!;
  const normalImg = nctx.createImageData(size, size);
  const strength = 2.2;
  const heightAt = (x: number, y: number) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return heightImg.data[(yi * size + xi) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = heightAt(x - 1, y);
      const hr = heightAt(x + 1, y);
      const hu = heightAt(x, y - 1);
      const hd = heightAt(x, y + 1);
      const nx = (hl - hr) * strength;
      const ny = (hu - hd) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      normalImg.data[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      normalImg.data[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      normalImg.data[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      normalImg.data[idx + 3] = 255;
    }
  }
  nctx.putImageData(normalImg, 0, 0);

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  for (const t of [colorTex, roughTex, normalTex]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    // This is a single radial disc pattern matched to the table's round shape —
    // tiling it (repeat > 1) overlaps copies of the wedge seams into a cracked,
    // cross-hatched look instead of one continuous plank layout.
    t.repeat.set(1, 1);
    // Grazing-angle view of the tabletop otherwise aliases the ring pattern into
    // a moving Moiré interference pattern; anisotropic filtering fixes it.
    t.anisotropy = 16;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
  }
  return { colorTex, roughTex, normalTex };
}

function Table() {
  const { scene } = useGLTF(MODEL_URLS.table);
  const woodTextures = useMemo(() => createWoodTextures(), []);

  useEffect(() => {
    const material = new THREE.MeshPhysicalMaterial({
      map: woodTextures.colorTex,
      normalMap: woodTextures.normalTex,
      roughnessMap: woodTextures.roughTex,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      metalness: 0.05,
    });
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }, [scene, woodTextures]);

  return (
    <Center bottom>
      <primitive object={scene} scale={2.8} />
    </Center>
  );
}

function Room() {
  const { nodes } = useGLTF(MODEL_URLS.room);
  const keep = [
    "Minimalistic_Modern_Office_Structure_0",
    "Minimalistic_Modern_Office_Glass_0",
    "Minimalistic_Modern_Office_Background_0",
    "Minimalistic_Modern_Office_Plants_0",
    "Minimalistic_Modern_Office_Lights_0",
    "Minimalistic_Modern_Office_LightEmission_0",
    "Carpet_Carpet_0",
  ] as const;
  for (const name of keep) {
    const node = nodes[name] as THREE.Object3D | undefined;
    node?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      for (const m of Array.isArray(mat) ? mat : [mat]) m.side = THREE.DoubleSide;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }
  return (
    <Center bottom>
      <group position={[0, -0.05, 0]}>
        {keep.map((name) => {
          const node = nodes[name];
          return node ? <primitive key={name} object={node} /> : null;
        })}
      </group>
    </Center>
  );
}

function Floor() {
  return (
    <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[22, 64]} />
      <MeshReflectorMaterial
        blur={[320, 110]}
        resolution={1536}
        mixBlur={1}
        mixStrength={24}
        roughness={0.28}
        depthScale={1.35}
        minDepthThreshold={0.55}
        maxDepthThreshold={1.35}
        color="#07111f"
        metalness={0.42}
        mirror={0.38}
      />
    </mesh>
  );
}

function Windows() {
  const base = useTexture(SKYLINE_URL);

  // The panorama is ~2.15:1 — far wider than any single (tall) window pane. Rather than
  // squash the whole city onto each pane, slice it into left / center / right thirds and
  // hang one slice on each of the three back panes, so the skyline reads as one continuous
  // view wrapping around behind the room. A little vertical zoom (repeat.y < 1) crops the
  // empty foreground so the building line sits behind the table instead of below it.
  const [leftTex, centerTex, rightTex] = useMemo(() => {
    return [0, 1, 2].map((i) => {
      const t = base.clone();
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 16;
      t.repeat.set(1 / 3, 0.82);
      t.offset.set(i / 3, 0.12);
      t.needsUpdate = true;
      return t;
    });
  }, [base]);

  // Self-lit so the city glows through the glass regardless of room lighting; driving the
  // emissive channel with the same photo makes the bright windows bloom while the dark sky
  // stays dark. side=DoubleSide so the panes read from the orbiting camera either way.
  const pane = (tex: THREE.Texture) => (
    <meshStandardMaterial
      map={tex}
      emissive="#ffffff"
      emissiveMap={tex}
      emissiveIntensity={0.9}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  );

  return (
    <>
      {/* Center pane closes the gap the two angled side panes would otherwise leave —
          without it that gap reads as a stray black column breaking up the skyline. */}
      <mesh position={[0, 3.5, -4.9]}>
        <planeGeometry args={[6, 8]} />
        {pane(centerTex)}
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          {/* City backdrop through the glass — left slice on the left pane, right on the right */}
          <mesh position={[side * 6, 3.5, -4.7]} rotation={[0, side * -0.2, 0]}>
            <planeGeometry args={[9, 8]} />
            {pane(side < 0 ? leftTex : rightTex)}
          </mesh>
          {/* Thin transmissive glass pane in front, catching room light */}
          <mesh position={[side * 6, 3.5, -4.5]} rotation={[0, side * -0.2, 0]} receiveShadow>
            <planeGeometry args={[9, 8]} />
            <meshPhysicalMaterial
              color="#dbeafe"
              transmission={0.95}
              thickness={0.4}
              ior={1.5}
              roughness={0.15}
              metalness={0}
              clearcoat={0.4}
              clearcoatRoughness={0.25}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

const STRUCTURE_MATERIAL_PROPS = {
  color: "#11151c",
  roughness: 0.55,
  metalness: 0.35,
} as const;

function RoomStructure() {
  const columnCount = 8;
  const columnRadius = 14.5;
  const columnHeight = 8;
  const beamY = 8.15;

  return (
    <group>
      {/* Structural columns ringing the room, well beyond the camera's orbit so they read as backdrop, not clutter */}
      {Array.from({ length: columnCount }).map((_, i) => {
        const angle = (i / columnCount) * Math.PI * 2;
        const x = Math.cos(angle) * columnRadius;
        const z = Math.sin(angle) * columnRadius;
        return (
          <mesh key={i} position={[x, columnHeight / 2 - 0.06, z]} castShadow receiveShadow>
            <boxGeometry args={[0.6, columnHeight, 0.6]} />
            <meshStandardMaterial {...STRUCTURE_MATERIAL_PROPS} />
          </mesh>
        );
      })}
      {/* Ceiling beams crossing overhead, tying the columns together */}
      {[-12, -6, 0, 6, 12].map((z) => (
        <mesh key={z} position={[0, beamY, z]} castShadow receiveShadow>
          <boxGeometry args={[30, 0.45, 0.5]} />
          <meshStandardMaterial {...STRUCTURE_MATERIAL_PROPS} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig() {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 1.3, 0), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = Math.sin(t * 0.18) * 0.3;
    camera.position.y = 5.4 + Math.sin(t * 0.13) * 0.08;
    camera.position.z = 11.5 + Math.cos(t * 0.16) * 0.18;
    camera.lookAt(target);
  });

  return null;
}

function Scene() {
  const radius = 3.35;
  return (
    <>
      <CameraRig />
      {/* Warm boardroom-at-dusk grade: a warm charcoal backdrop and haze, tungsten
          interior lights, real photographic skyline through the glass. */}
      <color attach="background" args={["#0c0a12"]} />
      <fog attach="fog" args={["#1c1512", 17, 40]} />
      <ambientLight intensity={0.34} color="#ffe4c4" />
      <hemisphereLight args={["#ffd9a8", "#1a120c", 0.5]} />
      <directionalLight position={[5, 8, 4]} intensity={2.4} color="#ffdcb0" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0008} />
      <spotLight position={[0, 7, 1]} angle={0.38} penumbra={0.9} intensity={34} color="#ffe6c8" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[4.6, 2.2, 1.2]} color="#ffb066" intensity={4.5} distance={8} />
      <pointLight position={[-4.2, 2.1, 0.8]} color="#ffe9d0" intensity={2.6} distance={7} />

      {/* Procedural, locally-rendered IBL rig — soft dispersed warm fill, no external HDR fetch */}
      <Environment resolution={256}>
        <Lightformer intensity={2.2} rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]} scale={[15, 15, 1]} color="#ffe6c4" />
        <Lightformer intensity={1.6} rotation={[0, Math.PI / 2, 0]} position={[-8, 2, 0]} scale={[10, 5, 1]} color="#ffc48a" />
        <Lightformer intensity={1.7} rotation={[0, -Math.PI / 2, 0]} position={[8, 2, 0]} scale={[10, 5, 1]} color="#ffd69a" />
      </Environment>

      <Floor />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.42} scale={10} blur={2.5} far={7} color="#020617" />
      <Suspense fallback={null}>
        <Windows />
      </Suspense>
      <RoomStructure />
      <Suspense fallback={null}>
        <Room />
      </Suspense>
      <Suspense fallback={null}>
        <Table />
      </Suspense>
      {AI_MODELS.map((panel, i) => (
        // +45° offset keeps every panel off the camera's centerline, so none of the four
        // ever lines up directly on-axis and gets foreshortened to a sliver.
        <StatusPanel key={panel.id} panel={panel} angle={(i / AI_MODELS.length) * Math.PI * 2 + Math.PI / 4} radius={radius} />
      ))}

      <EffectComposer multisampling={4}>
        <N8AO aoRadius={2.8} distanceFalloff={0.75} intensity={1} quality="medium" />
        <Bloom luminanceThreshold={0.65} luminanceSmoothing={0.8} intensity={0.7} mipmapBlur />
        <ToneMapping />
        <Vignette eskil={false} offset={0.12} darkness={0.28} />
      </EffectComposer>

      <OrbitControls
        enablePan={false}
        enableRotate={false}
        minDistance={7}
        maxDistance={18}
      />
    </>
  );
}

useGLTF.preload(MODEL_URLS.table);
useGLTF.preload(MODEL_URLS.room);
useTexture.preload(SKYLINE_URL);

export function MasterModeLanding() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#020617] text-slate-200 font-sans">
      {/* 3D SCENE */}
      <Canvas shadows="soft" camera={{ position: [0, 5.4, 11.5], fov: 46 }} gl={{ toneMappingExposure: 1.22 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
