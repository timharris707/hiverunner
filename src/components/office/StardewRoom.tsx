// Stardew Valley style office room with warm wood aesthetic

export function StardewRoom() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#000", // Black background outside office
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 800 600"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        <defs>
          {/* Wood plank texture for walls */}
          <pattern id="woodPlankWall" patternUnits="userSpaceOnUse" width="80" height="16">
            <rect width="80" height="16" fill="#8B5A2B" />
            <rect width="80" height="14" fill="#A0522D" />
            <rect y="1" width="78" height="12" fill="#8B5A3B" />
            {/* Wood grain lines */}
            <line x1="0" y1="3" x2="80" y2="3" stroke="#7A4A1F" strokeWidth="0.5" opacity="0.6" />
            <line x1="0" y1="11" x2="80" y2="11" stroke="#7A4A1F" strokeWidth="0.5" opacity="0.6" />
            {/* Plank separators */}
            <rect x="38" y="0" width="4" height="16" fill="#6B4423" />
            {/* Knots and details */}
            <ellipse cx="20" cy="7" rx="2" ry="1.5" fill="#5A3820" opacity="0.7" />
            <ellipse cx="60" cy="8" rx="1.5" ry="1" fill="#5A3820" opacity="0.5" />
          </pattern>

          {/* Wood floor */}
          <pattern id="woodFloor" patternUnits="userSpaceOnUse" width="48" height="48">
            <rect width="48" height="48" fill="#9B7653" />
            {/* Planks running horizontally */}
            <rect y="0" width="48" height="15" fill="#8B6545" />
            <rect y="16" width="48" height="15" fill="#A0755D" />
            <rect y="32" width="48" height="15" fill="#8B6545" />
            {/* Plank borders */}
            <line x1="0" y1="15.5" x2="48" y2="15.5" stroke="#6B4D3B" strokeWidth="1" />
            <line x1="0" y1="31.5" x2="48" y2="31.5" stroke="#6B4D3B" strokeWidth="1" />
            {/* Wood grain */}
            <line x1="0" y1="7" x2="48" y2="7" stroke="#7A5A45" strokeWidth="0.3" opacity="0.5" />
            <line x1="0" y1="23" x2="48" y2="23" stroke="#7A5A45" strokeWidth="0.3" opacity="0.5" />
            <line x1="0" y1="39" x2="48" y2="39" stroke="#7A5A45" strokeWidth="0.3" opacity="0.5" />
          </pattern>

          {/* Green carpet */}
          <pattern id="greenCarpet" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="#4A7C59" />
            <circle cx="2" cy="2" r="0.3" fill="#3D6B4A" opacity="0.6" />
          </pattern>

          {/* Red carpet */}
          <pattern id="redCarpet" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="#A14F3D" />
            <circle cx="2" cy="2" r="0.3" fill="#8B3D2F" opacity="0.6" />
          </pattern>

          {/* Ambient warm light gradient */}
          <radialGradient id="warmLight" cx="50%" cy="30%">
            <stop offset="0%" stopColor="#FFD97D" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#FFB84D" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Main room floor - L-shape */}
        <rect x="40" y="80" width="720" height="480" fill="url(#woodFloor)" />

        {/* Back wall (top) with wood planks */}
        <g id="backWall">
          <rect x="40" y="40" width="720" height="60" fill="url(#woodPlankWall)" />
          <rect x="40" y="40" width="720" height="60" fill="rgba(0,0,0,0.1)" /> {/* Shadow overlay */}
        </g>

        {/* Left wall */}
        <g id="leftWall">
          <rect x="40" y="100" width="24" height="460" fill="url(#woodPlankWall)" transform="rotate(90 52 330)" />
          <rect x="40" y="100" width="24" height="460" fill="rgba(0,0,0,0.15)" transform="rotate(90 52 330)" />
        </g>

        {/* Right wall */}
        <g id="rightWall">
          <rect x="736" y="100" width="24" height="460" fill="url(#woodPlankWall)" transform="rotate(90 748 330)" />
          <rect x="736" y="100" width="24" height="460" fill="rgba(0,0,0,0.05)" transform="rotate(90 748 330)" />
        </g>

        {/* Wall decorations - ceiling lamps */}
        <g id="ceilingLamps">
          {/* Left lamp */}
          <g transform="translate(200, 60)">
            <rect x="-8" y="-4" width="16" height="8" fill="#3D2817" />
            <polygon points="-12,4 12,4 10,12 -10,12" fill="#E8C170" stroke="#B89850" strokeWidth="1" />
            <ellipse cx="0" cy="12" rx="10" ry="4" fill="#FFD97D" opacity="0.6">
              <animate attributeName="opacity" values="0.4;0.7;0.4" dur="3s" repeatCount="indefinite" />
            </ellipse>
            {/* Light glow */}
            <ellipse cx="0" cy="80" rx="100" ry="60" fill="url(#warmLight)" />
          </g>

          {/* Center lamp */}
          <g transform="translate(400, 60)">
            <rect x="-8" y="-4" width="16" height="8" fill="#3D2817" />
            <polygon points="-12,4 12,4 10,12 -10,12" fill="#E8C170" stroke="#B89850" strokeWidth="1" />
            <ellipse cx="0" cy="12" rx="10" ry="4" fill="#FFD97D" opacity="0.6">
              <animate attributeName="opacity" values="0.4;0.7;0.4" dur="3.5s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="0" cy="80" rx="100" ry="60" fill="url(#warmLight)" />
          </g>

          {/* Right lamp */}
          <g transform="translate(600, 60)">
            <rect x="-8" y="-4" width="16" height="8" fill="#3D2817" />
            <polygon points="-12,4 12,4 10,12 -10,12" fill="#E8C170" stroke="#B89850" strokeWidth="1" />
            <ellipse cx="0" cy="12" rx="10" ry="4" fill="#FFD97D" opacity="0.6">
              <animate attributeName="opacity" values="0.4;0.7;0.4" dur="4s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="0" cy="80" rx="100" ry="60" fill="url(#warmLight)" />
          </g>
        </g>

        {/* Floor carpets/rugs by zone */}
        {/* Top-left zone - green carpet */}
        <rect x="70" y="110" width="140" height="100" fill="url(#greenCarpet)" opacity="0.9" />
        
        {/* Top-center zone - red carpet */}
        <rect x="280" y="110" width="180" height="120" fill="url(#redCarpet)" opacity="0.9" />
        
        {/* Top-right zone - green carpet */}
        <rect x="540" y="110" width="140" height="100" fill="url(#greenCarpet)" opacity="0.9" />
        
        {/* Bottom-left zone - red carpet */}
        <rect x="70" y="340" width="140" height="140" fill="url(#redCarpet)" opacity="0.9" />
        
        {/* Right-center zone (infra) - green carpet */}
        <rect x="590" y="260" width="130" height="100" fill="url(#greenCarpet)" opacity="0.9" />
        
        {/* Bottom-right zone - red carpet */}
        <rect x="540" y="380" width="140" height="140" fill="url(#redCarpet)" opacity="0.9" />

        {/* Overall ambient lighting overlay */}
        <rect x="40" y="80" width="720" height="480" fill="url(#warmLight)" opacity="0.3" />
      </svg>
    </div>
  );
}
