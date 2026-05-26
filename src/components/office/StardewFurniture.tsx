// Stardew Valley style furniture components with high detail

interface FurnitureProps {
  x: number;
  y: number;
  agentId?: string;
}

// Large wooden desk (top-down 3/4 view)
export function StardewDesk({ x, y, agentId }: FurnitureProps) {
  const color = agentId === "main" ? "#6B4423" : "#7A5A45";
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="32" cy="52" rx="40" ry="8" fill="rgba(0,0,0,0.2)" />
      
      {/* Desk top - 3/4 perspective */}
      <rect x="0" y="12" width="64" height="40" fill={color} stroke="#4A3218" strokeWidth="1.5" />
      <rect x="1" y="13" width="62" height="38" fill="#8B6545" opacity="0.3" />
      
      {/* Wood grain on desk top */}
      <line x1="0" y1="32" x2="64" y2="32" stroke="#5A3820" strokeWidth="0.5" opacity="0.4" />
      <line x1="20" y1="12" x2="20" y2="52" stroke="#5A3820" strokeWidth="0.3" opacity="0.3" />
      <line x1="44" y1="12" x2="44" y2="52" stroke="#5A3820" strokeWidth="0.3" opacity="0.3" />
      
      {/* Front edge (darker) */}
      <rect x="0" y="52" width="64" height="6" fill="#4A3218" />
      
      {/* Desk drawers on right */}
      <rect x="44" y="18" width="16" height="8" fill="#5A3820" stroke="#3A2010" strokeWidth="0.8" />
      <rect x="44" y="28" width="16" height="8" fill="#5A3820" stroke="#3A2010" strokeWidth="0.8" />
      
      {/* Drawer handles */}
      <rect x="50" y="21" width="4" height="2" fill="#B89850" stroke="#8B7340" strokeWidth="0.5" />
      <rect x="50" y="31" width="4" height="2" fill="#B89850" stroke="#8B7340" strokeWidth="0.5" />
      
      {/* Papers on desk */}
      <rect x="8" y="18" width="12" height="16" fill="#F4E8D0" stroke="#C4B8A0" strokeWidth="0.5" />
      <line x1="10" y1="22" x2="18" y2="22" stroke="#8B7355" strokeWidth="0.3" />
      <line x1="10" y1="25" x2="18" y2="25" stroke="#8B7355" strokeWidth="0.3" />
      
      {/* Coffee mug */}
      <ellipse cx="28" cy="40" rx="3" ry="2.5" fill="#8B4513" stroke="#5A2D0F" strokeWidth="0.5" />
      <ellipse cx="28" cy="38" rx="3" ry="2" fill="#4A2810" />
      <path d="M 31 38 Q 34 38 34 40 Q 34 42 31 42" fill="none" stroke="#5A2D0F" strokeWidth="0.5" />
      
      {/* Desk legs (visible from 3/4 view) */}
      <rect x="2" y="42" width="6" height="16" fill="#5A3820" stroke="#3A2010" strokeWidth="0.5" />
      <rect x="56" y="42" width="6" height="16" fill="#5A3820" stroke="#3A2010" strokeWidth="0.5" />
    </g>
  );
}

