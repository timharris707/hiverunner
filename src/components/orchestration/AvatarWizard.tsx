"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  X,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  Palette,
  Image as ImageIcon,
  Wand2,
  Play,
  Volume2,
} from "lucide-react";
import { AVATAR_THEME_PRESETS } from "./avatar-theme-data";
import { AvatarGlyph, avatarIconToken, toAvatarIconToken } from "./AvatarGlyph";
import { LUCIDE_ICON_OPTIONS } from "./lucide-icons";
import { clearAvatarDraftCache, readAvatarDraftCache, writeAvatarDraftCache } from "./avatar-draft-storage";
import { VOICE_CATALOG, type VoicePreset } from "./voice-catalog";

/* ── Types ── */
export type AvatarSource = "icon" | "generated";
export type AvatarGender = "male" | "female" | "androgynous";
export type AvatarStyle = (typeof AVATAR_THEME_PRESETS)[number]["id"];

interface AvatarWizardProps {
  open: boolean;
  onClose: () => void;
  agentName: string;
  agentRole: string;
  agentEmoji: string;
  agentPersonality?: string;
  currentAvatar?: string;
  companySlug: string;
  agentId: string;
  alternateAgentKey?: string;
  avatarMode?: "company_theme" | "mixed";
  companyThemeName?: string;
  initialStyleId?: string;
  initialGender?: AvatarGender;
  initialAge?: number;
  initialHairColor?: string;
  initialHairLength?: string;
  initialEyeColor?: string;
  initialVibe?: string;
  initialVoiceId?: string;
  autoStart?: boolean;
  pendingSetup?: boolean;
  onSaved: () => void;
}

type WizardStep = "source" | "identity" | "voice" | "preview";
const STEP_ORDER: WizardStep[] = ["source", "identity", "voice", "preview"];
const STEP_LABELS: Record<WizardStep, string> = {
  source: "Source",
  identity: "Identity & Style",
  voice: "Voice",
  preview: "Preview",
};

/* ── Color palette ── */
const W = {
  bg: "rgba(12,10,9,0.96)",
  card: "rgba(28,25,23,0.85)",
  border: "rgba(120,113,108,0.22)",
  borderHover: "rgba(120,113,108,0.45)",
  text: "#f5f5f4",
  textSec: "#a8a29e",
  muted: "#57534e",
  accent: "#d6d3d1",
  accentText: "#0c0a09",
  accentDim: "rgba(120,113,108,0.12)",
  accentBorder: "rgba(120,113,108,0.35)",
  success: "#6ee7b7",
  danger: "#ef4444",
};

const TARGET_PREVIEW_COUNT = 4;

