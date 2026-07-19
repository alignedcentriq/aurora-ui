import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

interface AmbientFieldSceneProps {
  particleCount: number;
  dpr: number;
  particleColor: string;
  wireColor: string;
  particleOpacity: number;
  wireOpacity: number;
  additive: boolean;
  speed: number;
}

function ParticleSwarm({
  particleCount,
  particleColor,
  wireColor,
  particleOpacity,
  wireOpacity,
  additive,
  speed,
}: Omit<AmbientFieldSceneProps, "dpr">) {
  const groupRef = useRef<THREE.Group>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 3.2 + Math.random() * 1.4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [particleCount]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.06 * speed;
    groupRef.current.rotation.x = Math.sin(Date.now() * 0.00005 * speed) * 0.15;
  });

  return (
    <group ref={groupRef}>
      <Points positions={positions} stride={3}>
        <PointMaterial
          transparent
          color={particleColor}
          size={0.045}
          sizeAttenuation
          depthWrite={false}
          opacity={particleOpacity}
          blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </Points>
      <mesh rotation={[0.4, 0.2, 0]}>
        <icosahedronGeometry args={[1.6, 1]} />
        <meshBasicMaterial color={wireColor} wireframe transparent opacity={wireOpacity} />
      </mesh>
    </group>
  );
}

export default function AmbientFieldScene({
  particleCount,
  dpr,
  particleColor,
  wireColor,
  particleOpacity,
  wireOpacity,
  additive,
  speed,
}: AmbientFieldSceneProps) {
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      camera={{ position: [0, 0, 6], fov: 45 }}
      style={{ pointerEvents: "none" }}
    >
      <ParticleSwarm
        particleCount={particleCount}
        particleColor={particleColor}
        wireColor={wireColor}
        particleOpacity={particleOpacity}
        wireOpacity={wireOpacity}
        additive={additive}
        speed={speed}
      />
    </Canvas>
  );
}
