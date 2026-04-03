// Zelda SNES-style top-down furniture components

interface FurnitureProps {
  x: number;
  y: number;
  agentId?: string;
}

export function ZeldaDesk({ x, y, agentId }: FurnitureProps) {
  const colors: Record<string, string> = {
    main: "#ff6b35",
    academic: "#4ade80",
    studio: "#a855f7",
    linkedin: "#0a66c2",
    social: "#ec4899",
    infra: "#fb923c",
  };
  const accentColor = agentId ? colors[agentId] : "#8b4513";

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10),
      }}
    >
      <svg width="96" height="64" viewBox="0 0 96 64" xmlns="http://www.w3.org/2000/svg">
        {/* Desk surface */}
        <rect x="8" y="16" width="80" height="40" fill="#a0826d" />
        <rect x="10" y="18" width="76" height="36" fill="#c9a88a" />
        {/* Shadow/depth */}
        <rect x="8" y="52" width="80" height="4" fill="#8b6f47" />
        {/* Accent trim */}
        <rect x="8" y="16" width="80" height="3" fill={accentColor} opacity="0.6" />
        {/* Wood grain detail */}
        <line x1="12" y1="22" x2="84" y2="22" stroke="#b89968" strokeWidth="1" opacity="0.4" />
        <line x1="12" y1="48" x2="84" y2="48" stroke="#b89968" strokeWidth="1" opacity="0.4" />
        {/* Legs */}
        <rect x="12" y="56" width="8" height="8" fill="#8b6f47" />
        <rect x="76" y="56" width="8" height="8" fill="#8b6f47" />
      </svg>
    </div>
  );
}

export function ZeldaMonitor({ x, y, agentId }: FurnitureProps) {
  const colors: Record<string, string> = {
    main: "#ff6b35",
    academic: "#4ade80",
    studio: "#a855f7",
    linkedin: "#0a66c2",
    social: "#ec4899",
    infra: "#fb923c",
  };
  const screenColor = agentId ? colors[agentId] : "#4ade80";

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        {/* Monitor frame */}
        <rect x="8" y="8" width="32" height="24" fill="#2c3e50" />
        {/* Screen */}
        <rect x="10" y="10" width="28" height="20" fill={screenColor} opacity="0.8" />
        {/* Screen reflection */}
        <rect x="12" y="12" width="10" height="6" fill="#fff" opacity="0.3" />
        {/* Screen content lines */}
        <line x1="14" y1="16" x2="34" y2="16" stroke="#fff" strokeWidth="1" opacity="0.4" />
        <line x1="14" y1="20" x2="30" y2="20" stroke="#fff" strokeWidth="1" opacity="0.4" />
        <line x1="14" y1="24" x2="32" y2="24" stroke="#fff" strokeWidth="1" opacity="0.4" />
        {/* Stand */}
        <rect x="20" y="32" width="8" height="8" fill="#34495e" />
        <rect x="16" y="40" width="16" height="4" fill="#2c3e50" />
      </svg>
    </div>
  );
}

export function ZeldaChair({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10),
      }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        {/* Backrest */}
        <rect x="8" y="4" width="24" height="16" fill="#5d4e37" rx="2" />
        <rect x="10" y="6" width="20" height="12" fill="#7d6e57" rx="2" />
        {/* Seat */}
        <ellipse cx="20" cy="24" rx="14" ry="10" fill="#5d4e37" />
        <ellipse cx="20" cy="22" rx="12" ry="8" fill="#7d6e57" />
        {/* Legs */}
        <rect x="10" y="28" width="4" height="8" fill="#4a3c28" />
        <rect x="26" y="28" width="4" height="8" fill="#4a3c28" />
      </svg>
    </div>
  );
}

export function ZeldaPlant({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="32" height="48" viewBox="0 0 32 48" xmlns="http://www.w3.org/2000/svg">
        {/* Pot */}
        <rect x="8" y="32" width="16" height="12" fill="#a0522d" />
        <rect x="10" y="34" width="12" height="8" fill="#cd853f" />
        {/* Soil */}
        <ellipse cx="16" cy="34" rx="6" ry="3" fill="#654321" />
        {/* Leaves */}
        <ellipse cx="12" cy="20" rx="8" ry="12" fill="#22c55e" />
        <ellipse cx="20" cy="20" rx="8" ry="12" fill="#16a34a" />
        <ellipse cx="16" cy="16" rx="7" ry="10" fill="#4ade80" />
        {/* Highlights */}
        <ellipse cx="14" cy="18" rx="3" ry="4" fill="#86efac" opacity="0.6" />
      </svg>
    </div>
  );
}