// CRT Monitor (retro style)
export function StardewMonitor({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Monitor shadow */}
      <ellipse cx="0" cy="36" rx="14" ry="4" fill="rgba(0,0,0,0.2)" />
      
      {/* Monitor stand */}
      <rect x="-4" y="28" width="8" height="8" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
      <rect x="-8" y="36" width="16" height="4" fill="#6A6A6A" stroke="#4A4A4A" strokeWidth="0.5" />
      
      {/* Monitor body (CRT - slightly curved) */}
      <rect x="-14" y="0" width="28" height="28" rx="2" fill="#9A9A9A" stroke="#5A5A5A" strokeWidth="1.5" />
      
      {/* Screen */}
      <rect x="-12" y="2" width="24" height="22" rx="1" fill="#1A3A2A" stroke="#0A1A0A" strokeWidth="0.8" />
      
      {/* Screen glow */}
      <rect x="-11" y="3" width="22" height="20" rx="1" fill="#2A5A4A" opacity="0.6">
        <animate attributeName="opacity" values="0.5;0.7;0.5" dur="4s" repeatCount="indefinite" />
      </rect>
      
      {/* Code/text on screen */}
      <line x1="-9" y1="6" x2="-2" y2="6" stroke="#4AFF88" strokeWidth="0.4" opacity="0.9" />
      <line x1="-9" y1="9" x2="4" y2="9" stroke="#4AFF88" strokeWidth="0.4" opacity="0.9" />
      <line x1="-9" y1="12" x2="-1" y2="12" stroke="#4AFF88" strokeWidth="0.4" opacity="0.8" />
      <line x1="-9" y1="15" x2="6" y2="15" stroke="#4AFF88" strokeWidth="0.4" opacity="0.9" />
      <line x1="-9" y1="18" x2="2" y2="18" stroke="#4AFF88" strokeWidth="0.4" opacity="0.7" />
      
      {/* Cursor blink */}
      <rect x="3" y="18" width="1" height="2" fill="#FFD700">
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
      </rect>
      
      {/* Screen reflection */}
      <path d="M -10 4 L -4 4 L -8 10 Z" fill="#FFFFFF" opacity="0.2" />
      
      {/* Power LED */}
      <circle cx="-10" cy="26" r="1" fill="#4AFF88">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

// Office chair (green, 3/4 view)
export function StardewChair({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="28" rx="12" ry="4" fill="rgba(0,0,0,0.15)" />
      
      {/* Chair base/wheels */}
      <ellipse cx="0" cy="24" rx="10" ry="3" fill="#3A3A3A" stroke="#2A2A2A" strokeWidth="0.5" />
      
      {/* Cylinder pole */}
      <rect x="-2" y="14" width="4" height="10" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="0.5" />
      
      {/* Seat cushion */}
      <ellipse cx="0" cy="14" rx="12" ry="6" fill="#4A7C59" stroke="#3A5A42" strokeWidth="1" />
      <ellipse cx="0" cy="12" rx="11" ry="5" fill="#5A9A6A" opacity="0.7" />
      
      {/* Seat padding detail */}
      <ellipse cx="-3" cy="13" rx="3" ry="2" fill="#6AAA7A" opacity="0.4" />
      <ellipse cx="3" cy="13" rx="3" ry="2" fill="#3A5A42" opacity="0.3" />
      
      {/* Backrest */}
      <rect x="-8" y="0" width="16" height="14" rx="2" fill="#4A7C59" stroke="#3A5A42" strokeWidth="1" />
      <rect x="-7" y="1" width="14" height="12" rx="1" fill="#5A9A6A" opacity="0.6" />
      
      {/* Backrest padding lines */}
      <line x1="-6" y1="4" x2="6" y2="4" stroke="#3A5A42" strokeWidth="0.5" opacity="0.5" />
      <line x1="-6" y1="9" x2="6" y2="9" stroke="#3A5A42" strokeWidth="0.5" opacity="0.5" />
    </g>
  );
}

// Server rack (for Infra)
export function StardewServerRack({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <rect x="2" y="68" width="28" height="4" fill="rgba(0,0,0,0.25)" opacity="0.6" />
      
      {/* Main rack frame */}
      <rect x="0" y="0" width="32" height="70" fill="#4A4A4A" stroke="#2A2A2A" strokeWidth="1.5" />
      <rect x="2" y="2" width="28" height="66" fill="#5A5A5A" />
      
      {/* Server units (6 units) */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i} transform={`translate(0, ${i * 11})`}>
          <rect x="3" y="3" width="26" height="9" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="0.5" />
          <rect x="4" y="4" width="24" height="7" fill="#3A3A3A" />
          
          {/* LED indicators */}
          <circle cx="6" cy="7.5" r="0.8" fill={i % 2 === 0 ? "#4AFF88" : "#FF4A4A"}>
            <animate attributeName="opacity" values="0.5;1;0.5" dur={`${1.5 + i * 0.2}s`} repeatCount="indefinite" />
          </circle>
          <circle cx="9" cy="7.5" r="0.8" fill="#FFD700">
            <animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
          </circle>
          
          {/* Ventilation slots */}
          <line x1="14" y1="5" x2="26" y2="5" stroke="#1A1A1A" strokeWidth="0.3" />
          <line x1="14" y1="7" x2="26" y2="7" stroke="#1A1A1A" strokeWidth="0.3" />
          <line x1="14" y1="9" x2="26" y2="9" stroke="#1A1A1A" strokeWidth="0.3" />
        </g>
      ))}
      
      {/* Cables hanging */}
      <path d="M 30 10 Q 35 15 32 25" fill="none" stroke="#FFD700" strokeWidth="1" />
      <path d="M 30 30 Q 36 35 33 45" fill="none" stroke="#4A9AFF" strokeWidth="1" />
    </g>
  );
}

