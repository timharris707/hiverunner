"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Wand2 } from "lucide-react";

import {
  AvatarWizard,
  type AvatarGender,
  type AvatarWizardDraftPayload,
} from "@/components/orchestration/AvatarWizard";
import { AvatarGlyph, avatarIconToken } from "@/components/orchestration/AvatarGlyph";
import { voicePresetById, voicesForGender } from "@/components/orchestration/voice-catalog";

export type AgentIdentityDraft = AvatarWizardDraftPayload;

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-secondary)",
  marginBottom: "6px",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

const controlStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "42px",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "9px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...controlStyle,
  appearance: "none",
  paddingRight: "42px",
};

function draftCacheKey(companySlug: string, agentName: string): string {
  const name = agentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `create-agent-${companySlug || "company"}-${name || "new"}`;
}

function genderLabel(gender?: AvatarGender | null): string {
  if (gender === "male") return "Male";
  if (gender === "female") return "Female";
  if (gender === "androgynous") return "Androgynous";
  return "Auto";
}

function avatarStatus(value: AgentIdentityDraft): string {
  if (value.avatarUrl) return "Custom portrait";
  if (value.emoji && avatarIconToken(value.emoji)) return "Custom icon";
  return "Auto avatar";
}

function AvatarPreview({ value }: { value: AgentIdentityDraft }) {
  if (value.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value.avatarUrl}
        alt=""
        aria-hidden="true"
        width={34}
        height={34}
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "999px",
          objectFit: "cover",
          border: "1px solid rgba(168,162,158,0.32)",
          flex: "0 0 34px",
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: "34px",
        height: "34px",
        borderRadius: "999px",
        border: "1px solid rgba(168,162,158,0.28)",
        background: "rgba(120,113,108,0.14)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 34px",
      }}
    >
      <AvatarGlyph value={value.emoji} size={16} color="var(--text-primary)" />
    </span>
  );
}

export function AgentIdentityFields({
  companySlug,
  agentName,
  agentRole,
  value,
  onChange,
}: {
  companySlug: string;
  agentName: string;
  agentRole: string;
  value: AgentIdentityDraft;
  onChange: (value: AgentIdentityDraft) => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const gender = value.avatarGender;
  const voiceOptions = useMemo(() => voicesForGender(gender), [gender]);
  const selectedVoice = voicePresetById(value.voiceId);

  function update(next: Partial<AgentIdentityDraft>) {
    onChange({ ...value, ...next });
  }

  function setGender(raw: string) {
    const nextGender = raw === "male" || raw === "female" || raw === "androgynous"
      ? raw
      : undefined;
    const nextVoices = voicesForGender(nextGender);
    const voiceStillValid = value.voiceId
      ? nextVoices.some((voice) => voice.id === value.voiceId)
      : true;
    update({
      avatarGender: nextGender,
      voiceId: voiceStillValid ? value.voiceId : null,
    });
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <label style={labelStyle}>Identity</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div style={{ position: "relative" }}>
          <select
            value={gender ?? ""}
            onChange={(event) => setGender(event.target.value)}
            style={selectStyle}
            aria-label="Gender"
          >
            <option value="">Auto gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="androgynous">Androgynous</option>
          </select>
          <ChevronDown
            size={17}
            color="var(--text-muted)"
            style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          />
        </div>
        <div style={{ position: "relative" }}>
          <select
            value={value.voiceId ?? ""}
            onChange={(event) => update({ voiceId: event.target.value || null })}
            style={selectStyle}
            aria-label="Voice"
          >
            <option value="">Auto voice</option>
            {voiceOptions.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} — {voice.style}, {voice.pace}
              </option>
            ))}
          </select>
          <ChevronDown
            size={17}
            color="var(--text-muted)"
            style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          />
        </div>
      </div>

      <div
        style={{
          borderRadius: "10px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "9px 10px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <AvatarPreview value={value} />
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
          <span style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: 600 }}>{avatarStatus(value)}</span>
          <span style={{ color: "var(--text-secondary)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {genderLabel(gender)} · {selectedVoice ? `${selectedVoice.name} · ${selectedVoice.style}` : "Auto voice"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            borderRadius: "9px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            padding: "7px 10px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Wand2 size={13} />
          Customize
        </button>
      </div>

      <AvatarWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        saveMode="draft"
        defaultSource="generated"
        onDraftSaved={(payload) => onChange({ ...value, ...payload })}
        agentName={agentName.trim() || "New agent"}
        agentRole={agentRole.trim() || "Agent"}
        agentEmoji={value.emoji ?? "icon:bot"}
        currentAvatar={value.avatarUrl ?? value.emoji ?? undefined}
        companySlug={companySlug}
        agentId={draftCacheKey(companySlug, agentName)}
        initialStyleId={value.avatarStyleId ?? undefined}
        initialGender={value.avatarGender}
        initialAge={value.avatarAge ?? undefined}
        initialHairColor={value.avatarHairColor ?? undefined}
        initialHairLength={value.avatarHairLength ?? undefined}
        initialEyeColor={value.avatarEyeColor ?? undefined}
        initialVibe={value.avatarVibe ?? undefined}
        initialVoiceId={value.voiceId ?? undefined}
        onSaved={() => setWizardOpen(false)}
      />
    </div>
  );
}