export function ZeldaCoffeeMachine({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="40" height="56" viewBox="0 0 40 56" xmlns="http://www.w3.org/2000/svg">
        {/* Base/counter */}
        <rect x="4" y="40" width="32" height="12" fill="#8b7355" />
        <rect x="6" y="42" width="28" height="8" fill="#a0826d" />
        {/* Machine body */}
        <rect x="8" y="16" width="24" height="24" fill="#4a4a4a" />
        <rect x="10" y="18" width="20" height="20" fill="#5a5a5a" />
        {/* Display/buttons */}
        <rect x="14" y="22" width="12" height="6" fill="#10b981" opacity="0.8" />
        <circle cx="16" cy="32" r="2" fill="#ef4444" />
        <circle cx="24" cy="32" r="2" fill="#22c55e" />
        {/* Spout */}
        <rect x="18" y="38" width="4" height="4" fill="#3a3a3a" />
        {/* Coffee mug */}
        <rect x="14" y="48" width="12" height="6" fill="#dc2626" />
        <rect x="15" y="49" width="10" height="4" fill="#ef4444" />
        {/* Steam */}
        <text x="18" y="14" fontSize="12" fill="#a0a0a0" opacity="0.5">~</text>
      </svg>
    </div>
  );
}

export function ZeldaServerRack({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="48" height="80" viewBox="0 0 48 80" xmlns="http://www.w3.org/2000/svg">
        {/* Rack frame */}
        <rect x="8" y="8" width="32" height="64" fill="#2c3e50" />
        <rect x="10" y="10" width="28" height="60" fill="#34495e" />
        {/* Server units */}
        <rect x="12" y="12" width="24" height="12" fill="#1e293b" />
        <rect x="12" y="26" width="24" height="12" fill="#1e293b" />
        <rect x="12" y="40" width="24" height="12" fill="#1e293b" />
        <rect x="12" y="54" width="24" height="12" fill="#1e293b" />
        {/* LED indicators */}
        <circle cx="16" cy="18" r="2" fill="#22c55e" />
        <circle cx="20" cy="18" r="2" fill="#22c55e" />
        <circle cx="24" cy="18" r="2" fill="#eab308" />
        <circle cx="16" cy="32" r="2" fill="#22c55e" />
        <circle cx="20" cy="32" r="2" fill="#22c55e" />
        <circle cx="24" cy="32" r="2" fill="#22c55e" />
        <circle cx="16" cy="46" r="2" fill="#22c55e" />
        <circle cx="20" cy="46" r="2" fill="#eab308" />
        <circle cx="24" cy="46" r="2" fill="#22c55e" />
        <circle cx="16" cy="60" r="2" fill="#22c55e" />
        <circle cx="20" cy="60" r="2" fill="#22c55e" />
        <circle cx="24" cy="60" r="2" fill="#22c55e" />
        {/* Vents */}
        <line x1="28" y1="14" x2="32" y2="14" stroke="#64748b" strokeWidth="1" />
        <line x1="28" y1="16" x2="32" y2="16" stroke="#64748b" strokeWidth="1" />
        <line x1="28" y1="18" x2="32" y2="18" stroke="#64748b" strokeWidth="1" />
      </svg>
    </div>
  );
}

export function ZeldaWhiteboard({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="64" height="56" viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg">
        {/* Frame */}
        <rect x="4" y="4" width="56" height="40" fill="#8b4513" />
        {/* Board surface */}
        <rect x="6" y="6" width="52" height="36" fill="#f0f0f0" />
        {/* Written content (scribbles) */}
        <path d="M 12 12 L 20 16 L 28 12 L 36 18" stroke="#d97706" strokeWidth="2" fill="none" />
        <circle cx="44" cy="14" r="4" stroke="#ef4444" strokeWidth="2" fill="none" />
        <line x1="12" y1="24" x2="48" y2="24" stroke="#000" strokeWidth="1" />
        <line x1="12" y1="28" x2="40" y2="28" stroke="#000" strokeWidth="1" />
        <line x1="12" y1="32" x2="44" y2="32" stroke="#000" strokeWidth="1" />
        {/* Marker tray */}
        <rect x="8" y="44" width="48" height="4" fill="#666" />
        <rect x="12" y="46" width="4" height="2" fill="#d97706" />
        <rect x="18" y="46" width="4" height="2" fill="#ef4444" />
        <rect x="24" y="46" width="4" height="2" fill="#22c55e" />
      </svg>
    </div>
  );
}

