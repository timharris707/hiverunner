"use client";

import { Puzzle, FolderOpen, ArrowRight } from "lucide-react";

interface SkillCardProps {
  skill: {
    id: string;
    name: string;
    description: string;
    location: string;
    source: "workspace" | "system";
    emoji?: string;
    fileCount: number;
  };
  onViewDetails: () => void;
}

export function SkillCard({ skill, onViewDetails }: SkillCardProps) {
  const truncatedDesc =
    skill.description.length > 120
      ? skill.description.slice(0, 120) + "..."
      : skill.description;

  const iconBgColor = skill.source === "workspace" 
    ? "rgba(168, 85, 247, 0.15)" 
    : "rgba(59, 130, 246, 0.15)";
  
  const iconColor = skill.source === "workspace" ? "#A855F7" : "#3B82F6";

  return (
    <div 
      className="rounded-xl p-3 md:p-5 transition-all hover:shadow-lg group"
      style={{ 
        backgroundColor: "var(--card)", 
        border: "1px solid var(--border)" 
      }}
    >
      <div className="flex items-start gap-3 md:gap-4 mb-3 md:mb-4">
        <div 
          className="p-2 md:p-3 rounded-lg transition-colors"
          style={{ backgroundColor: iconBgColor }}
        >
          {skill.emoji ? (
            <span className="text-xl md:text-2xl">{skill.emoji}</span>
          ) : (
            <Puzzle className="w-5 h-5 md:w-6 md:h-6" style={{ color: iconColor }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 
            className="font-bold text-base md:text-lg truncate"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
          >
            {skill.name}
          </h3>
          <span
            className="inline-block text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded mt-1"
            style={{
              backgroundColor: skill.source === "workspace" 
                ? "rgba(168, 85, 247, 0.2)" 
                : "rgba(59, 130, 246, 0.2)",
              color: skill.source === "workspace" ? "#C4B5FD" : "#93C5FD"
            }}
          >
            {skill.source === "workspace" ? "Workspace" : "System"}
          </span>
        </div>
      </div>

      <p 
        className="text-xs md:text-sm mb-3 md:mb-4 line-clamp-2"
        style={{ color: "var(--text-secondary)" }}
      >
        {truncatedDesc}
      </p>

      <div 
        className="flex items-center gap-2 text-[10px] md:text-xs mb-3 md:mb-4"
        style={{ color: "var(--text-muted)" }}
      >
        <FolderOpen className="w-3 h-3 md:w-3.5 md:h-3.5" />
        <span className="truncate">{skill.location}</span>
      </div>

      <div 
        className="flex items-center justify-between pt-2 md:pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span className="text-[10px] md:text-xs" style={{ color: "var(--text-muted)" }}>
          {skill.fileCount} files
        </span>
        <button
          onClick={onViewDetails}
          className="flex items-center gap-1 md:gap-1.5 text-xs md:text-sm transition-colors hover:opacity-80"
          style={{ color: "var(--accent)" }}
        >
          View Details
          <ArrowRight className="w-3.5 h-3.5 md:w-4 md:h-4" />
        </button>
      </div>
    </div>
  );
}
