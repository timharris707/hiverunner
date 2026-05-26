// Habbo Hotel style isometric room with floor tiles and walls

export function HabboRoom() {
  // Generate isometric floor tiles
  const generateFloorTiles = () => {
    const tiles = [];
    const gridSize = 12; // 12x12 grid
    
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const isoX = x - y;
        const isoY = x + y;
        const screenX = isoX * 32;
        const screenY = isoY * 16;
        
        // Checkerboard pattern colors
        const isLight = (x + y) % 2 === 0;
        const baseColor = isLight ? "#e8d5c4" : "#d4bfaa";
        
        tiles.push(
          <g key={`tile-${x}-${y}`}>
            {/* Diamond tile */}
            <path
              d={`M${screenX},${screenY} L${screenX + 32},${screenY + 16} L${screenX},${screenY + 32} L${screenX - 32},${screenY + 16} Z`}
              fill={baseColor}
              stroke="#b8a898"
              strokeWidth="1"
              opacity="0.9"
            />
            {/* Tile border detail */}
            <path
              d={`M${screenX},${screenY} L${screenX + 32},${screenY + 16} L${screenX},${screenY + 32} L${screenX - 32},${screenY + 16} Z`}
              fill="url(#tileGradient)"
              opacity="0.3"
            />
          </g>
        );
      }
    }
    return tiles;
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      {/* Background - Habbo blue */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #87CEEB 0%, #4682B4 100%)",
        }}
      />

      {/* Room container */}
      <svg
        width="100%"
        height="100%"
        viewBox="-400 -200 800 600"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        <defs>
          {/* Tile gradient */}
          <linearGradient id="tileGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.1" />
          </linearGradient>
          
          {/* Wall pattern */}
          <pattern id="wallPaper" patternUnits="userSpaceOnUse" width="40" height="40">
            <rect width="40" height="40" fill="#f4a460" />
            <circle cx="10" cy="10" r="3" fill="#d2691e" opacity="0.3" />
            <circle cx="30" cy="10" r="3" fill="#d2691e" opacity="0.3" />
            <circle cx="10" cy="30" r="3" fill="#d2691e" opacity="0.3" />
            <circle cx="30" cy="30" r="3" fill="#d2691e" opacity="0.3" />
          </pattern>
          
          {/* Wood floor pattern */}
          <pattern id="woodFloor" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#d4bfaa" />
            <line x1="0" y1="4" x2="8" y2="4" stroke="#b8a898" strokeWidth="0.5" />
          </pattern>
        </defs>

        {/* Back walls - Habbo V-shape corner */}
        <g opacity="0.95">
          {/* Left wall */}
          <path
            d="M-350,-100 L0,-250 L0,100 L-350,250 Z"
            fill="url(#wallPaper)"
            stroke="#8b4513"
            strokeWidth="4"
          />
          <path
            d="M-350,-100 L0,-250 L0,100 L-350,250 Z"
            fill="rgba(0,0,0,0.1)"
          />
          
          {/* Right wall */}
          <path
            d="M350,-100 L0,-250 L0,100 L350,250 Z"
            fill="url(#wallPaper)"
            stroke="#8b4513"
            strokeWidth="4"
          />
          <path
            d="M350,-100 L0,-250 L0,100 L350,250 Z"
            fill="rgba(0,0,0,0.05)"
          />
          
          {/* Wall decorations - windows */}
          <g>
            {/* Left window */}
            <rect x="-280" y="-50" width="80" height="100" fill="#87CEEB" stroke="#333" strokeWidth="3" />
            <rect x="-278" y="-48" width="76" height="96" fill="rgba(255,255,255,0.4)" />
            <line x1="-240" y1="-50" x2="-240" y2="50" stroke="#333" strokeWidth="2" />
            <line x1="-280" y1="0" x2="-200" y2="0" stroke="#333" strokeWidth="2" />
            
            {/* Right window */}
            <rect x="200" y="-50" width="80" height="100" fill="#87CEEB" stroke="#333" strokeWidth="3" />
            <rect x="202" y="-48" width="76" height="96" fill="rgba(255,255,255,0.4)" />
            <line x1="240" y1="-50" x2="240" y2="50" stroke="#333" strokeWidth="2" />
            <line x1="200" y1="0" x2="280" y2="0" stroke="#333" strokeWidth="2" />
          </g>
          
          {/* Wall posters */}
          <g>
            {/* "Keep Coding" poster */}
            <rect x="-150" y="-20" width="60" height="40" fill="#fff" stroke="#000" strokeWidth="2" />
            <text x="-120" y="0" fontSize="8" textAnchor="middle" fontFamily="monospace" fill="#000">KEEP</text>
            <text x="-120" y="10" fontSize="8" textAnchor="middle" fontFamily="monospace" fill="#000">CODING</text>
            
            {/* Agent HQ Sign */}
            <rect x="90" y="-20" width="60" height="40" fill="#ff6b35" stroke="#000" strokeWidth="2" />
            <text x="120" y="0" fontSize="8" textAnchor="middle" fontFamily="monospace" fill="#fff">AGENT</text>
            <text x="120" y="10" fontSize="8" textAnchor="middle" fontFamily="monospace" fill="#fff">HQ</text>
          </g>
        </g>

        {/* Floor tiles */}
        <g transform="translate(0, 50)">
          {generateFloorTiles()}
        </g>

        {/* Floor shadow overlay for depth */}
        <ellipse
          cx="0"
          cy="300"
          rx="350"
          ry="80"
          fill="rgba(0,0,0,0.1)"
          style={{ filter: "blur(20px)" }}
        />
        
        {/* Ceiling light fixture */}
        <g transform="translate(0, -180)">
          <ellipse cx="0" cy="0" rx="40" ry="20" fill="#ffd700" opacity="0.3">
            <animate attributeName="opacity" values="0.3;0.5;0.3" dur="4s" repeatCount="indefinite" />
          </ellipse>
          <circle cx="0" cy="0" r="15" fill="#fff" stroke="#000" strokeWidth="2" />
          <circle cx="0" cy="0" r="12" fill="#ffffcc">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite" />
          </circle>
          <line x1="-20" y1="-10" x2="-20" y2="-40" stroke="#333" strokeWidth="2" />
          <line x1="20" y1="-10" x2="20" y2="-40" stroke="#333" strokeWidth="2" />
        </g>
      </svg>

      {/* Ambient light overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.2) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