export function ZeldaCamera({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="48" height="64" viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
        {/* Tripod legs */}
        <line x1="24" y1="48" x2="12" y2="60" stroke="#2c3e50" strokeWidth="3" />
        <line x1="24" y1="48" x2="36" y2="60" stroke="#2c3e50" strokeWidth="3" />
        <line x1="24" y1="48" x2="24" y2="60" stroke="#2c3e50" strokeWidth="3" />
        {/* Center column */}
        <rect x="21" y="20" width="6" height="28" fill="#34495e" />
        {/* Camera body */}
        <rect x="12" y="8" width="24" height="16" fill="#2c3e50" />
        <rect x="14" y="10" width="20" height="12" fill="#34495e" />
        {/* Lens */}
        <circle cx="24" cy="16" r="8" fill="#1a1a1a" />
        <circle cx="24" cy="16" r="6" fill="#d97706" opacity="0.6" />
        <circle cx="24" cy="16" r="3" fill="#000" />
        {/* Details */}
        <circle cx="36" cy="12" r="2" fill="#ef4444" />
      </svg>
    </div>
  );
}

export function ZeldaBriefcase({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="48" height="40" viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg">
        {/* Case body */}
        <rect x="8" y="12" width="32" height="20" fill="#4a3c28" />
        <rect x="10" y="14" width="28" height="16" fill="#6b5740" />
        {/* Handle */}
        <path d="M 18 12 Q 24 4 30 12" stroke="#2c3e50" strokeWidth="3" fill="none" />
        {/* Lock */}
        <rect x="22" y="20" width="4" height="6" fill="#d4af37" />
        <circle cx="24" cy="23" r="1.5" fill="#8b7355" />
        {/* Edges */}
        <rect x="8" y="12" width="32" height="2" fill="#3a2f1f" />
        <rect x="8" y="30" width="32" height="2" fill="#3a2f1f" />
      </svg>
    </div>
  );
}

export function ZeldaSmartphone({ x, y }: FurnitureProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: Math.floor(y / 10) + 1,
      }}
    >
      <svg width="24" height="40" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg">
        {/* Phone body */}
        <rect x="4" y="4" width="16" height="32" fill="#1a1a1a" rx="2" />
        {/* Screen */}
        <rect x="5" y="6" width="14" height="26" fill="#ec4899" opacity="0.8" />
        {/* Screen content */}
        <circle cx="12" cy="12" r="2" fill="#fff" />
        <circle cx="12" cy="18" r="2" fill="#fff" />
        <circle cx="12" cy="24" r="2" fill="#fff" />
        {/* Home button */}
        <circle cx="12" cy="34" r="2" fill="#4a4a4a" />
      </svg>
    </div>
  );
}

export function ZeldaDoor({ x, y, orientation = "top" }: FurnitureProps & { orientation?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 1,
      }}
    >
      <svg
        width={orientation === "top" || orientation === "bottom" ? "64" : "32"}
        height={orientation === "top" || orientation === "bottom" ? "32" : "64"}
        viewBox={orientation === "top" || orientation === "bottom" ? "0 0 64 32" : "0 0 32 64"}
        xmlns="http://www.w3.org/2000/svg"
      >
        {orientation === "top" || orientation === "bottom" ? (
          <>
            <rect x="0" y="0" width="64" height="32" fill="#5d4037" />
            <rect x="4" y="4" width="56" height="24" fill="#795548" />
            <rect x="8" y="8" width="48" height="16" fill="#8d6e63" />
            <circle cx="52" cy="16" r="2" fill="#d4af37" />
          </>
        ) : (
          <>
            <rect x="0" y="0" width="32" height="64" fill="#5d4037" />
            <rect x="4" y="4" width="24" height="56" fill="#795548" />
            <rect x="8" y="8" width="16" height="48" fill="#8d6e63" />
            <circle cx="24" cy="32" r="2" fill="#d4af37" />
          </>
        )}
      </svg>
    </div>
  );
}
