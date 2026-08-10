import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHumanoidStore } from "@/lib/humanoid-store";

// Helper to interpolate between two values
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 1. Procedural generation of the outer blue humanoid bust particles
// Moved outside React component scope to keep the component pure during render
function generateOuterBustData() {
  const ringCount = 75;
  const particlesPerRing = 60;
  const count = ringCount * particlesPerRing;

  const targetPos = new Float32Array(count * 3);
  const initialPos = new Float32Array(count * 3);
  // Store original angle and target radius for animations
  const ringRadii = new Float32Array(count);
  const ringAngles = new Float32Array(count);

  let idx = 0;
  for (let i = 0; i < ringCount; i++) {
    // Y goes from -1.3 (bottom orb) to 1.1 (top of head)
    const y = -1.3 + (i / (ringCount - 1)) * 2.4;

    // Define radius based on height region
    let r: number;
    if (y < -0.5) {
      // Shoulders: flare out from neck (y = -0.5, r = 0.35) to shoulder base (y = -1.3, r = 1.4)
      const t = (-0.5 - y) / 0.8;
      r = 0.35 + 1.05 * t * t;
    } else if (y >= -0.5 && y < -0.1) {
      // Neck: thin cylinder
      r = 0.35;
    } else {
      // Head: ellipsoid centered at y = 0.45, with height radius 0.65 and width radius 0.52
      const t = (y - 0.45) / 0.65;
      if (Math.abs(t) <= 1.0) {
        r = 0.52 * Math.sqrt(Math.max(0, 1.0 - t * t));
      } else {
        r = 0.0;
      }
    }

    for (let j = 0; j < particlesPerRing; j++) {
      const angle = (j / particlesPerRing) * Math.PI * 2;
      ringRadii[idx / 3] = r;
      ringAngles[idx / 3] = angle;

      // Target position
      targetPos[idx] = r * Math.cos(angle);
      targetPos[idx + 1] = y;
      targetPos[idx + 2] = r * Math.sin(angle);

      // Initial position (dense in the bottom orb)
      // Add random scatter so they form a beautiful particle cloud in the orb
      initialPos[idx] = (Math.random() - 0.5) * 0.18;
      initialPos[idx + 1] = -1.3 + (Math.random() - 0.5) * 0.1;
      initialPos[idx + 2] = (Math.random() - 0.5) * 0.18;

      idx += 3;
    }
  }

  return { targetPos, initialPos, ringRadii, ringAngles, count };
}

// 2. Procedural generation of the inner orange brain particles
// Moved outside React component scope to keep the component pure during render
function generateBrainData() {
  const count = 900;
  const pos = new Float32Array(count * 3);

  // Center of head: [0, 0.45, 0]
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2.0 * Math.random() - 1.0);
    // Concentrate points closer to center for solid core feel
    const r = Math.pow(Math.random(), 1.6) * 0.25;

    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = 0.45 + r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  return { pos, count };
}

// 3. Neural synapses flowing energy particles
// Moved outside React component scope to keep the component pure during render
function generateFlowData(brainCount: number, brainPos: Float32Array) {
  const curveCount = 14;
  const pointsPerCurve = 35;
  const count = curveCount * pointsPerCurve;

  // Define control points for quadratic Bezier curves
  // P0: bottom orb [0, -1.3, 0]
  // P1: flared control points in middle [cos(a)*r, -0.4, sin(a)*r]
  // P2: target random points inside the brain core
  const curves = [];
  for (let c = 0; c < curveCount; c++) {
    const angle = (c / curveCount) * Math.PI * 2;
    const flareRadius = 0.4 + Math.random() * 0.2;
    const p0 = new THREE.Vector3(0, -1.3, 0);
    const p1 = new THREE.Vector3(
      Math.cos(angle) * flareRadius,
      -0.4,
      Math.sin(angle) * flareRadius,
    );

    // Select a random destination in the brain core
    const bIdx = Math.floor(Math.random() * brainCount);
    const p2 = new THREE.Vector3(
      brainPos[bIdx * 3],
      brainPos[bIdx * 3 + 1],
      brainPos[bIdx * 3 + 2],
    );

    curves.push({ p0, p1, p2 });
  }

  const tOffsets = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    tOffsets[i] = Math.random(); // random progress offset along the curve
  }

  return { curves, tOffsets, count };
}