// Potted plant (small palm or decorative)
export function StardewPlant({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="28" rx="8" ry="3" fill="rgba(0,0,0,0.2)" />
      
      {/* Pot (blue ceramic) */}
      <path d="M -8 20 L -6 28 L 6 28 L 8 20 Z" fill="#4A7AC4" stroke="#3A5A94" strokeWidth="1" />
      <ellipse cx="0" cy="20" rx="8" ry="3" fill="#5A8AD4" stroke="#3A5A94" strokeWidth="1" />
      
      {/* Pot rim highlight */}
      <ellipse cx="0" cy="19" rx="7" ry="2" fill="#7AAAFF" opacity="0.4" />
      
      {/* Soil */}
      <ellipse cx="0" cy="20" rx="6" ry="2" fill="#4A3018" />
      
      {/* Plant leaves (palm-like) */}
      <path d="M 0 18 Q -4 10 -6 4 Q -7 2 -8 0" fill="none" stroke="#3A6A3A" strokeWidth="2" strokeLinecap="round" />
      <path d="M 0 18 Q 2 8 4 2 Q 5 0 6 -2" fill="none" stroke="#4A8A4A" strokeWidth="2" strokeLinecap="round" />
      <path d="M 0 18 Q 4 12 6 6 Q 7 4 8 2" fill="none" stroke="#3A6A3A" strokeWidth="2" strokeLinecap="round" />
      
      {/* Leaf details */}
      <path d="M -6 4 Q -10 4 -12 2" fill="none" stroke="#3A6A3A" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M -6 4 Q -8 8 -9 10" fill="none" stroke="#3A6A3A" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 6 6 Q 10 6 12 4" fill="none" stroke="#3A6A3A" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 6 6 Q 8 10 9 12" fill="none" stroke="#3A6A3A" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

// File cabinet (metal, grey)
export function StardewFileCabinet({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <rect x="2" y="48" width="24" height="3" fill="rgba(0,0,0,0.2)" />
      
      {/* Cabinet body */}
      <rect x="0" y="0" width="28" height="50" fill="#7A7A7A" stroke="#4A4A4A" strokeWidth="1.5" />
      <rect x="1" y="1" width="26" height="48" fill="#9A9A9A" />
      
      {/* Drawers (3) */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(0, ${i * 16})`}>
          <rect x="2" y="2" width="24" height="14" fill="#8A8A8A" stroke="#5A5A5A" strokeWidth="0.8" />
          <rect x="3" y="3" width="22" height="12" fill="#AAAAAA" opacity="0.3" />
          
          {/* Handle */}
          <rect x="11" y="7" width="6" height="3" rx="1" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
          
          {/* Label holder */}
          <rect x="8" y="5" width="12" height="6" fill="#F4E8D0" stroke="#C4B8A0" strokeWidth="0.4" />
        </g>
      ))}
    </g>
  );
}

// Bookshelf with books
export function StardewBookshelf({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <rect x="2" y="68" width="34" height="3" fill="rgba(0,0,0,0.2)" />
      
      {/* Shelf frame */}
      <rect x="0" y="0" width="38" height="70" fill="#6B4423" stroke="#4A3018" strokeWidth="1.5" />
      <rect x="2" y="2" width="34" height="66" fill="#8B6545" opacity="0.5" />
      
      {/* Shelves (3 levels) */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="2" y={22 + i * 22} width="34" height="3" fill="#5A3820" stroke="#3A2010" strokeWidth="0.5" />
          
          {/* Books on each shelf */}
          {[0, 1, 2, 3, 4].map((j) => {
            const colors = ["#8B4513", "#4A7C59", "#A14F3D", "#4A5A8A", "#8A6A4A"];
            const heights = [14, 16, 15, 17, 14];
            return (
              <rect
                key={j}
                x={4 + j * 6.5}
                y={22 + i * 22 - heights[j]}
                width="6"
                height={heights[j]}
                fill={colors[j]}
                stroke="#2A2010"
                strokeWidth="0.4"
              />
            );
          })}
        </g>
      ))}
    </g>
  );
}

// Whiteboard (for Academic/Profe)
export function StardewWhiteboard({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Frame */}
      <rect x="0" y="0" width="50" height="35" fill="#8A8A8A" stroke="#5A5A5A" strokeWidth="2" />
      
      {/* White surface */}
      <rect x="3" y="3" width="44" height="29" fill="#F4F4F4" stroke="#D4D4D4" strokeWidth="0.5" />
      
      {/* Written content */}
      <text x="6" y="10" fontSize="4" fill="#4A4A4A" fontFamily="monospace">AI AGENTS</text>
      <line x1="6" y1="12" x2="42" y2="12" stroke="#4A4A4A" strokeWidth="0.5" />
      <line x1="6" y1="16" x2="30" y2="16" stroke="#4A9AFF" strokeWidth="0.4" />
      <line x1="6" y1="19" x2="35" y2="19" stroke="#4A9AFF" strokeWidth="0.4" />
      <line x1="6" y1="22" x2="25" y2="22" stroke="#4A9AFF" strokeWidth="0.4" />
      
      {/* Marker tray */}
      <rect x="3" y="32" width="44" height="3" fill="#AAAAAA" stroke="#7A7A7A" strokeWidth="0.5" />
      <rect x="8" y="33" width="2" height="1.5" fill="#FF4A4A" />
      <rect x="12" y="33" width="2" height="1.5" fill="#4A4AFF" />
      <rect x="16" y="33" width="2" height="1.5" fill="#4A4A4A" />
    </g>
  );
}

// Camera on tripod (for Studio)
export function StardewCamera({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="42" rx="14" ry="4" fill="rgba(0,0,0,0.2)" />
      
      {/* Tripod legs */}
      <line x1="0" y1="30" x2="-10" y2="42" stroke="#3A3A3A" strokeWidth="2" />
      <line x1="0" y1="30" x2="10" y2="42" stroke="#3A3A3A" strokeWidth="2" />
      <line x1="0" y1="30" x2="0" y2="42" stroke="#3A3A3A" strokeWidth="2" />
      
      {/* Tripod feet */}
      <circle cx="-10" cy="42" r="2" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
      <circle cx="10" cy="42" r="2" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
      <circle cx="0" cy="42" r="2" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
      
      {/* Center post */}
      <rect x="-2" y="10" width="4" height="20" fill="#5A5A5A" stroke="#3A3A3A" strokeWidth="0.5" />
      
      {/* Camera body */}
      <rect x="-10" y="0" width="20" height="14" rx="2" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      
      {/* Lens */}
      <circle cx="0" cy="7" r="7" fill="#3A3A3A" stroke="#1A1A1A" strokeWidth="1" />
      <circle cx="0" cy="7" r="5" fill="#1A1A2A" stroke="#0A0A1A" strokeWidth="0.5" />
      <circle cx="0" cy="7" r="3" fill="#4A4AFF" opacity="0.3">
        <animate attributeName="opacity" values="0.2;0.4;0.2" dur="3s" repeatCount="indefinite" />
      </circle>
      
      {/* Lens reflection */}
      <circle cx="-2" cy="5" r="1.5" fill="#FFFFFF" opacity="0.6" />
      
      {/* Recording light */}
      <circle cx="8" cy="2" r="1.5" fill="#FF4A4A">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

// Briefcase (for LinkedIn Pro)
export function StardewBriefcase({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="22" rx="14" ry="3" fill="rgba(0,0,0,0.2)" />
      
      {/* Briefcase body */}
      <rect x="-12" y="8" width="24" height="16" rx="1" fill="#4A3018" stroke="#2A1808" strokeWidth="1" />
      <rect x="-11" y="9" width="22" height="14" rx="0.5" fill="#6B4423" />
      
      {/* Leather texture lines */}
      <line x1="-11" y1="13" x2="11" y2="13" stroke="#5A3420" strokeWidth="0.3" opacity="0.5" />
      <line x1="-11" y1="19" x2="11" y2="19" stroke="#5A3420" strokeWidth="0.3" opacity="0.5" />
      
      {/* Handle */}
      <path d="M -6 8 Q -6 2 0 2 Q 6 2 6 8" fill="none" stroke="#4A3018" strokeWidth="2" strokeLinecap="round" />
      <path d="M -6 8 Q -6 3 0 3 Q 6 3 6 8" fill="none" stroke="#6B4423" strokeWidth="1.5" strokeLinecap="round" />
      
      {/* Lock/clasp */}
      <rect x="-2" y="15" width="4" height="3" rx="0.5" fill="#8B7340" stroke="#6B5320" strokeWidth="0.5" />
      <circle cx="0" cy="16.5" r="0.5" fill="#3A2010" />
      
      {/* Corner reinforcements */}
      <rect x="-11" y="9" width="3" height="3" fill="#8B7340" opacity="0.6" />
      <rect x="8" y="9" width="3" height="3" fill="#8B7340" opacity="0.6" />
      <rect x="-11" y="20" width="3" height="3" fill="#8B7340" opacity="0.6" />
      <rect x="8" y="20" width="3" height="3" fill="#8B7340" opacity="0.6" />
    </g>
  );
}

// Smartphone (for Social)
export function StardewSmartphone({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <rect x="1" y="19" width="8" height="2" fill="rgba(0,0,0,0.2)" />
      
      {/* Phone body */}
      <rect x="0" y="0" width="10" height="20" rx="1.5" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="0.8" />
      
      {/* Screen */}
      <rect x="0.8" y="1.5" width="8.4" height="17" rx="1" fill="#4A4AFF" opacity="0.8">
        <animate attributeName="opacity" values="0.6;0.9;0.6" dur="4s" repeatCount="indefinite" />
      </rect>
      
      {/* App icons (simplified) */}
      <circle cx="3" cy="5" r="1.2" fill="#FF4A88" />
      <circle cx="7" cy="5" r="1.2" fill="#4AFF88" />
      <circle cx="3" cy="9" r="1.2" fill="#FFD700" />
      <circle cx="7" cy="9" r="1.2" fill="#4A9AFF" />
      <rect x="2" y="12" width="6" height="2" rx="0.5" fill="#FFFFFF" opacity="0.7" />
      
      {/* Notification badge */}
      <circle cx="8" cy="4" r="1" fill="#FF4A4A">
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
      </circle>
      
      {/* Home button */}
      <circle cx="5" cy="18.5" r="0.8" fill="#3A3A3A" stroke="#5A5A5A" strokeWidth="0.3" />
    </g>
  );
}

// Coffee machine (shared area)
export function StardewCoffeeMachine({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="38" rx="12" ry="4" fill="rgba(0,0,0,0.2)" />
      
      {/* Machine base */}
      <rect x="-10" y="20" width="20" height="18" rx="1" fill="#8A4A4A" stroke="#5A2A2A" strokeWidth="1" />
      <rect x="-9" y="21" width="18" height="16" fill="#AA6A6A" opacity="0.6" />
      
      {/* Machine top */}
      <rect x="-12" y="10" width="24" height="10" rx="1" fill="#AA6A6A" stroke="#5A2A2A" strokeWidth="1" />
      <rect x="-11" y="11" width="22" height="8" fill="#CA8A8A" opacity="0.5" />
      
      {/* Coffee dispenser */}
      <rect x="-4" y="32" width="8" height="6" fill="#3A3A3A" stroke="#2A2A2A" strokeWidth="0.5" />
      
      {/* Coffee pot */}
      <path d="M -6 32 L -8 36 L -8 38 L 8 38 L 8 36 L 6 32 Z" fill="#2A1A0A" stroke="#1A0A00" strokeWidth="0.8" />
      <ellipse cx="0" cy="32" rx="6" ry="2" fill="#4A2A1A" />
      
      {/* Coffee in pot */}
      <path d="M -5 34 L -7 36 L -7 37 L 7 37 L 7 36 L 5 34 Z" fill="#3A1A0A" />
      
      {/* Handle */}
      <path d="M 8 34 Q 12 34 12 36 Q 12 38 8 38" fill="none" stroke="#1A0A00" strokeWidth="1" />
      
      {/* Buttons */}
      <circle cx="-6" cy="15" r="1.5" fill="#4AFF88" opacity="0.8">
        <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="0" cy="15" r="1.5" fill="#FF4A4A" opacity="0.6" />
      <circle cx="6" cy="15" r="1.5" fill="#FFD700" opacity="0.6" />
      
      {/* Steam */}
      <g opacity="0.5">
        <path d="M -2 10 Q -3 5 -2 0" fill="none" stroke="#E0E0E0" strokeWidth="1" strokeLinecap="round">
          <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />
        </path>
        <path d="M 2 10 Q 3 5 2 0" fill="none" stroke="#E0E0E0" strokeWidth="1" strokeLinecap="round">
          <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2.5s" repeatCount="indefinite" />
        </path>
      </g>
    </g>
  );
}

// Printer (shared office equipment)
export function StardewPrinter({ x, y }: FurnitureProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shadow */}
      <rect x="2" y="22" width="34" height="3" fill="rgba(0,0,0,0.2)" />
      
      {/* Printer body */}
      <rect x="0" y="8" width="38" height="16" rx="1" fill="#D4D4D4" stroke="#9A9A9A" strokeWidth="1.5" />
      <rect x="1" y="9" width="36" height="14" fill="#F4F4F4" opacity="0.7" />
      
      {/* Scanner lid */}
      <rect x="0" y="0" width="38" height="8" rx="1" fill="#9A9A9A" stroke="#6A6A6A" strokeWidth="1" />
      <rect x="2" y="1" width="34" height="6" fill="#4A4A4A" />
      
      {/* Paper tray */}
      <rect x="4" y="10" width="30" height="2" fill="#FFFFFF" stroke="#C4C4C4" strokeWidth="0.4" />
      
      {/* Control panel */}
      <rect x="28" y="14" width="8" height="8" fill="#3A3A3A" stroke="#2A2A2A" strokeWidth="0.5" />
      
      {/* LED indicators */}
      <circle cx="30" cy="16" r="0.8" fill="#4AFF88">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="33" cy="16" r="0.8" fill="#FFD700" opacity="0.6" />
      
      {/* Buttons */}
      <rect x="30" y="18" width="3" height="2" rx="0.3" fill="#8A8A8A" />
      <rect x="30" y="21" width="3" height="2" rx="0.3" fill="#8A8A8A" />
      
      {/* Paper coming out */}
      <rect x="8" y="12" width="14" height="12" fill="#FFFFFF" stroke="#E4E4E4" strokeWidth="0.5" />
      <line x1="10" y1="15" x2="20" y2="15" stroke="#4A4A4A" strokeWidth="0.2" opacity="0.5" />
      <line x1="10" y1="18" x2="20" y2="18" stroke="#4A4A4A" strokeWidth="0.2" opacity="0.5" />
      <line x1="10" y1="21" x2="20" y2="21" stroke="#4A4A4A" strokeWidth="0.2" opacity="0.5" />
    </g>
  );
}
