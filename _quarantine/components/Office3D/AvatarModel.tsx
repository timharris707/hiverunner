'use client';

import { useGLTF } from '@react-three/drei';
import { Sphere } from '@react-three/drei';
import type { AgentConfig } from './agentsConfig';
import { useEffect, useState } from 'react';

interface AvatarModelProps {
  agent: AgentConfig;
  position: [number, number, number];
}

export default function AvatarModel({ agent, position }: AvatarModelProps) {
  const modelPath = `/models/${agent.id}.glb`;
  const [exists, setExists] = useState<boolean>(false);

  // Check if file exists before trying to load
  useEffect(() => {
    fetch(modelPath, { method: 'HEAD' })
      .then(res => setExists(res.ok))
      .catch(() => setExists(false));
  }, [modelPath]);

  // If model doesn't exist, return fallback sphere
  if (!exists) {
    return (
      <Sphere
        args={[0.3, 16, 16]}
        position={position}
        castShadow
      >
        <meshStandardMaterial
          color={agent.color}
          emissive={agent.color}
          emissiveIntensity={0.3}
        />
      </Sphere>
    );
  }

  // Load and display the GLB model
  const { scene } = useGLTF(modelPath);
  
  return (
    <primitive
      object={scene.clone()}
      position={position}
      scale={0.8} // Ready Player Me avatars are ~1.8m tall, scale to fit desk
      rotation={[0, Math.PI, 0]} // Face forward
      castShadow
      receiveShadow
    />
  );
}
