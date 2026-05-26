// Isometric furniture components for Habbo Hotel style office

interface FurnitureProps {
  isoX: number;
  isoY: number;
  agentId?: string;
}

const isoToScreen = (isoX: number, isoY: number) => {
  const screenX = (isoX - isoY) * 32;
  const screenY = (isoX + isoY) * 16;
  return { screenX, screenY };
};

// Isometric Desk
export function HabboDesk({ isoX, isoY, agentId }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  const isMainDesk = agentId === "main";
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) - 1,
      }}
    >
      <svg width={isMainDesk ? "96" : "72"} height={isMainDesk ? "64" : "48"} viewBox={isMainDesk ? "0 0 96 64" : "0 0 72 48"}>
        {/* Desk top - isometric */}
        <path
          d={isMainDesk ? "M48,8 L88,28 L48,48 L8,28 Z" : "M36,6 L66,21 L36,36 L6,21 Z"}
          fill="#8b5a3c"
          stroke="#000"
          strokeWidth="2"
        />
        <path
          d={isMainDesk ? "M48,8 L88,28 L48,48 L8,28 Z" : "M36,6 L66,21 L36,36 L6,21 Z"}
          fill="url(#woodGrain)"
          opacity="0.3"
        />
        
        {/* Desk front face */}
        <path
          d={isMainDesk ? "M8,28 L48,48 L48,56 L8,36 Z" : "M6,21 L36,36 L36,42 L6,27 Z"}
          fill="#6b4423"
          stroke="#000"
          strokeWidth="2"
        />
        
        {/* Desk right face */}
        <path
          d={isMainDesk ? "M48,48 L88,28 L88,36 L48,56 Z" : "M36,36 L66,21 L66,27 L36,42 Z"}
          fill="#7a4d2e"
          stroke="#000"
          strokeWidth="2"
        />
        
        <defs>
          <pattern id="woodGrain" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="#8b5a3c" />
            <line x1="0" y1="2" x2="4" y2="2" stroke="#6b4423" strokeWidth="0.5" />
          </pattern>
        </defs>
      </svg>
    </div>
  );
}

// Isometric Monitor
export function HabboMonitor({ isoX, isoY, agentId }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  const getScreenColor = () => {
    const colors: Record<string, string> = {
      main: "#ff6b35",
      academic: "#4ade80",
      studio: "#a855f7",
      linkedin: "#0077b5",
      social: "#ec4899",
      infra: "#22c55e",
    };
    return colors[agentId || ""] || "#4ade80";
  };
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 2,
      }}
    >
      <svg width="48" height="40" viewBox="0 0 48 40">
        {/* Monitor stand */}
        <rect x="20" y="32" width="8" height="4" fill="#333" stroke="#000" strokeWidth="1" />
        <rect x="16" y="36" width="16" height="2" fill="#555" stroke="#000" strokeWidth="1" />
        
        {/* Monitor back */}
        <path d="M10,8 L38,8 L38,32 L10,32 Z" fill="#1a1a1a" stroke="#000" strokeWidth="2" />
        
        {/* Screen */}
        <rect x="13" y="11" width="22" height="16" fill={getScreenColor()} stroke="#000" strokeWidth="1">
          <animate attributeName="opacity" values="1;0.8;1" dur="3s" repeatCount="indefinite" />
        </rect>
        
        {/* Screen glare */}
        <rect x="14" y="12" width="8" height="4" fill="#fff" opacity="0.4" />
        
        {/* Power button */}
        <circle cx="24" cy="30" r="1.5" fill="#4ade80">
          <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

