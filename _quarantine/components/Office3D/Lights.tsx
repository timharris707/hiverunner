'use client';

export default function Lights() {
  return (
    <>
      {/* Ambient light (general illumination) */}
      <ambientLight intensity={0.3} />

      {/* Main directional light (sun) */}
      <directionalLight
        position={[10, 10, 5]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      {/* Point lights above each desk area */}
      <pointLight position={[0, 4, 0]} intensity={0.5} color="#FFCC00" />
      <pointLight position={[-4, 4, -3]} intensity={0.3} color="#4CAF50" />
      <pointLight position={[4, 4, -3]} intensity={0.3} color="#E91E63" />
      <pointLight position={[-4, 4, 3]} intensity={0.3} color="#0077B5" />
      <pointLight position={[4, 4, 3]} intensity={0.3} color="#9C27B0" />
      <pointLight position={[0, 4, 6]} intensity={0.3} color="#607D8B" />

      {/* Hemisphere light for soft fill */}
      <hemisphereLight args={['#87CEEB', '#2d3748', 0.3]} />
    </>
  );
}
