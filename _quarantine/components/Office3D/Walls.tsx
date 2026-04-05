'use client';

export default function Walls() {
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 3, -10]} receiveShadow>
        <boxGeometry args={[30, 6, 0.2]} />
        <meshStandardMaterial color="#1a202c" roughness={0.9} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-15, 3, 0]} receiveShadow>
        <boxGeometry args={[0.2, 6, 20]} />
        <meshStandardMaterial color="#1a202c" roughness={0.9} />
      </mesh>

      {/* Right wall */}
      <mesh position={[15, 3, 0]} receiveShadow>
        <boxGeometry args={[0.2, 6, 20]} />
        <meshStandardMaterial color="#1a202c" roughness={0.9} />
      </mesh>
    </group>
  );
}
