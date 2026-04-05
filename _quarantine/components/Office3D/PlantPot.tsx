'use client';

import { Box, Cylinder } from '@react-three/drei';

interface PlantPotProps {
  position: [number, number, number];
  size?: 'small' | 'medium' | 'large';
}

export default function PlantPot({ position, size = 'medium' }: PlantPotProps) {
  const scale = size === 'small' ? 0.6 : size === 'large' ? 1.4 : 1;

  return (
    <group position={position} scale={scale}>
      {/* Pot */}
      <Cylinder
        args={[0.2, 0.15, 0.3, 8]}
        position={[0, 0.15, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#8b4513" roughness={0.9} />
      </Cylinder>

      {/* Dirt */}
      <Cylinder
        args={[0.19, 0.19, 0.05, 8]}
        position={[0, 0.3, 0]}
      >
        <meshStandardMaterial color="#654321" roughness={1} />
      </Cylinder>

      {/* Plant stem */}
      <Box args={[0.03, 0.3, 0.03]} position={[0, 0.55, 0]} castShadow>
        <meshStandardMaterial color="#2d5016" />
      </Box>

      {/* Leaves (voxel style) */}
      {/* Leaf 1 */}
      <Box args={[0.15, 0.02, 0.1]} position={[-0.08, 0.5, 0]} rotation={[0, 0, -0.3]} castShadow>
        <meshStandardMaterial color="#22c55e" />
      </Box>
      {/* Leaf 2 */}
      <Box args={[0.15, 0.02, 0.1]} position={[0.08, 0.55, 0]} rotation={[0, 0, 0.3]} castShadow>
        <meshStandardMaterial color="#16a34a" />
      </Box>
      {/* Leaf 3 */}
      <Box args={[0.1, 0.02, 0.15]} position={[0, 0.6, -0.08]} rotation={[0.3, 0, 0]} castShadow>
        <meshStandardMaterial color="#22c55e" />
      </Box>
      {/* Leaf 4 */}
      <Box args={[0.1, 0.02, 0.15]} position={[0, 0.65, 0.08]} rotation={[-0.3, 0, 0]} castShadow>
        <meshStandardMaterial color="#16a34a" />
      </Box>
      {/* Top leaves */}
      <Box args={[0.12, 0.02, 0.12]} position={[0, 0.7, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <meshStandardMaterial color="#22c55e" />
      </Box>
    </group>
  );
}
