import { useEffect, useState } from "react";

interface HabboCharacterProps {
  agent: {
    id: string;
    name: string;
    emoji: string;
    color: string;
    role: string;
    currentTask: string;
    isActive: boolean;
  };
  position: { isoX: number; isoY: number };
}

// Convert isometric coordinates to screen coordinates
const isoToScreen = (isoX: number, isoY: number) => {
  const screenX = (isoX - isoY) * 32;
  const screenY = (isoX + isoY) * 16;
  return { screenX, screenY };
};

export function HabboCharacter({ agent, position }: HabboCharacterProps) {
  const [showBubble, setShowBubble] = useState(false);
  const [bobbing, setBobbing] = useState(0);

  const { screenX, screenY } = isoToScreen(position.isoX, position.isoY);

  useEffect(() => {
    if (!agent.isActive) return;
    const interval = setInterval(() => {
      setBobbing((prev) => (prev + 1) % 3);
    }, 300);
    return () => clearInterval(interval);
  }, [agent.isActive]);

  // Habbo character colors based on agent
  const getCharacterColors = () => {
    const colors: Record<string, { skin: string; hair: string; shirt: string; pants: string }> = {
      main: { skin: "#ffcc99", hair: "#ff6b35", shirt: "#ff4444", pants: "#333" },
      academic: { skin: "#ffcc99", hair: "#8b5a3c", shirt: "#4ade80", pants: "#2d5016" },
      studio: { skin: "#ffcc99", hair: "#a855f7", shirt: "#d946ef", pants: "#581c87" },
      linkedin: { skin: "#ffcc99", hair: "#333", shirt: "#0077b5", pants: "#222" },
      social: { skin: "#ffcc99", hair: "#ec4899", shirt: "#f472b6", pants: "#831843" },
      infra: { skin: "#ffcc99", hair: "#f97316", shirt: "#22c55e", pants: "#15803d" },
    };
    return colors[agent.id] || { skin: "#ffcc99", hair: "#666", shirt: "#999", pants: "#555" };
  };

  const colors = getCharacterColors();

  return (
    <div
      className="absolute cursor-pointer hover:scale-105 transition-transform"
      style={{
        left: `calc(50% + ${screenX}px)`,
        top: `calc(50% + ${screenY}px)`,
        transform: agent.isActive
          ? `translate(-50%, -50%) translateY(${bobbing * -2}px)`
          : "translate(-50%, -50%)",
        zIndex: Math.floor(position.isoX + position.isoY),
      }}
      onMouseEnter={() => setShowBubble(true)}
      onMouseLeave={() => setShowBubble(false)}
    >
      {/* Speech Bubble Habbo Style */}
      {showBubble && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: "8px",
            backgroundColor: "#fff",
            color: "#000",
            padding: "6px 10px",
            borderRadius: "12px",
            border: "2px solid #000",
            fontSize: "10px",
            fontFamily: "'Press Start 2P', monospace",
            maxWidth: "180px",
            whiteSpace: "pre-wrap",
            zIndex: 1000,
            boxShadow: "3px 3px 0 rgba(0,0,0,0.4)",
            animation: "habbo-bubble-pop 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
          }}
        >
          {agent.currentTask}
          {/* Bubble tail */}
          <svg
            style={{
              position: "absolute",
              top: "100%",
              left: "20%",
              width: "12px",
              height: "8px",
            }}
            viewBox="0 0 12 8"
          >
            <path d="M0,0 L6,8 L12,0 Z" fill="#000" />
            <path d="M1.5,0 L6,6 L10.5,0 Z" fill="#fff" />
          </svg>
        </div>
      )}

      {/* Habbo Character - pixel art style */}
      <svg width="48" height="64" viewBox="0 0 48 64" style={{ filter: agent.isActive ? "none" : "grayscale(50%) opacity(70%)" }}>
        {/* Shadow */}
        <ellipse cx="24" cy="60" rx="12" ry="4" fill="rgba(0,0,0,0.3)" />
        
        {/* Legs (back) - isometric */}
        <rect x="16" y="48" width="6" height="12" fill={colors.pants} stroke="#000" strokeWidth="1" />
        <rect x="26" y="48" width="6" height="12" fill={colors.pants} stroke="#000" strokeWidth="1" />
        
        {/* Body - blocky */}
        <rect x="14" y="32" width="20" height="18" fill={colors.shirt} stroke="#000" strokeWidth="1.5" />
        
        {/* Arms */}
        <rect x="8" y="36" width="6" height="12" fill={colors.shirt} stroke="#000" strokeWidth="1" />
        <rect x="34" y="36" width="6" height="12" fill={colors.shirt} stroke="#000" strokeWidth="1" />
        
        {/* Hands - typing animation when active */}
        {agent.isActive && (
          <>
            <rect x="8" y="46" width="6" height="4" fill={colors.skin} stroke="#000" strokeWidth="0.5">
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0,0; 0,2; 0,0"
                dur="0.6s"
                repeatCount="indefinite"
              />
            </rect>
            <rect x="34" y="46" width="6" height="4" fill={colors.skin} stroke="#000" strokeWidth="0.5">
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0,0; 0,2; 0,0"
                dur="0.6s"
                begin="0.3s"
                repeatCount="indefinite"
              />
            </rect>
          </>
        )}
        {!agent.isActive && (
          <>
            <rect x="8" y="46" width="6" height="4" fill={colors.skin} stroke="#000" strokeWidth="0.5" />
            <rect x="34" y="46" width="6" height="4" fill={colors.skin} stroke="#000" strokeWidth="0.5" />
          </>
        )}
        
        {/* Head - LARGE and SQUARE like Habbo */}
        <rect x="10" y="8" width="28" height="28" fill={colors.skin} stroke="#000" strokeWidth="1.5" />
        
        {/* Hair - blocky style */}
        <rect x="10" y="8" width="28" height="12" fill={colors.hair} stroke="#000" strokeWidth="1" />
        <rect x="8" y="10" width="4" height="8" fill={colors.hair} stroke="#000" strokeWidth="0.5" />
        <rect x="36" y="10" width="4" height="8" fill={colors.hair} stroke="#000" strokeWidth="0.5" />
        
        {/* Eyes */}
        <circle cx="18" cy="22" r="2.5" fill="#000" />
        <circle cx="30" cy="22" r="2.5" fill="#000" />
        <circle cx="18.5" cy="21.5" r="1" fill="#fff" />
        <circle cx="30.5" cy="21.5" r="1" fill="#fff" />
        
        {/* Mouth */}
        {agent.isActive ? (
          <rect x="20" y="28" width="8" height="2" fill="#000" />
        ) : (
          <rect x="20" y="28" width="8" height="1" fill="#666" />
        )}
        
        {/* Idle zzZ animation */}
        {!agent.isActive && (
          <>
            <text x="42" y="12" fontFamily="Arial" fontSize="8" fill="#666">z</text>
            <text x="44" y="8" fontFamily="Arial" fontSize="10" fill="#888">z</text>
            <text x="46" y="4" fontFamily="Arial" fontSize="12" fill="#aaa">Z</text>
          </>
        )}
        
        {/* Agent emoji badge */}
        <text x="32" y="16" fontSize="12">{agent.emoji}</text>
      </svg>

      {/* Name tag */}
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: "4px",
          backgroundColor: agent.color,
          color: "#fff",
          padding: "2px 6px",
          fontSize: "8px",
          fontFamily: "'Press Start 2P', monospace",
          fontWeight: "bold",
          border: "2px solid #000",
          whiteSpace: "nowrap",
          textShadow: "1px 1px 0 #000",
        }}
      >
        {agent.name}
      </div>

      {/* Active indicator */}
      {agent.isActive && (
        <div
          style={{
            position: "absolute",
            top: "-8px",
            right: "-8px",
            width: "12px",
            height: "12px",
            backgroundColor: "#4ade80",
            border: "2px solid #000",
            borderRadius: "50%",
            animation: "pulse 2s infinite",
          }}
        />
      )}
    </div>
  );
}
