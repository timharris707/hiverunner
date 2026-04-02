"use client";

import { useState } from "react";
import { Wrench, Plus, X } from "lucide-react";
import { useAgentProfile, A } from "../layout";

export default function AgentSkillsPage() {
  const { profile } = useAgentProfile();
  const { agent } = profile;
  const [skills, setSkills] = useState<string[]>(agent.skills ?? []);
  const [newSkill, setNewSkill] = useState("");

  const addSkill = () => {
    const trimmed = newSkill.trim();
    if (!trimmed || skills.includes(trimmed)) return;
    setSkills([...skills, trimmed]);
    setNewSkill("");
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: A.accent, fontSize: 12, fontWeight: 600 }}>
        <Wrench size={13} />
        Agent Skills
      </div>

      {skills.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)", marginBottom: 12 }}>
          No skills configured
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {skills.map((skill) => (
            <div
              key={skill}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 6,
                background: "rgba(217,119,6,0.08)", border: `1px solid ${A.cardBorder}`,
                color: A.text, fontSize: 12,
              }}
            >
              <span>{skill}</span>
              <button
                onClick={() => removeSkill(skill)}
                style={{ background: "none", border: "none", color: A.muted, cursor: "pointer", padding: 0, display: "flex" }}
                title="Remove skill"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSkill()}
          placeholder="Add a skill..."
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 6,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            color: A.text, fontSize: 12, outline: "none",
          }}
        />
        <button
          onClick={addSkill}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 6,
            background: "rgba(217,119,6,0.10)", border: `1px solid ${A.cardBorder}`,
            color: A.accentLight, fontSize: 11, fontWeight: 500, cursor: "pointer",
          }}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
};