const HAIR_COLORS = [
  "Black",
  "Dark Brown",
  "Brown",
  "Light Brown",
  "Blonde",
  "Red",
  "Auburn",
  "Gray",
  "White",
  "Silver",
  "Pink",
  "Blue",
  "Purple",
  "Green",
  "Teal",
];
const HAIR_LENGTHS = [
  "Shaved",
  "Buzz",
  "Short",
  "Medium",
  "Shoulder-length",
  "Long",
  "Very long",
];
const EYE_COLORS = [
  "Brown",
  "Hazel",
  "Green",
  "Blue",
  "Gray",
  "Amber",
  "Violet",
  "Heterochromia",
];

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export function AvatarWizard({
  open,
  onClose,
  agentName,
  agentRole,
  agentEmoji,
  agentPersonality,
  currentAvatar,
  companySlug,
  agentId,
  alternateAgentKey,
  avatarMode,
  companyThemeName,
  initialStyleId,
  initialGender,
  initialAge,
  initialHairColor,
  initialHairLength,
  initialEyeColor,
  initialVibe,
  initialVoiceId,
  autoStart = false,
  pendingSetup = false,
  onSaved,
}: AvatarWizardProps) {
  const [step, setStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<AvatarSource>("generated");
  const [selectedIcon, setSelectedIcon] = useState<string>(LUCIDE_ICON_OPTIONS[0]?.value ?? "bot");
  const [styleId, setStyleId] = useState<string>(initialStyleId ?? "cyber-organic");
  const [gender, setGender] = useState<AvatarGender>(initialGender ?? "androgynous");
  const [age, setAge] = useState<number | null>(initialAge ?? null);
  const [hairColor, setHairColor] = useState<string | null>(initialHairColor ?? null);
  const [hairLength, setHairLength] = useState<string | null>(initialHairLength ?? null);
  const [eyeColor, setEyeColor] = useState<string | null>(initialEyeColor ?? null);
  const [vibe, setVibe] = useState<string>(initialVibe ?? "");
  const [voiceId, setVoiceId] = useState<string | null>(initialVoiceId ?? null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setRestoredFromCache] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{
    provider: string; label: string; aiAvailable: boolean; setupHint?: string;
  } | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const generationRunRef = useRef(0);
  const identityRef = useRef({
    styleId,
    gender,
    age,
    hairColor,
    hairLength,
    eyeColor,
    vibe,
  });
  const voiceIdRef = useRef(voiceId);
  const hasOpenedRef = useRef(false);

  const isCompanyConstrained = avatarMode === "company_theme";

  const availableStyles = useMemo((): readonly { id: string; name: string; emoji: string; description: string; keywords: readonly string[] }[] => {
    if (!isCompanyConstrained) return AVATAR_THEME_PRESETS;
    const companyMatch = AVATAR_THEME_PRESETS.find(
      (p) => p.name.toLowerCase() === (companyThemeName ?? "").toLowerCase()
    );
    if (companyMatch) {
      return [companyMatch, ...AVATAR_THEME_PRESETS.filter((p) => p.id !== companyMatch.id).slice(0, 2)];
    }
    return AVATAR_THEME_PRESETS.slice(0, 3);
  }, [isCompanyConstrained, companyThemeName]);

  useEffect(() => {
    identityRef.current = { styleId, gender, age, hairColor, hairLength, eyeColor, vibe };
  }, [styleId, gender, age, hairColor, hairLength, eyeColor, vibe]);

  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  const writeCache = useCallback((nextPreviews: string[]) => {
    const snap = identityRef.current;
    writeAvatarDraftCache(agentId, {
      styleId: snap.styleId,
      gender: snap.gender,
      previews: nextPreviews,
      updatedAt: Date.now(),
      age: snap.age,
      hairColor: snap.hairColor,
      hairLength: snap.hairLength,
      eyeColor: snap.eyeColor,
      vibe: snap.vibe || null,
      voiceId: voiceIdRef.current,
    }, alternateAgentKey);
  }, [agentId, alternateAgentKey]);

  const generatePreviews = useCallback(async (options?: {
    seedPreviews?: string[];
  }) => {
    const snapshot = identityRef.current;
    const seeded = [...(options?.seedPreviews ?? [])].slice(0, TARGET_PREVIEW_COUNT);
    const runId = ++generationRunRef.current;

    setStep("preview");
    setGenerating(true);
    setError(null);
    setPreviews([...seeded]);
    setSelectedPreview(0);
    writeCache(seeded);

    try {
      const nextPreviews = [...seeded];
      for (let index = nextPreviews.length; index < TARGET_PREVIEW_COUNT; index += 1) {
        const res = await fetch("/api/orchestration/avatars/generate-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentName,
            agentRole,
            agentEmoji,
            agentPersonality: agentPersonality ?? "",
            styleId: snapshot.styleId,
            gender: snapshot.gender,
            age: snapshot.age,
            hairColor: snapshot.hairColor,
            hairLength: snapshot.hairLength,
            eyeColor: snapshot.eyeColor,
            vibe: snapshot.vibe || null,
            count: 1,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { previews?: string[]; error?: string };
        if (!res.ok) throw new Error(data.error || `Failed to generate (${res.status})`);
        const preview = data.previews?.[0];
        if (!preview) throw new Error(`Preview ${index + 1} was empty`);
        if (generationRunRef.current !== runId) return;
        nextPreviews.push(preview);
        setPreviews([...nextPreviews]);
        writeCache([...nextPreviews]);
      }
    } catch (err) {
      if (generationRunRef.current !== runId) return;
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      if (generationRunRef.current === runId) {
        setGenerating(false);
      }
    }
  }, [agentEmoji, agentName, agentPersonality, agentRole, writeCache]);

  // Reset runs exactly once per modal open — not on downstream state changes.
  // A ref guard prevents re-running when internal state mutates deps.
  useEffect(() => {
    if (!open) {
      hasOpenedRef.current = false;
      return;
    }
    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;

    const cached = readAvatarDraftCache(agentId, alternateAgentKey);
    const nextIcon = avatarIconToken(agentEmoji) ?? LUCIDE_ICON_OPTIONS[0]?.value ?? "bot";
    const nextStyleId = initialStyleId ?? cached?.styleId ?? "cyber-organic";
    const nextGender = initialGender ?? (cached?.gender as AvatarGender | undefined) ?? "androgynous";
    const cachedPreviews = cached?.previews ?? [];
    const cacheComplete = cachedPreviews.length >= TARGET_PREVIEW_COUNT;

    setSource("generated");
    setSelectedIcon(nextIcon);
    setStyleId(nextStyleId);
    setGender(nextGender);
    setAge(initialAge ?? cached?.age ?? null);
    setHairColor(initialHairColor ?? cached?.hairColor ?? null);
    setHairLength(initialHairLength ?? cached?.hairLength ?? null);
    setEyeColor(initialEyeColor ?? cached?.eyeColor ?? null);
    setVibe(initialVibe ?? cached?.vibe ?? "");
    setVoiceId(initialVoiceId ?? cached?.voiceId ?? null);
    setGenerating(false);
    setSaving(false);
    setError(null);

    if (cacheComplete) {
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setStep("preview");
      setRestoredFromCache(true);
    } else if (cachedPreviews.length > 0 || autoStart || pendingSetup) {
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setRestoredFromCache(false);
      void generatePreviews({ seedPreviews: cachedPreviews });
    } else {
      setPreviews([]);
      setSelectedPreview(0);
      setStep("source");
      setRestoredFromCache(false);
    }

    fetch("/api/orchestration/avatars/status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setProviderStatus(data); })
      .catch(() => {});
    // Deliberately minimal deps: this must only fire on open transition, not
    // whenever an initial* prop or callback identity changes. The guard ref
    // plus `open` dependency is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Swallow Escape so in-progress work isn't lost
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const applyAvatar = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        avatarStyleId: styleId,
        avatarGender: gender,
        avatarAge: age,
        avatarHairColor: hairColor,
        avatarHairLength: hairLength,
        avatarEyeColor: eyeColor,
        avatarVibe: vibe || null,
        voiceId,
        avatarSetupPending: false,
      };

      if (source === "icon") {
        payload.avatarUrl = null;
        payload.emoji = toAvatarIconToken(selectedIcon);
      } else {
        const selected = previews[selectedPreview];
        if (!selected) throw new Error("No preview selected");
        payload.avatarUrl = selected;
      }

      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);

      clearAvatarDraftCache(agentId);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [agentId, age, companySlug, eyeColor, gender, hairColor, hairLength, onClose, onSaved, previews, selectedIcon, selectedPreview, source, styleId, vibe, voiceId]);

  const goNext = () => {
    if (step === "source") {
      if (source === "icon") {
        void applyAvatar();
        return;
      }
      setStep("identity");
    } else if (step === "identity") {
      setStep("voice");
    } else if (step === "voice") {
      setStep("preview");
      void generatePreviews({ seedPreviews: [] });
    }
  };

  const goBack = () => {
    if (step === "identity") setStep("source");
    else if (step === "voice") setStep("identity");
    else if (step === "preview") setStep("voice");
  };

  if (!open) return null;

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div
      ref={backdropRef}
      onClick={() => { /* swallow backdrop clicks — don't lose work */ }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: "88vh",
          borderRadius: 16,
          background: W.bg,
          border: `1px solid ${W.border}`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: `1px solid ${W.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Wand2 size={16} style={{ color: W.textSec }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: W.text }}>
              Avatar Wizard
            </span>
            <span style={{ fontSize: 11, color: W.textSec }}>
              {agentName}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: W.muted,
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 6, padding: "12px 20px 8px", alignItems: "center" }}>
          {STEP_ORDER.map((key, i) => {
            const label = STEP_LABELS[key];
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: i <= stepIndex ? W.accent : W.muted,
                    transition: "background 0.2s",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: i === stepIndex ? W.text : W.muted,
                    fontWeight: i === stepIndex ? 600 : 400,
                  }}
                >
                  {label}
                </span>
                {i < STEP_ORDER.length - 1 && (
                  <div
                    style={{
                      width: 20,
                      height: 1,
                      background: i < stepIndex ? W.accent : W.border,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
          {step === "source" && (
            <SourceStep
              source={source}
              onSelect={setSource}
              selectedIcon={selectedIcon}
              onSelectIcon={setSelectedIcon}
              currentAvatar={currentAvatar}
              agentEmoji={agentEmoji}
              providerStatus={providerStatus}
              pendingSetup={pendingSetup}
            />
          )}
          {step === "identity" && (
            <IdentityAndStyleStep
              styles={availableStyles}
              styleId={styleId}
              onStyleSelect={setStyleId}
              gender={gender}
              onGenderSelect={setGender}
              age={age}
              onAgeChange={setAge}
              hairColor={hairColor}
              onHairColorChange={setHairColor}
              hairLength={hairLength}
              onHairLengthChange={setHairLength}
              eyeColor={eyeColor}
              onEyeColorChange={setEyeColor}
              vibe={vibe}
              onVibeChange={setVibe}
              isConstrained={isCompanyConstrained}
            />
          )}
          {step === "voice" && (
            <VoiceStep
              voiceId={voiceId}
              onSelect={setVoiceId}
            />
          )}
          {step === "preview" && (
            <PreviewStep
              previews={previews}
              selectedIndex={selectedPreview}
              onSelect={setSelectedPreview}
              generating={generating}
              onRegenerate={() => void generatePreviews({ seedPreviews: [] })}
              agentName={agentName}
              styleName={AVATAR_THEME_PRESETS.find((p) => p.id === styleId)?.name ?? styleId}
              isAi={providerStatus?.aiAvailable ?? false}
              total={TARGET_PREVIEW_COUNT}
            />
          )}
        </div>

        {error && (
          <div
            style={{
              margin: "0 20px 8px",
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              fontSize: 12,
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 20px 16px",
            borderTop: `1px solid ${W.border}`,
          }}
        >
          <div>
            {stepIndex > 0 && (
              <WizardBtn variant="ghost" onClick={goBack}>
                <ChevronLeft size={13} /> Back
              </WizardBtn>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <WizardBtn variant="ghost" onClick={onClose}>
              Cancel
            </WizardBtn>
            {step === "preview" ? (
              <WizardBtn
                variant="primary"
                onClick={applyAvatar}
                disabled={saving || generating || previews.length === 0}
              >
                {saving ? (
                  <>
                    <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Applying…
                  </>
                ) : (
                  <>
                    <Check size={13} /> Apply Avatar
                  </>
                )}
              </WizardBtn>
            ) : (
              <WizardBtn variant="primary" onClick={goNext}>
                {step === "source" && source === "icon" ? (
                  <>
                    <Check size={13} /> Apply Icon
                  </>
                ) : (
                  <>
                    Next <ChevronRight size={13} />
                  </>
                )}
              </WizardBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   STEP: Source
   ═══════════════════════════════════════════ */
function SourceStep({
  source,
  onSelect,
  selectedIcon,
  onSelectIcon,
  currentAvatar,
  agentEmoji,
  providerStatus,
  pendingSetup,
}: {
  source: AvatarSource;
  onSelect: (s: AvatarSource) => void;
  selectedIcon: string;
  onSelectIcon: (value: string) => void;
  currentAvatar?: string;
  agentEmoji: string;
  providerStatus: { provider: string; label: string; aiAvailable: boolean; setupHint?: string } | null;
  pendingSetup: boolean;
}) {
  const aiAvailable = providerStatus?.aiAvailable ?? false;
  const sourceIconValue = toAvatarIconToken(selectedIcon);
  const currentAvatarIsIcon = avatarIconToken(currentAvatar);
  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 14px" }}>
        {pendingSetup
          ? "Portrait setup was started during agent creation. You can continue from the saved settings or switch back to the classic icon."
          : "Choose how this agent's avatar should look."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SourceCard
          selected={source === "icon"}
          onClick={() => onSelect("icon")}
          icon={
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <AvatarGlyph value={sourceIconValue} size={28} fallback={agentEmoji || "🤖"} color={W.text} />
            </span>
          }
          title="Basic icon"
          description="Quick option — pick a Lucide glyph. No portrait generation."
        />
        <SourceCard
          selected={source === "generated"}
          onClick={() => onSelect("generated")}
          icon={<Sparkles size={28} style={{ color: W.textSec }} />}
          title={aiAvailable ? "Generated portrait" : "Styled portrait"}
          description={
            aiAvailable
              ? `Customize gender, style, age, hair, eyes, and vibe — ${providerStatus?.label ?? "AI"} generates a unique portrait.`
              : "Generate a styled SVG portrait from a customizable brief."
          }
        />
      </div>
      {!aiAvailable && providerStatus?.setupHint && source === "generated" && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 8,
          background: "rgba(120,113,108,0.08)", border: `1px solid ${W.border}`,
          fontSize: 11, color: W.textSec, lineHeight: 1.5,
        }}>
          <Sparkles size={11} style={{ verticalAlign: "-1px", marginRight: 4, color: W.textSec }} />
          {providerStatus.setupHint}
        </div>
      )}
      {source === "icon" ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: W.textSec, fontWeight: 600 }}>
            Pick a basic icon
          </p>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
            gap: 6,
            maxHeight: 142,
            overflowY: "auto",
            padding: 2,
          }}>
            {LUCIDE_ICON_OPTIONS.map((option) => {
              const iconValue = toAvatarIconToken(option.value);
              const selected = option.value === selectedIcon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSelectIcon(option.value)}
                  title={`${option.label} (${option.value})`}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: `1px solid ${selected ? W.accentBorder : W.border}`,
                    background: selected ? W.accentDim : "rgba(255,255,255,0.04)",
                    color: selected ? W.text : W.textSec,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <AvatarGlyph value={iconValue} size={16} color={selected ? W.text : W.textSec} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {currentAvatar && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: W.muted }}>Current avatar:</span>
          {currentAvatarIsIcon ? (
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: `1px solid ${W.border}`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <AvatarGlyph value={currentAvatar} size={22} color={W.text} />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentAvatar}
              alt="current"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: `1px solid ${W.border}`,
                objectFit: "cover",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SourceCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: `1.5px solid ${selected ? W.accentBorder : W.border}`,
        background: selected ? W.accentDim : W.card,
        cursor: "pointer",
        textAlign: "left",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: W.text, marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: W.textSec, lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
      {selected && (
        <Check size={16} style={{ color: W.accent, flexShrink: 0 }} />
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════
   STEP: Identity & Style (combined)
   ═══════════════════════════════════════════ */
function IdentityAndStyleStep({
  styles,
  styleId,
  onStyleSelect,
  gender,
  onGenderSelect,
  age,
  onAgeChange,
  hairColor,
  onHairColorChange,
  hairLength,
  onHairLengthChange,
  eyeColor,
  onEyeColorChange,
  vibe,
  onVibeChange,
  isConstrained,
}: {
  styles: readonly { id: string; name: string; emoji: string; description: string; keywords: readonly string[] }[];
  styleId: string;
  onStyleSelect: (id: string) => void;
  gender: AvatarGender;
  onGenderSelect: (g: AvatarGender) => void;
  age: number | null;
  onAgeChange: (v: number | null) => void;
  hairColor: string | null;
  onHairColorChange: (v: string | null) => void;
  hairLength: string | null;
  onHairLengthChange: (v: string | null) => void;
  eyeColor: string | null;
  onEyeColorChange: (v: string | null) => void;
  vibe: string;
  onVibeChange: (v: string) => void;
  isConstrained: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Gender */}
      <Section title="Gender" subtitle="Required — shapes the portrait silhouette.">
        <div style={{ display: "flex", gap: 6 }}>
          {(["female", "male", "androgynous"] as AvatarGender[]).map((g) => (
            <SegBtn
              key={g}
              selected={gender === g}
              onClick={() => onGenderSelect(g)}
              label={g === "androgynous" ? "Androgynous" : g.charAt(0).toUpperCase() + g.slice(1)}
            />
          ))}
        </div>
      </Section>

      {/* Optional knobs */}
      <Section title="Appearance details" subtitle="Optional — leave blank to let the model choose.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <KnobField label="Age">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min={18}
                max={80}
                step={1}
                value={age ?? 35}
                onChange={(e) => onAgeChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: W.accent }}
              />
              <span style={{ fontSize: 11, color: W.text, minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {age === null ? "any" : `${age} yrs`}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: W.muted }}>18 – 80</span>
              <SmallToggle
                enabled={age !== null}
                onToggle={() => onAgeChange(age === null ? 35 : null)}
                onLabel="Clear"
                offLabel="Set age"
              />
            </div>
          </KnobField>
          <KnobField label="Hair color">
            <SelectBox value={hairColor} options={HAIR_COLORS} onChange={onHairColorChange} placeholder="Any" />
          </KnobField>
          <KnobField label="Hair length">
            <SelectBox value={hairLength} options={HAIR_LENGTHS} onChange={onHairLengthChange} placeholder="Any" />
          </KnobField>
          <KnobField label="Eye color">
            <SelectBox value={eyeColor} options={EYE_COLORS} onChange={onEyeColorChange} placeholder="Any" />
          </KnobField>
        </div>
        <div style={{ marginTop: 10 }}>
          <KnobField label="Vibe (free-form)">
            <textarea
              value={vibe}
              onChange={(e) => onVibeChange(e.target.value.slice(0, 140))}
              placeholder="e.g. confident, curious, slightly mischievous"
              rows={2}
              style={{
                width: "100%",
                resize: "vertical",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${W.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                color: W.text,
                fontSize: 12,
                fontFamily: "inherit",
              }}
            />
            <div style={{ fontSize: 10, color: W.muted, marginTop: 2, textAlign: "right" }}>
              {vibe.length}/140
            </div>
          </KnobField>
        </div>
      </Section>

      {/* Style grid */}
      <Section title="Visual style" subtitle="Required — frames the whole portrait.">
        {isConstrained && (
          <p style={{ fontSize: 11, color: W.textSec, margin: "0 0 8px" }}>
            <Palette size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            Company is in cohesive theme mode — styles are limited.
          </p>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          {styles.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onStyleSelect(preset.id)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: `1.5px solid ${styleId === preset.id ? W.accentBorder : W.border}`,
                background: styleId === preset.id ? W.accentDim : W.card,
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 15 }}>{preset.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: W.text }}>
                  {preset.name}
                </span>
                {styleId === preset.id && (
                  <Check size={12} style={{ color: W.accent, marginLeft: "auto" }} />
                )}
              </div>
              <div style={{ fontSize: 10.5, color: W.textSec, lineHeight: 1.3 }}>
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10.5, color: W.muted, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function KnobField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: W.textSec, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function SegBtn({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${selected ? W.accentBorder : W.border}`,
        background: selected ? W.accentDim : "rgba(255,255,255,0.03)",
        color: selected ? W.text : W.textSec,
        fontSize: 12,
        fontWeight: selected ? 600 : 500,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function SmallToggle({
  enabled,
  onToggle,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  onToggle: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        fontSize: 10,
        padding: "3px 8px",
        borderRadius: 10,
        border: `1px solid ${enabled ? W.accentBorder : W.border}`,
        background: enabled ? W.accentDim : "transparent",
        color: enabled ? W.text : W.muted,
        cursor: "pointer",
      }}
    >
      {enabled ? onLabel : offLabel}
    </button>
  );
}

function SelectBox({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string | null;
  options: readonly string[];
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      style={{
        width: "100%",
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${W.border}`,
        borderRadius: 8,
        padding: "7px 10px",
        color: value ? W.text : W.muted,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

/* ═══════════════════════════════════════════
   STEP: Voice
   ═══════════════════════════════════════════ */
function VoiceStep({
  voiceId,
  onSelect,
}: {
  voiceId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playSample = useCallback((preset: VoicePreset) => {
    setPreviewError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(`/api/voice/preview-sample?voiceId=${encodeURIComponent(preset.id)}`);
    audioRef.current = audio;
    setPlayingId(preset.id);
    audio.onended = () => setPlayingId((current) => (current === preset.id ? null : current));
    audio.onerror = () => {
      setPlayingId((current) => (current === preset.id ? null : current));
      setPreviewError(`Couldn't load ${preset.name} sample. Check that GEMINI_API_KEY is configured.`);
    };
    void audio.play().catch((err) => {
      setPlayingId((current) => (current === preset.id ? null : current));
      setPreviewError(err instanceof Error ? err.message : "Preview playback failed");
    });
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const groups = useMemo(() => {
    return {
      female: VOICE_CATALOG.filter((v) => v.perceivedGender === "female"),
      male: VOICE_CATALOG.filter((v) => v.perceivedGender === "male"),
      androgynous: VOICE_CATALOG.filter((v) => v.perceivedGender === "androgynous"),
    };
  }, []);

  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 6px" }}>
        Pick a voice for this agent. Used when you talk to them from a task.
      </p>
      <p style={{ fontSize: 10.5, color: W.muted, margin: "0 0 14px" }}>
        Click Preview to hear the real Gemini voice. The first preview for each voice takes a moment to generate, then caches.
      </p>
      {previewError && (
        <div style={{
          marginBottom: 12, padding: "8px 10px", borderRadius: 8,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 11, color: "#fca5a5",
        }}>
          {previewError}
        </div>
      )}

      {([
        { label: "Feminine", voices: groups.female },
        { label: "Masculine", voices: groups.male },
        { label: "Androgynous", voices: groups.androgynous },
      ] as const).map((group) => (
        <div key={group.label} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, color: W.textSec, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {group.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {group.voices.map((preset) => (
              <VoiceCard
                key={preset.id}
                preset={preset}
                selected={voiceId === preset.id}
                playing={playingId === preset.id}
                onSelect={() => onSelect(preset.id)}
                onPreview={() => playSample(preset)}
              />
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 4, display: "flex", justifyContent: "center" }}>
        <button
          onClick={() => onSelect(null)}
          style={{
            background: "transparent",
            border: `1px dashed ${W.border}`,
            borderRadius: 8,
            padding: "6px 14px",
            color: W.muted,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {voiceId === null ? "No voice selected" : "Clear voice selection"}
        </button>
      </div>
    </div>
  );
}

function VoiceCard({
  preset,
  selected,
  playing,
  onSelect,
  onPreview,
}: {
  preset: VoicePreset;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 10,
        border: `1.5px solid ${selected ? W.accentBorder : W.border}`,
        background: selected ? W.accentDim : W.card,
        padding: "10px 12px",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <button
        onClick={onSelect}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          color: "inherit",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <Volume2 size={13} style={{ color: selected ? W.accent : W.textSec }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: W.text }}>{preset.name}</span>
          {selected && <Check size={12} style={{ color: W.accent, marginLeft: "auto" }} />}
        </div>
        <div style={{ fontSize: 10.5, color: W.textSec, lineHeight: 1.35 }}>
          {preset.descriptor}
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onPreview(); }}
        style={{
          marginTop: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10.5,
          padding: "4px 10px",
          borderRadius: 12,
          background: playing ? W.accentDim : "rgba(255,255,255,0.04)",
          border: `1px solid ${playing ? W.accentBorder : W.border}`,
          color: playing ? W.text : W.textSec,
          cursor: "pointer",
        }}
      >
        {playing ? <Loader2 size={10} style={{ animation: "spin 1.1s linear infinite" }} /> : <Play size={10} />}
        {playing ? "Playing…" : "Preview"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   STEP: Preview
   ═══════════════════════════════════════════ */
function PreviewStep({
  previews,
  selectedIndex,
  onSelect,
  generating,
  onRegenerate,
  agentName,
  styleName,
  isAi,
  total,
}: {
  previews: string[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  generating: boolean;
  onRegenerate: () => void;
  agentName: string;
  styleName: string;
  isAi: boolean;
  total: number;
}) {
  const progressLabel = `${previews.length} of ${total} generated`;

  if (previews.length === 0 && !generating) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <ImageIcon size={32} style={{ color: W.muted, margin: "0 auto 12px" }} />
        <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 8px" }}>
          No previews generated yet.
        </p>
        <WizardBtn variant="primary" onClick={onRegenerate}>
          <Sparkles size={13} /> Generate
        </WizardBtn>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <div>
          <p style={{ fontSize: 13, color: W.textSec, margin: 0 }}>
            {generating
              ? `Generating portraits for ${agentName}…`
              : "Pick your favorite. Regenerate if you want another set."}
          </p>
          <p style={{ fontSize: 11, color: W.muted, margin: "4px 0 0" }}>
            Style: {styleName} · {progressLabel}
          </p>
        </div>
        <WizardBtn variant="ghost" onClick={onRegenerate}>
          <Sparkles size={11} /> Regenerate
        </WizardBtn>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const src = previews[i];
          return (
            <button
              key={i}
              onClick={() => src ? onSelect(i) : undefined}
              disabled={!src}
              style={{
                position: "relative",
                borderRadius: 12,
                border: `2px solid ${selectedIndex === i && src ? W.accent : W.border}`,
                background: src ? "transparent" : "linear-gradient(180deg, rgba(41,37,36,0.7), rgba(28,25,23,0.45))",
                cursor: src ? "pointer" : "default",
                overflow: "hidden",
                padding: 0,
                transition: "border-color 0.15s",
                aspectRatio: "1 / 1",
              }}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Preview ${i + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: W.muted }}>
                  <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                    {generating ? <Loader2 size={20} style={{ animation: "spin 1.1s linear infinite" }} /> : <ImageIcon size={20} />}
                    <span style={{ fontSize: 11 }}>{generating ? `Waiting on ${i + 1}` : `Slot ${i + 1}`}</span>
                  </div>
                </div>
              )}
              {selectedIndex === i && src && (
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "rgba(28,25,23,0.92)",
                    border: `1px solid ${W.accentBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Check size={14} style={{ color: "#fff" }} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 10, color: W.muted, margin: "10px 0 0", textAlign: "center" }}>
        {isAi ? "AI-generated avatars" : "Styled SVG avatars — add OPENAI_API_KEY via env or local keychain for AI generation"}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Shared button
   ═══════════════════════════════════════════ */
function WizardBtn({
  variant,
  children,
  onClick,
  disabled,
}: {
  variant: "primary" | "ghost";
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: isPrimary ? "7px 16px" : "6px 12px",
        borderRadius: 8,
        border: isPrimary ? "none" : `1px solid ${W.border}`,
        background: isPrimary ? W.accent : "transparent",
        color: isPrimary ? W.accentText : W.textSec,
        fontSize: 12,
        fontWeight: isPrimary ? 600 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {children}
    </button>
  );
}
