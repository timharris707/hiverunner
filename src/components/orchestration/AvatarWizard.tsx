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
  User,
  Image as ImageIcon,
  Wand2,
} from "lucide-react";
import { AVATAR_THEME_PRESETS } from "./avatar-theme-data";
import { clearAvatarDraftCache, readAvatarDraftCache, writeAvatarDraftCache } from "./avatar-draft-storage";

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
  /** Optional alternate cache key (e.g., route param like slug) for draft migration */
  alternateAgentKey?: string;
  avatarMode?: "company_theme" | "mixed";
  companyThemeName?: string;
  initialStyleId?: string;
  initialGender?: AvatarGender;
  autoStart?: boolean;
  pendingSetup?: boolean;
  /** Called after avatar is saved. */
  onSaved: () => void;
}

type WizardStep = "source" | "style" | "gender" | "preview";

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
  autoStart = false,
  pendingSetup = false,
  onSaved,
}: AvatarWizardProps) {
  const [step, setStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<AvatarSource>("generated");
  const [styleId, setStyleId] = useState<string>(initialStyleId ?? "cyberpunk");
  const [gender, setGender] = useState<AvatarGender>(initialGender ?? "androgynous");
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{
    provider: string; label: string; aiAvailable: boolean; setupHint?: string;
  } | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const generationRunRef = useRef(0);
  const styleIdRef = useRef(styleId);
  const genderRef = useRef(gender);

  const isCompanyConstrained = avatarMode === "company_theme";

  // Filter styles for company_theme mode
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
    styleIdRef.current = styleId;
  }, [styleId]);

  useEffect(() => {
    genderRef.current = gender;
  }, [gender]);

  const generatePreviews = useCallback(async (options?: {
    seedPreviews?: string[];
    styleIdOverride?: string;
    genderOverride?: AvatarGender;
  }) => {
    const nextStyleId = options?.styleIdOverride ?? styleIdRef.current;
    const nextGender = options?.genderOverride ?? genderRef.current;
    const seeded = [...(options?.seedPreviews ?? [])].slice(0, TARGET_PREVIEW_COUNT);
    const runId = ++generationRunRef.current;

    setStep("preview");
    setGenerating(true);
    setError(null);
    setPreviews([...seeded]);
    setSelectedPreview(0);

    writeAvatarDraftCache(agentId, {
      styleId: nextStyleId,
      gender: nextGender,
      previews: seeded,
      updatedAt: Date.now(),
    }, alternateAgentKey);

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
            styleId: nextStyleId,
            gender: nextGender,
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
        writeAvatarDraftCache(agentId, {
          styleId: nextStyleId,
          gender: nextGender,
          previews: [...nextPreviews],
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      if (generationRunRef.current !== runId) return;
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      if (generationRunRef.current === runId) {
        setGenerating(false);
      }
    }
  }, [agentEmoji, agentId, agentName, agentPersonality, agentRole]);

  // Reset state + fetch provider status when opened
  useEffect(() => {
    if (!open) return;

    const cached = readAvatarDraftCache(agentId, alternateAgentKey);
    const nextStyleId = initialStyleId ?? cached?.styleId ?? "cyberpunk";
    const nextGender = initialGender ?? (cached?.gender as AvatarGender | undefined) ?? "androgynous";
    const cachedPreviews = cached?.previews ?? [];
    const cacheComplete = cachedPreviews.length >= TARGET_PREVIEW_COUNT;

    setSource("generated");
    setStyleId(nextStyleId);
    setGender(nextGender);
    setGenerating(false);
    setSaving(false);
    setError(null);

    if (cacheComplete) {
      // All previews already cached — skip generation entirely
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setStep("preview");
      setRestoredFromCache(true);
    } else if (cachedPreviews.length > 0 || autoStart || pendingSetup) {
      // Partial cache or auto-start — resume generation with seeds
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setRestoredFromCache(false);
      void generatePreviews({
        seedPreviews: cachedPreviews,
        styleIdOverride: nextStyleId,
        genderOverride: nextGender,
      });
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
  }, [open, agentId, autoStart, generatePreviews, initialGender, initialStyleId, pendingSetup]);

  // Do NOT close on Escape for this wizard — avoid accidental loss of work
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // swallow Escape, do nothing
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Apply selected avatar
  const applyAvatar = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let avatarUrl: string | null;

      if (source === "icon") {
        avatarUrl = null;
      } else {
        avatarUrl = previews[selectedPreview];
        if (!avatarUrl) throw new Error("No preview selected");
      }

      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avatarUrl,
            avatarStyleId: styleId,
            avatarGender: gender,
            avatarSetupPending: false,
          }),
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
  }, [agentId, companySlug, gender, onClose, onSaved, previews, selectedPreview, source, styleId]);

  // Navigation
  const goNext = () => {
    if (step === "source") {
      if (source === "icon") {
        void applyAvatar();
        return;
      }
      setStep("style");
    } else if (step === "style") {
      setStep("gender");
    } else if (step === "gender") {
      setStep("preview");
      void generatePreviews({ seedPreviews: [] });
    }
  };

  const goBack = () => {
    if (step === "style") setStep("source");
    else if (step === "gender") setStep("style");
    else if (step === "preview") setStep("gender");
  };

  if (!open) return null;

  const stepIndex = ["source", "style", "gender", "preview"].indexOf(step);

  return (
    <div
      ref={backdropRef}
      // Prevent accidental close on backdrop clicks for this wizard
      onClick={(e) => { /* no-op to avoid losing work */ }}
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
        // Stop propagation so clicks inside modal don't reach the backdrop
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxHeight: "85vh",
          borderRadius: 16,
          background: W.bg,
          border: `1px solid ${W.border}`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Header ── */}
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

        {/* ── Progress dots ── */}
        <div style={{ display: "flex", gap: 6, padding: "12px 20px 8px", alignItems: "center" }}>
          {["Source", "Style", "Gender", "Preview"].map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              {i < 3 && (
                <div
                  style={{
                    width: 20,
                    height: 1,
                    background: i < stepIndex ? W.accent : W.border,
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
          {step === "source" && (
            <SourceStep
              source={source}
              onSelect={setSource}
              currentAvatar={currentAvatar}
              agentEmoji={agentEmoji}
              providerStatus={providerStatus}
              pendingSetup={pendingSetup}
            />
          )}
          {step === "style" && (
            <StyleStep
              styles={availableStyles}
              selected={styleId}
              onSelect={setStyleId}
              isConstrained={isCompanyConstrained}
            />
          )}
          {step === "gender" && (
            <GenderStep selected={gender} onSelect={setGender} />
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

        {/* ── Error ── */}
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

        {/* ── Footer ── */}
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
                    <Check size={13} /> Reset to Icon
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
  currentAvatar,
  agentEmoji,
  providerStatus,
  pendingSetup,
}: {
  source: AvatarSource;
  onSelect: (s: AvatarSource) => void;
  currentAvatar?: string;
  agentEmoji: string;
  providerStatus: { provider: string; label: string; aiAvailable: boolean; setupHint?: string } | null;
  pendingSetup: boolean;
}) {
  const aiAvailable = providerStatus?.aiAvailable ?? false;
  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 14px" }}>
        {pendingSetup
          ? "Portrait setup was started during agent creation. You can continue from the saved settings or switch back to the classic icon."
          : "Choose how this agent&apos;s avatar should look."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SourceCard
          selected={source === "icon"}
          onClick={() => onSelect("icon")}
          icon={
            <span style={{ fontSize: 28 }}>{agentEmoji || "🤖"}</span>
          }
          title="Default Icon"
          description="Use the current Lucide icon or emoji. Clean and minimal."
        />
        <SourceCard
          selected={source === "generated"}
          onClick={() => onSelect("generated")}
          icon={<Sparkles size={28} style={{ color: W.textSec }} />}
          title={aiAvailable ? "AI-Generated Avatar" : "Styled Avatar"}
          description={
            aiAvailable
              ? `Generate a unique portrait via ${providerStatus?.label ?? "AI"}. Choose style and gender.`
              : "Generate a styled SVG portrait. Choose a visual style and gender."
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
      {currentAvatar && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: W.muted }}>Current avatar:</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
   STEP: Style
   ═══════════════════════════════════════════ */
function StyleStep({
  styles,
  selected,
  onSelect,
  isConstrained,
}: {
  styles: readonly { id: string; name: string; emoji: string; description: string; keywords: readonly string[] }[];
  selected: string;
  onSelect: (id: string) => void;
  isConstrained: boolean;
}) {
  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 4px" }}>
        Select a visual style for the avatar.
      </p>
      {isConstrained && (
        <p style={{ fontSize: 11, color: W.textSec, margin: "0 0 12px" }}>
          <Palette size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          Company is in cohesive theme mode — styles are limited for visual consistency.
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
            onClick={() => onSelect(preset.id)}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: `1.5px solid ${selected === preset.id ? W.accentBorder : W.border}`,
              background: selected === preset.id ? W.accentDim : W.card,
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 16 }}>{preset.emoji}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: W.text }}>
                {preset.name}
              </span>
              {selected === preset.id && (
                <Check size={13} style={{ color: W.accent, marginLeft: "auto" }} />
              )}
            </div>
            <div style={{ fontSize: 11, color: W.textSec, lineHeight: 1.3 }}>
              {preset.description}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              {preset.keywords.slice(0, 3).map((kw) => (
                <span
                  key={kw}
                  style={{
                    fontSize: 9,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.04)",
                    color: W.muted,
                    border: `1px solid rgba(255,255,255,0.05)`,
                  }}
                >
                  {kw}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   STEP: Gender
   ═══════════════════════════════════════════ */
function GenderStep({
  selected,
  onSelect,
}: {
  selected: AvatarGender;
  onSelect: (g: AvatarGender) => void;
}) {
  const options: { id: AvatarGender; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: "male",
      label: "Male",
      icon: <User size={22} style={{ color: W.textSec }} />,
      desc: "Masculine features and presentation",
    },
    {
      id: "female",
      label: "Female",
      icon: <User size={22} style={{ color: W.textSec }} />,
      desc: "Feminine features and presentation",
    },
    {
      id: "androgynous",
      label: "Abstract / Androgynous",
      icon: <Sparkles size={22} style={{ color: W.textSec }} />,
      desc: "Gender-neutral or abstract entity appearance",
    },
  ];

  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 14px" }}>
        Choose the avatar&apos;s appearance style.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              borderRadius: 10,
              border: `1.5px solid ${selected === opt.id ? W.accentBorder : W.border}`,
              background: selected === opt.id ? W.accentDim : W.card,
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.04)",
                flexShrink: 0,
              }}
            >
              {opt.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: W.text }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: W.textSec }}>{opt.desc}</div>
            </div>
            {selected === opt.id && (
              <Check size={16} style={{ color: W.accent, flexShrink: 0 }} />
            )}
          </button>
        ))}
      </div>
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