export function HumanoidThreeScene() {
  const { humanoidState, setHumanoidState, audioLevel } = useHumanoidStore();

  const outerPointsRef = useRef<THREE.Points>(null);
  const brainPointsRef = useRef<THREE.Points>(null);
  const flowPointsRef = useRef<THREE.Points>(null);

  // Time accumulator for animations
  const timeRef = useRef(0);
  // Start-up transition progress (0 to 1)
  const progressRef = useRef(0);

  // Call generation functions in useMemo - since the functions are outside, React type checks pass!
  const outerBustData = useMemo(() => generateOuterBustData(), []);
  const brainData = useMemo(() => generateBrainData(), []);
  const flowData = useMemo(() => generateFlowData(brainData.count, brainData.pos), [brainData]);

  // Animation updates inside the R3F loop
  useFrame((_, delta) => {
    timeRef.current += delta;
    const time = timeRef.current;

    // Handle startup transition
    if (humanoidState === "starting") {
      progressRef.current += delta * 0.35; // completes in ~3 seconds
      if (progressRef.current >= 1.0) {
        progressRef.current = 1.0;
        setHumanoidState("idle");
      }
    } else if (
      humanoidState === "idle" ||
      humanoidState === "listening" ||
      humanoidState === "speaking"
    ) {
      progressRef.current = 1.0;
    }

    const progress = progressRef.current;

    // A. Update Outer Bust Particles
    if (outerPointsRef.current) {
      const geo = outerPointsRef.current.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

      for (let i = 0; i < outerBustData.count; i++) {
        const tx = outerBustData.targetPos[i * 3];
        const ty = outerBustData.targetPos[i * 3 + 1];
        const tz = outerBustData.targetPos[i * 3 + 2];

        const ix = outerBustData.initialPos[i * 3];
        const iy = outerBustData.initialPos[i * 3 + 1];
        const iz = outerBustData.initialPos[i * 3 + 2];

        // Delay the start of particles based on height Y so it rises sequentially
        // Bottom rises first, top head rises last
        const yPercent = (ty + 1.3) / 2.4; // 0 (bottom) to 1 (top)
        const localProgress = THREE.MathUtils.clamp(progress * 1.7 - yPercent * 0.7, 0.0, 1.0);

        // Add spiral helix rotation offset during startup
        const originalAngle = outerBustData.ringAngles[i];
        const radius = outerBustData.ringRadii[i];
        const spiralAngle = originalAngle + (1.0 - localProgress) * (ty + 1.3) * 3.5 + time * 0.15;

        let targetX = radius * Math.cos(spiralAngle);
        let targetY = ty;
        let targetZ = radius * Math.sin(spiralAngle);

        // Idle Breathing vertical oscillation
        if (localProgress > 0.9) {
          targetY += Math.sin(time * 2.2 + ty * 2.0) * 0.035;
        }

        // Apply audio ripple if in listening mode
        if (humanoidState === "listening" && audioLevel > 0.01) {
          const ripple = Math.sin(ty * 10.0 - time * 18.0) * audioLevel * 0.15;
          targetX += Math.cos(spiralAngle) * ripple;
          targetZ += Math.sin(spiralAngle) * ripple;
        }

        // Apply execute swirl (dissolve vortex back to bottom)
        if (humanoidState === "executing" || humanoidState === "thinking") {
          const swirlSpeed = time * 4.5;
          const vortexRadius = radius * (1.0 + Math.sin(time * 3.0 + ty) * 0.3);
          const vortexAngle = originalAngle + swirlSpeed * (ty + 1.5);
          targetX = vortexRadius * Math.cos(vortexAngle);
          targetZ = vortexRadius * Math.sin(vortexAngle);
          targetY = lerp(ty, -1.3, 0.45); // sink down towards bottom orb
        }

        // Interpolate position
        posAttr.setX(i, lerp(ix, targetX, localProgress));
        posAttr.setY(i, lerp(iy, targetY, localProgress));
        posAttr.setZ(i, lerp(iz, targetZ, localProgress));
      }
      posAttr.needsUpdate = true;
    }

    // B. Update Brain Particles (Orange Core)
    if (brainPointsRef.current) {
      const geo = brainPointsRef.current.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

      // Brain scales up during the later half of startup
      const brainProgress = THREE.MathUtils.clamp((progress - 0.35) / 0.65, 0.0, 1.0);
      // Pulsate scale when speaking
      let speakScale = 1.0;
      if (humanoidState === "speaking" && audioLevel > 0.01) {
        speakScale = 1.0 + Math.sin(time * 24.0) * 0.22 * audioLevel;
      }

      for (let i = 0; i < brainData.count; i++) {
        const ox = brainData.pos[i * 3];
        const oy = brainData.pos[i * 3 + 1];
        const oz = brainData.pos[i * 3 + 2];

        // Add subtle neural energy noise/jitter
        const noiseX = Math.sin(time * 9.0 + i) * 0.015;
        const noiseY = Math.cos(time * 8.0 + i) * 0.015;
        const noiseZ = Math.sin(time * 10.0 + i) * 0.015;

        // Apply scale & progress
        let bx = ox * brainProgress * speakScale + noiseX;
        let by = lerp(0.45, oy * speakScale, brainProgress) + noiseY;
        let bz = oz * brainProgress * speakScale + noiseZ;

        // Idle vertical floating
        if (brainProgress > 0.9) {
          by += Math.sin(time * 2.2 + oy * 2.0) * 0.035;
        }

        // Collapse core on execute vortex
        if (humanoidState === "executing" || humanoidState === "thinking") {
          bx *= 0.15;
          by = lerp(by, -1.3, 0.5);
          bz *= 0.15;
        }

        posAttr.setXYZ(i, bx, by, bz);
      }
      posAttr.needsUpdate = true;
    }

    // C. Update Flowing Neural Energy Particles (Synapses)
    if (flowPointsRef.current) {
      const geo = flowPointsRef.current.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

      const totalFlowPoints = flowData.count;
      const pointsPerCurve = 35;

      // Animate flow progress
      for (let i = 0; i < totalFlowPoints; i++) {
        const curveIdx = Math.floor(i / pointsPerCurve);
        const curve = flowData.curves[curveIdx];
        const initialT = flowData.tOffsets[i];

        // Flow upwards from P0 to P2
        const flowSpeed = humanoidState === "speaking" ? 0.45 : 0.25;
        const t = (initialT + time * flowSpeed) % 1.0;

        // Evaluate Quadratic Bezier Curve position
        const mt = 1.0 - t;
        const x = mt * mt * curve.p0.x + 2.0 * mt * t * curve.p1.x + t * t * curve.p2.x;
        const y = mt * mt * curve.p0.y + 2.0 * mt * t * curve.p1.y + t * t * curve.p2.y;
        const z = mt * mt * curve.p0.z + 2.0 * mt * t * curve.p1.z + t * t * curve.p2.z;

        // Hide flowing particles during execute dissolve
        if (humanoidState === "executing" || humanoidState === "thinking") {
          posAttr.setXYZ(i, 0, -10, 0); // throw below screen
        } else {
          posAttr.setXYZ(i, x, y * progress, z);
        }
      }
      posAttr.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* 1. Outer Blue Hologram Bust Points */}
      <points ref={outerPointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[outerBustData.targetPos, 3]}
            count={outerBustData.count}
            array={outerBustData.targetPos}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          transparent
          color="#38bdf8"
          size={0.024}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.8}
        />
      </points>

      {/* 2. Inner Orange Glowing Brain Core Points */}
      <points ref={brainPointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[brainData.pos, 3]}
            count={brainData.count}
            array={brainData.pos}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          transparent
          color="#f97316"
          size={0.028}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.9}
        />
      </points>

      {/* 3. Flowing Neural Energy Points (flowing synapses) */}
      <points ref={flowPointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(flowData.count * 3), 3]}
            count={flowData.count}
            array={new Float32Array(flowData.count * 3)}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          transparent
          color="#60a5fa"
          size={0.02}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.65}
        />
      </points>

      {/* 4. Bottom Base Orb (Steady Glowing Blue Sphere) */}
      <mesh position={[0, -1.3, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial
          color="#0ea5e9"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
