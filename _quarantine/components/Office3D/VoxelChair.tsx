'use client';

import { Box } from '@react-three/drei';

interface VoxelChairProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}

export default function VoxelChair({ 
  position, 
  rotation = [0, 0, 0],
  color = '#4a5568'
}: VoxelChairProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* Seat */}
      <Box args={[0.5, 0.08, 0.5]} position={[0, 0.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.7} />
      </Box>

      {/* Backrest */}
      <Box args={[0.5, 0.5, 0.08]} position={[0, 0.65, -0.21]} castShadow>
        <meshStandardMaterial color={color} roughness={0.7} />
      </Box>

      {/* Legs (4) */}
      {/* Front left */}
      <Box args={[0.06, 0.4, 0.06]} position={[-0.18, 0.2, 0.18]} castShadow>
        <meshStandardMaterial color="#2d3748" />
      </Box>
      {/* Front right */}
      <Box args={[0.06, 0.4, 0.06]} position={[0.18, 0.2, 0.18]} castShadow>
        <meshStandardMaterial color="#2d3748" />
      </Box>
      {/* Back left */}
      <Box args={[0.06, 0.4, 0.06]} position={[-0.18, 0.2, -0.18]} castShadow>
        <meshStandardMaterial color="#2d3748" />
      </Box>
      {/* Back right */}
      <Box args={[0.06, 0.4, 0.06]} position={[0.18, 0.2, -0.18]} castShadow>
        <meshStandardMaterial color="#2d3748" />
      </Box>

      {/* Armrests */}
      <Box args={[0.08, 0.08, 0.3]} position={[-0.21, 0.48, -0.05]} castShadow>
        <meshStandardMaterial color="#374151" />
      </Box>
      <Box args={[0.08, 0.08, 0.3]} position={[0.21, 0.48, -0.05]} castShadow>
        <meshStandardMaterial color="#374151" />
      </Box>

      {/* Wheels (5 - office chair style) */}
      {[0, 72, 144, 216, 288].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * 0.22;
        const z = Math.sin(rad) * 0.22;
        return (
          <group key={i} position={[x, 0.05, z]}>
            {/* Wheel */}
            <Box args={[0.08, 0.05, 0.08]} castShadow>
              <meshStandardMaterial color="#1f2937" metalness={0.5} />
            </Box>
          </group>
        );
      })}

      {/* Central column */}
      <Box args={[0.08, 0.15, 0.08]} position={[0, 0.125, 0]} castShadow>
        <meshStandardMaterial color="#2d3748" metalness={0.4} />
      </Box>
    </group>
  );
}