// Server Rack (for Infra)
export function HabboServerRack({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="40" height="80" viewBox="0 0 40 80">
        {/* Server rack frame */}
        <rect x="4" y="4" width="32" height="72" fill="#2d3748" stroke="#000" strokeWidth="2" />
        
        {/* Server units */}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <rect
              x="6"
              y={8 + i * 12}
              width="28"
              height="10"
              fill="#1a1a1a"
              stroke="#000"
              strokeWidth="1"
            />
            {/* LED indicators */}
            <circle cx="10" cy={13 + i * 12} r="1.5" fill="#22c55e">
              <animate
                attributeName="opacity"
                values="1;0.3;1"
                dur={`${1 + i * 0.2}s`}
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="15" cy={13 + i * 12} r="1.5" fill="#eab308">
              <animate
                attributeName="opacity"
                values="1;0.3;1"
                dur={`${1.2 + i * 0.2}s`}
                repeatCount="indefinite"
              />
            </circle>
            {/* Vents */}
            <line x1="20" y1={10 + i * 12} x2="32" y2={10 + i * 12} stroke="#555" strokeWidth="0.5" />
            <line x1="20" y1={12 + i * 12} x2="32" y2={12 + i * 12} stroke="#555" strokeWidth="0.5" />
            <line x1="20" y1={14 + i * 12} x2="32" y2={14 + i * 12} stroke="#555" strokeWidth="0.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

// Plant decoration
export function HabboPlant({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="32" height="48" viewBox="0 0 32 48">
        {/* Pot - isometric */}
        <path d="M8,36 L16,40 L24,36 L20,32 L12,32 Z" fill="#8b4513" stroke="#000" strokeWidth="1.5" />
        <ellipse cx="16" cy="32" rx="8" ry="4" fill="#a0522d" stroke="#000" strokeWidth="1" />
        
        {/* Plant leaves */}
        <ellipse cx="10" cy="24" rx="6" ry="8" fill="#22c55e" stroke="#000" strokeWidth="1">
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1,1; 1.05,0.95; 1,1"
            dur="3s"
            repeatCount="indefinite"
          />
        </ellipse>
        <ellipse cx="22" cy="24" rx="6" ry="8" fill="#22c55e" stroke="#000" strokeWidth="1">
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1,1; 0.95,1.05; 1,1"
            dur="3s"
            repeatCount="indefinite"
          />
        </ellipse>
        <ellipse cx="16" cy="18" rx="7" ry="10" fill="#4ade80" stroke="#000" strokeWidth="1" />
        
        {/* Highlights */}
        <ellipse cx="14" cy="16" rx="2" ry="3" fill="#86efac" opacity="0.6" />
      </svg>
    </div>
  );
}

// Coffee Machine
export function HabboCoffeeMachine({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="32" height="48" viewBox="0 0 32 48">
        {/* Machine body */}
        <rect x="8" y="16" width="16" height="24" fill="#dc2626" stroke="#000" strokeWidth="1.5" />
        <rect x="8" y="16" width="16" height="4" fill="#991b1b" stroke="#000" strokeWidth="1" />
        
        {/* Display */}
        <rect x="11" y="20" width="10" height="6" fill="#22c55e" stroke="#000" strokeWidth="1">
          <animate attributeName="fill" values="#22c55e;#15803d;#22c55e" dur="4s" repeatCount="indefinite" />
        </rect>
        
        {/* Coffee dispenser */}
        <rect x="14" y="32" width="4" height="4" fill="#333" stroke="#000" strokeWidth="1" />
        
        {/* Cup */}
        <path d="M12,38 L14,44 L18,44 L20,38 Z" fill="#fff" stroke="#000" strokeWidth="1" />
        <ellipse cx="16" cy="42" rx="3" ry="1.5" fill="#8b4513" />
        
        {/* Steam */}
        <text x="10" y="14" fontSize="8" opacity="0.6">~</text>
        <text x="18" y="12" fontSize="8" opacity="0.5">~</text>
      </svg>
    </div>
  );
}

// Whiteboard (for Academic)
export function HabboWhiteboard({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="64" height="56" viewBox="0 0 64 56">
        {/* Whiteboard frame */}
        <rect x="4" y="8" width="56" height="40" fill="#f8f8f8" stroke="#333" strokeWidth="2" />
        
        {/* Math formulas */}
        <text x="8" y="20" fontSize="8" fill="#4ade80" fontFamily="monospace">E=mc²</text>
        <text x="8" y="30" fontSize="6" fill="#0077b5" fontFamily="monospace">f(x)=∫dx</text>
        
        {/* Drawings */}
        <circle cx="45" cy="25" r="8" fill="none" stroke="#ec4899" strokeWidth="1.5" />
        <line x1="38" y1="35" x2="52" y2="35" stroke="#a855f7" strokeWidth="1.5" />
        
        {/* Stand */}
        <line x1="32" y1="48" x2="32" y2="52" stroke="#333" strokeWidth="3" />
      </svg>
    </div>
  );
}

// Camera (for Studio)
export function HabboCamera({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="48" height="56" viewBox="0 0 48 56">
        {/* Tripod */}
        <line x1="24" y1="40" x2="16" y2="52" stroke="#333" strokeWidth="2" />
        <line x1="24" y1="40" x2="32" y2="52" stroke="#333" strokeWidth="2" />
        <line x1="24" y1="40" x2="24" y2="52" stroke="#333" strokeWidth="2" />
        
        {/* Camera body */}
        <rect x="12" y="20" width="24" height="16" fill="#1a1a1a" stroke="#000" strokeWidth="1.5" />
        
        {/* Lens */}
        <circle cx="24" cy="28" r="8" fill="#333" stroke="#000" strokeWidth="1.5" />
        <circle cx="24" cy="28" r="6" fill="#555" />
        <circle cx="24" cy="28" r="4" fill="#0ea5e9">
          <animate attributeName="opacity" values="0.5;1;0.5" dur="3s" repeatCount="indefinite" />
        </circle>
        
        {/* Recording light */}
        <circle cx="34" cy="22" r="2" fill="#ef4444">
          <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

// Briefcase (for LinkedIn)
export function HabboBriefcase({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="32" height="24" viewBox="0 0 32 24">
        {/* Briefcase body - isometric */}
        <path d="M4,8 L28,8 L28,20 L4,20 Z" fill="#8b4513" stroke="#000" strokeWidth="1.5" />
        <path d="M4,8 L16,4 L28,8" fill="#6b3410" stroke="#000" strokeWidth="1.5" />
        
        {/* Handle */}
        <path d="M12,4 Q16,0 20,4" fill="none" stroke="#333" strokeWidth="2" />
        
        {/* Lock */}
        <circle cx="16" cy="14" r="2" fill="#ffd700" stroke="#000" strokeWidth="1" />
        <rect x="15" y="14" width="2" height="3" fill="#ffd700" stroke="#000" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

// Smartphone (for Social)
export function HabboSmartphone({ isoX, isoY }: FurnitureProps) {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(isoX + isoY) + 1,
      }}
    >
      <svg width="24" height="40" viewBox="0 0 24 40">
        {/* Phone body */}
        <rect x="4" y="2" width="16" height="36" rx="2" fill="#1a1a1a" stroke="#000" strokeWidth="1.5" />
        
        {/* Screen */}
        <rect x="6" y="6" width="12" height="24" fill="#ec4899" stroke="#000" strokeWidth="0.5">
          <animate attributeName="fill" values="#ec4899;#f472b6;#ec4899" dur="2s" repeatCount="indefinite" />
        </rect>
        
        {/* Notification icons */}
        <circle cx="9" cy="10" r="1" fill="#fff" />
        <circle cx="12" cy="10" r="1" fill="#fff" />
        <circle cx="15" cy="10" r="1" fill="#fff" />
        
        {/* Social media icons */}
        <text x="7" y="20" fontSize="6">📱</text>
        <text x="13" y="20" fontSize="6">💬</text>
        
        {/* Home button */}
        <circle cx="12" cy="34" r="2" fill="#333" stroke="#666" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
