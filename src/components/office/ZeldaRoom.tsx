// Zelda SNES-style top-down room with tiled floor and walls

export function ZeldaRoom() {
  // Room dimensions
  const ROOM_WIDTH = 800;
  const ROOM_HEIGHT = 600;
  const TILE_SIZE = 32;

  // Floor tile pattern (2 shades for checkerboard/wood effect)
  const floorTiles = [];
  for (let y = 0; y < Math.ceil(ROOM_HEIGHT / TILE_SIZE); y++) {
    for (let x = 0; x < Math.ceil(ROOM_WIDTH / TILE_SIZE); x++) {
      const isAlternate = (x + y) % 2 === 0;
      floorTiles.push({ x, y, isAlternate });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "#2d5016", // Zelda grass green background
        overflow: "hidden",
      }}
    >
      {/* Floor tiles */}
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          imageRendering: "pixelated",
        }}
      >
        <defs>
          {/* Floor tile pattern */}
          <pattern id="floor-tile-light" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <rect width="32" height="32" fill="#d4a574" />
            <rect x="1" y="1" width="30" height="30" fill="#e5c29f" />
            {/* Wood grain */}
            <line x1="4" y1="8" x2="28" y2="8" stroke="#c9a070" strokeWidth="1" opacity="0.3" />
            <line x1="4" y1="16" x2="28" y2="16" stroke="#c9a070" strokeWidth="1" opacity="0.3" />
            <line x1="4" y1="24" x2="28" y2="24" stroke="#c9a070" strokeWidth="1" opacity="0.3" />
          </pattern>
          
          <pattern id="floor-tile-dark" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <rect width="32" height="32" fill="#c9a070" />
            <rect x="1" y="1" width="30" height="30" fill="#d4a574" />
            {/* Wood grain */}
            <line x1="4" y1="8" x2="28" y2="8" stroke="#b89968" strokeWidth="1" opacity="0.3" />
            <line x1="4" y1="16" x2="28" y2="16" stroke="#b89968" strokeWidth="1" opacity="0.3" />
            <line x1="4" y1="24" x2="28" y2="24" stroke="#b89968" strokeWidth="1" opacity="0.3" />
          </pattern>

          {/* Wall brick pattern */}
          <pattern id="wall-brick" x="0" y="0" width="64" height="32" patternUnits="userSpaceOnUse">
            <rect width="64" height="32" fill="#6b5d5d" />
            {/* Bricks */}
            <rect x="0" y="0" width="30" height="14" fill="#8b7d7d" stroke="#4a3f3f" strokeWidth="1" />
            <rect x="32" y="0" width="30" height="14" fill="#8b7d7d" stroke="#4a3f3f" strokeWidth="1" />
            <rect x="0" y="16" width="30" height="14" fill="#7a6c6c" stroke="#4a3f3f" strokeWidth="1" />
            <rect x="32" y="16" width="30" height="14" fill="#7a6c6c" stroke="#4a3f3f" strokeWidth="1" />
            {/* Highlights */}
            <rect x="2" y="2" width="8" height="4" fill="#a08f8f" opacity="0.4" />
          </pattern>
        </defs>

        {/* Floor area - wood tiles */}
        <rect
          x="64"
          y="64"
          width={ROOM_WIDTH - 128}
          height={ROOM_HEIGHT - 128}
          fill="url(#floor-tile-light)"
        />
        
        {/* Checkerboard overlay for variation */}
        {floorTiles
          .filter((tile) => tile.x >= 2 && tile.x < 23 && tile.y >= 2 && tile.y < 17)
          .map((tile, i) => (
            <rect
              key={i}
              x={tile.x * TILE_SIZE}
              y={tile.y * TILE_SIZE}
              width={TILE_SIZE}
              height={TILE_SIZE}
              fill={tile.isAlternate ? "url(#floor-tile-light)" : "url(#floor-tile-dark)"}
            />
          ))}

        {/* Top wall */}
        <rect x="0" y="0" width={ROOM_WIDTH} height="64" fill="url(#wall-brick)" />
        {/* Top wall border */}
        <rect x="0" y="60" width={ROOM_WIDTH} height="4" fill="#4a3f3f" />
        <rect x="0" y="64" width={ROOM_WIDTH} height="8" fill="#5d5050" opacity="0.6" />

        {/* Bottom wall */}
        <rect
          x="0"
          y={ROOM_HEIGHT - 64}
          width={ROOM_WIDTH}
          height="64"
          fill="url(#wall-brick)"
        />
        <rect x="0" y={ROOM_HEIGHT - 68} width={ROOM_WIDTH} height="4" fill="#4a3f3f" />

        {/* Left wall */}
        <rect x="0" y="64" width="64" height={ROOM_HEIGHT - 128} fill="url(#wall-brick)" />
        <rect x="60" y="64" width="4" height={ROOM_HEIGHT - 128} fill="#4a3f3f" />
        <rect x="64" y="64" width="8" height={ROOM_HEIGHT - 128} fill="#5d5050" opacity="0.6" />

        {/* Right wall */}
        <rect
          x={ROOM_WIDTH - 64}
          y="64"
          width="64"
          height={ROOM_HEIGHT - 128}
          fill="url(#wall-brick)"
        />
        <rect
          x={ROOM_WIDTH - 68}
          y="64"
          width="4"
          height={ROOM_HEIGHT - 128}
          fill="#4a3f3f"
        />

        {/* Corners */}
        <rect x="0" y="0" width="64" height="64" fill="url(#wall-brick)" />
        <rect x={ROOM_WIDTH - 64} y="0" width="64" height="64" fill="url(#wall-brick)" />
        <rect x="0" y={ROOM_HEIGHT - 64} width="64" height="64" fill="url(#wall-brick)" />
        <rect
          x={ROOM_WIDTH - 64}
          y={ROOM_HEIGHT - 64}
          width="64"
          height="64"
          fill="url(#wall-brick)"
        />

        {/* Door at top (entrance) */}
        <rect x={ROOM_WIDTH / 2 - 48} y="0" width="96" height="64" fill="#5d4037" />
        <rect x={ROOM_WIDTH / 2 - 44} y="4" width="88" height="56" fill="#795548" />
        <rect x={ROOM_WIDTH / 2 - 40} y="8" width="80" height="48" fill="#8d6e63" />
        {/* Door frame highlight */}
        <rect x={ROOM_WIDTH / 2 - 48} y="60" width="96" height="4" fill="#4a3f3f" />
        {/* Door handle */}
        <circle cx={ROOM_WIDTH / 2 + 30} cy="32" r="3" fill="#d4af37" />

        {/* Decorative floor rug in center */}
        <g opacity="0.7">
          <rect
            x={ROOM_WIDTH / 2 - 80}
            y={ROOM_HEIGHT / 2 - 60}
            width="160"
            height="120"
            fill="#8b4513"
            opacity="0.3"
          />
          <rect
            x={ROOM_WIDTH / 2 - 76}
            y={ROOM_HEIGHT / 2 - 56}
            width="152"
            height="112"
            fill="#a0522d"
            opacity="0.5"
          />
          {/* Rug pattern */}
          <line
            x1={ROOM_WIDTH / 2 - 70}
            y1={ROOM_HEIGHT / 2}
            x2={ROOM_WIDTH / 2 + 70}
            y2={ROOM_HEIGHT / 2}
            stroke="#654321"
            strokeWidth="2"
            opacity="0.6"
          />
          <line
            x1={ROOM_WIDTH / 2}
            y1={ROOM_HEIGHT / 2 - 50}
            x2={ROOM_WIDTH / 2}
            y2={ROOM_HEIGHT / 2 + 50}
            stroke="#654321"
            strokeWidth="2"
            opacity="0.6"
          />
        </g>

        {/* Ambient shadows in corners */}
        <circle cx="80" cy="80" r="40" fill="#000" opacity="0.15" />
        <circle cx={ROOM_WIDTH - 80} cy="80" r="40" fill="#000" opacity="0.15" />
        <circle cx="80" cy={ROOM_HEIGHT - 80} r="40" fill="#000" opacity="0.15" />
        <circle
          cx={ROOM_WIDTH - 80}
          cy={ROOM_HEIGHT - 80}
          r="40"
          fill="#000"
          opacity="0.15"
        />
      </svg>

      {/* Animated ceiling lights effect (subtle) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,200,0.1) 0%, transparent 60%)",
          pointerEvents: "none",
          animation: "zelda-light-flicker 4s ease-in-out infinite",
        }}
      />
    </div>
  );
}
