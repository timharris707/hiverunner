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
import { normalizeVoiceId, voicePresetById, voicesForGender, type VoicePreset } from "./voice-catalog";
import { normalizeAvatarWizardErrorMessage } from "@/lib/orchestration/avatar-wizard-errors";
import {
  normalizeAvatarPreviewResponse,
  normalizeAvatarProviderStatus,
  type AvatarProviderStatusView,
} from "@/lib/orchestration/avatar-wizard-data";
import { listCompanyAgents } from "@/lib/orchestration/client";

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
  saveMode?: "edit" | "draft";
  defaultSource?: AvatarSource;
  onDraftSaved?: (payload: AvatarWizardDraftPayload) => void;
  onSaved?: () => void;
}

export type AvatarWizardDraftPayload = {
  avatarStyleId?: string | null;
  avatarGender?: AvatarGender;
  avatarAge?: number | null;
  avatarHairColor?: string | null;
  avatarHairLength?: string | null;
  avatarEyeColor?: string | null;
  avatarVibe?: string | null;
  voiceId?: string | null;
  avatarSetupPending?: boolean;
  avatarUrl?: string | null;
  emoji?: string;
};

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
  bg: "linear-gradient(180deg, rgba(41,37,36,0.88), rgba(20,17,15,0.92))",
  card: "rgba(41,37,36,0.38)",
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
const VOICE_PREVIEW_CLIENT_VERSION = "voice-director-v13";
const DEFAULT_WIZARD_VOICE_ID = "Charon";

function voicePreviewUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const { protocol, hostname, port } = window.location;
  if (hostname === "127.0.0.1") return `${protocol}//localhost${port ? `:${port}` : ""}${path}`;
  return path;
}

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
  saveMode = "edit",
  defaultSource,
  onDraftSaved,
  onSaved,
}: AvatarWizardProps) {
  const [step, setStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<AvatarSource>("icon");
  const [selectedIcon, setSelectedIcon] = useState<string>(LUCIDE_ICON_OPTIONS[0]?.value ?? "bot");
  const [styleId, setStyleId] = useState<string>(initialStyleId ?? "cyber-organic");
  const [gender, setGender] = useState<AvatarGender>(initialGender ?? "androgynous");
  const [age, setAge] = useState<number | null>(initialAge ?? null);
  const [hairColor, setHairColor] = useState<string | null>(initialHairColor ?? null);
  const [hairLength, setHairLength] = useState<string | null>(initialHairLength ?? null);
  const [eyeColor, setEyeColor] = useState<string | null>(initialEyeColor ?? null);
  const [vibe, setVibe] = useState<string>(initialVibe ?? "");
  const [voiceId, setVoiceId] = useState<string | null>(normalizeVoiceId(initialVoiceId) ?? null);
  const savedVoiceId = useMemo(() => normalizeVoiceId(initialVoiceId) ?? null, [initialVoiceId]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setRestoredFromCache] = useState(false);
  const [providerStatus, setProviderStatus] = useState<AvatarProviderStatusView | null>(null);
  const hasStoredImageAvatar = Boolean(currentAvatar && !avatarIconToken(currentAvatar));
  const backdropRef = useRef<HTMLDivElement>(null);
  const generationRunRef = useRef(0);
  const wantsGeneratedFlowRef = useRef(false);
  const cachedSeedPreviewsRef = useRef<string[]>([]);
  /** Snapshot of identity params used for the most recent background-generation
   *  kickoff. If the user navigates back→forward without changing identity,
   *  we skip restarting and let the in-flight (or completed) work stand. */
  const lastBackgroundSnapshotRef = useRef<string | null>(null);
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

  // Voice → [agent names] map for the current company, excluding the agent
  // being edited. Surfaces a hint under each voice card so the operator can see which
  // voices are already in use and avoid accidental collisions across agents.
  const [voiceUsage, setVoiceUsage] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!open || !companySlug) return;
    let cancelled = false;
    (async () => {
      try {
        const agents = await listCompanyAgents(companySlug);
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        const currentAgentKeys = new Set(
          [agentId, alternateAgentKey]
            .filter((value): value is string => Boolean(value))
            .map((value) => value.toLowerCase()),
        );
        for (const a of agents) {
          const normalizedVoiceId = normalizeVoiceId(a.voiceId);
          if (!normalizedVoiceId) continue;
          if (
            currentAgentKeys.has(String(a.id ?? "").toLowerCase()) ||
            currentAgentKeys.has(String(a.slug ?? "").toLowerCase())
          ) {
            continue;
          }
          (map[normalizedVoiceId] ??= []).push(a.name);
        }
        setVoiceUsage(map);
      } catch {
        // Non-fatal: without the map, the wizard simply omits the hint.
      }
    })();
    return () => { cancelled = true; };
  }, [open, companySlug, agentId]);

  const isCompanyConstrained = avatarMode === "company_theme";

  const availableStyles = useMemo((): readonly { id: string; name: string; emoji: string; description: string; keywords: readonly string[]; isNew?: boolean }[] => {
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

  const setNormalizedVoiceId = useCallback((nextVoiceId: string | null) => {
    setVoiceId(normalizeVoiceId(nextVoiceId) ?? null);
  }, []);

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
    /** When true, run the generation loop without moving the user to the preview
     *  step. Used to overlap image generation with voice selection (E9 #2). */
    background?: boolean;
  }) => {
    const snapshot = identityRef.current;
    const seeded = [...(options?.seedPreviews ?? [])].slice(0, TARGET_PREVIEW_COUNT);
    const runId = ++generationRunRef.current;

    setSource("generated");
    if (!options?.background) {
      setStep("preview");
    }
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
        const data = normalizeAvatarPreviewResponse(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(normalizeAvatarWizardErrorMessage(data, `Failed to generate (${res.status})`));
        }
        const preview = data.previews?.[0];
        if (!preview) throw new Error(`Preview ${index + 1} did not return a valid image URL`);
        if (generationRunRef.current !== runId) return;
        nextPreviews.push(preview);
        setPreviews([...nextPreviews]);
        writeCache([...nextPreviews]);
      }
    } catch (err) {
      if (generationRunRef.current !== runId) return;
      setError(normalizeAvatarWizardErrorMessage(err, "Generation failed"));
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
      wantsGeneratedFlowRef.current = false;
      cachedSeedPreviewsRef.current = [];
      return;
    }
    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;
    // Reset cross-open refs so a fresh open never inherits stale state.
    lastBackgroundSnapshotRef.current = null;

    const cached = readAvatarDraftCache(agentId, alternateAgentKey);
    const cachedIdentity = saveMode === "draft" ? cached : null;
    const nextIcon = avatarIconToken(agentEmoji) ?? LUCIDE_ICON_OPTIONS[0]?.value ?? "bot";
    const nextStyleId = initialStyleId ?? cachedIdentity?.styleId ?? "cyber-organic";
    const nextGender = initialGender ?? (cachedIdentity?.gender as AvatarGender | undefined) ?? "androgynous";
    const cachedPreviews = cached?.previews ?? [];
    const cacheComplete = cachedPreviews.length >= TARGET_PREVIEW_COUNT;
    const wantsGeneratedFlow = hasStoredImageAvatar || cacheComplete || cachedPreviews.length > 0 || autoStart || pendingSetup || defaultSource === "generated";

    wantsGeneratedFlowRef.current = wantsGeneratedFlow;
    cachedSeedPreviewsRef.current = cachedPreviews;

    setSource(hasStoredImageAvatar || cacheComplete || cachedPreviews.length > 0 ? "generated" : "icon");
    setSelectedIcon(nextIcon);
    setStyleId(nextStyleId);
    setGender(nextGender);
    setAge(initialAge ?? cachedIdentity?.age ?? null);
    setHairColor(initialHairColor ?? cachedIdentity?.hairColor ?? null);
    setHairLength(initialHairLength ?? cachedIdentity?.hairLength ?? null);
    setEyeColor(initialEyeColor ?? cachedIdentity?.eyeColor ?? null);
    setVibe(initialVibe ?? cachedIdentity?.vibe ?? "");
    setVoiceId(savedVoiceId ?? normalizeVoiceId(cachedIdentity?.voiceId) ?? null);
    setGenerating(false);
    setSaving(false);
    setError(null);
    setProviderStatus(null);

    if (cacheComplete) {
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setStep("preview");
      setRestoredFromCache(true);
    } else if (cachedPreviews.length > 0 || autoStart || pendingSetup) {
      setPreviews(cachedPreviews);
      setSelectedPreview(0);
      setRestoredFromCache(false);
    } else {
      setPreviews([]);
      setSelectedPreview(0);
      setStep("source");
      setRestoredFromCache(false);
    }

    void (async () => {
      try {
        const response = await fetch("/api/orchestration/avatars/status");
        const data = await response.json().catch(() => ({}));
        setProviderStatus(normalizeAvatarProviderStatus(data));
      } catch {
        setProviderStatus(normalizeAvatarProviderStatus(null));
      }
    })();
    // Deliberately minimal deps: this must only fire on open transition, not
    // whenever an initial* prop or callback identity changes. The guard ref
    // plus `open` dependency is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || providerStatus === null) return;

    if (!providerStatus.aiAvailable) {
      if (
        wantsGeneratedFlowRef.current &&
        !hasStoredImageAvatar &&
        previews.length === 0 &&
        source === "generated"
      ) {
        setSource("icon");
      }
      return;
    }

    if (!wantsGeneratedFlowRef.current) return;

    if (source !== "generated") {
      setSource("generated");
    }

    if (previews.length < TARGET_PREVIEW_COUNT && !generating) {
      const seeded = cachedSeedPreviewsRef.current.slice(0, TARGET_PREVIEW_COUNT);
      void generatePreviews({ seedPreviews: seeded });
    }
  }, [generating, hasStoredImageAvatar, open, previews.length, providerStatus, source, generatePreviews]);

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
    // Politely cancel any in-flight generation loop so it stops scheduling more
    // requests once the user has chosen what they want.
    generationRunRef.current += 1;
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

      const selectedGeneratedAvatar = previews[selectedPreview];
      const shouldApplyGenerated = source === "generated" || (
        step === "preview" &&
        typeof selectedGeneratedAvatar === "string" &&
        selectedGeneratedAvatar.length > 0
      );

      if (shouldApplyGenerated) {
        if (!selectedGeneratedAvatar) throw new Error("Select a generated preview before applying the avatar.");
        payload.avatarUrl = selectedGeneratedAvatar;
      } else {
        payload.avatarUrl = null;
        payload.emoji = toAvatarIconToken(selectedIcon);
      }

      if (saveMode === "draft") {
        clearAvatarDraftCache(agentId);
        onDraftSaved?.(payload as AvatarWizardDraftPayload);
        onSaved?.();
        onClose();
        return;
      }

      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(normalizeAvatarWizardErrorMessage(body, `Save failed (${res.status})`));
      }

      clearAvatarDraftCache(agentId);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(normalizeAvatarWizardErrorMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  }, [agentId, age, companySlug, eyeColor, gender, hairColor, hairLength, onClose, onDraftSaved, onSaved, previews, saveMode, selectedIcon, selectedPreview, source, step, styleId, vibe, voiceId]);

  const goNext = () => {
    if (step === "source") {
      if (source === "icon") {
        void applyAvatar();
        return;
      }
      const hasGeneratedPreview = previews.some((preview) => typeof preview === "string" && preview.length > 0);
      if (providerStatus && !providerStatus.aiAvailable && !hasGeneratedPreview && !hasStoredImageAvatar) {
        setError(providerStatus.setupHint ?? "Generated portraits require an AI image provider.");
        return;
      }
      setStep("identity");
    } else if (step === "identity") {
      setStep("voice");
      // E9 #2: kick off image generation in the background so it overlaps with
      // the user's voice-selection time. Skip if we already started a run for
      // this exact identity snapshot (back→forward without changes).
      const snapshotKey = JSON.stringify(identityRef.current);
      if (lastBackgroundSnapshotRef.current !== snapshotKey) {
        lastBackgroundSnapshotRef.current = snapshotKey;
        void generatePreviews({ seedPreviews: [], background: true });
      }
    } else if (step === "voice") {
      setStep("preview");
      // Only kick off generation here as a fallback — the normal path is the
      // background run started on identity→voice. If that didn't start
      // (e.g. resumed from cache state) or failed silently, this catches it.
      if (previews.length === 0 && !generating) {
        void generatePreviews({ seedPreviews: [] });
      }
    }
  };

  const goBack = () => {
    if (step === "identity") setStep("source");
    else if (step === "voice") setStep("identity");
    else if (step === "preview") setStep("voice");
  };

  const goToStep = (target: WizardStep) => {
    setError(null);
    setStep(target);
    if (target === "preview" && source === "generated" && previews.length === 0 && !generating && providerStatus?.aiAvailable) {
      void generatePreviews({ seedPreviews: [] });
    } else if (target === "preview" && source === "generated" && previews.length === 0 && providerStatus && !providerStatus.aiAvailable) {
      setError(providerStatus.setupHint ?? "Generated portraits require an AI image provider.");
    }
  };

  if (!open) return null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const selectedGeneratedAvatar = previews[selectedPreview];
  const canApplyGeneratedAvatar =
    source !== "generated" ||
    (typeof selectedGeneratedAvatar === "string" && selectedGeneratedAvatar.length > 0);

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
        background: "rgba(41,37,36,0.08)",
        backdropFilter: "blur(8px)",
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
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
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
            type="button"
            onClick={onClose}
            aria-label="Close avatar wizard"
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
                <button
                  type="button"
                  onClick={() => goToStep(key)}
                  aria-current={i === stepIndex ? "step" : undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <span
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
                </button>
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
        <div className="avatar-wizard-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
          {step === "source" && (
            <SourceStep
              source={source}
              onSelect={setSource}
              selectedIcon={selectedIcon}
              onSelectIcon={setSelectedIcon}
              currentAvatar={currentAvatar}
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
                savedVoiceId={savedVoiceId}
                gender={gender}
                onSelect={setNormalizedVoiceId}
                voiceUsage={voiceUsage}
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
                disabled={saving || !canApplyGeneratedAvatar}
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
  providerStatus,
  pendingSetup,
}: {
  source: AvatarSource;
  onSelect: (s: AvatarSource) => void;
  selectedIcon: string;
  onSelectIcon: (value: string) => void;
  currentAvatar?: string;
  providerStatus: { provider: string; label: string; aiAvailable: boolean; setupHint?: string } | null;
  pendingSetup: boolean;
}) {
  const providerChecking = providerStatus === null;
  const aiAvailable = providerStatus?.aiAvailable ?? false;
  const sourceIconValue = toAvatarIconToken(selectedIcon);
  const currentAvatarIsIcon = avatarIconToken(currentAvatar);
  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 14px" }}>
        {pendingSetup
          ? "Portrait setup was started during agent creation. You can continue with the saved settings or switch back to the classic icon."
          : "Choose how this agent's avatar should look. Generated portraits are optional and only appear when an OpenAI image key is configured."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SourceCard
          selected={source === "icon"}
          onClick={() => onSelect("icon")}
          icon={
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <AvatarGlyph value={sourceIconValue} size={28} fallback={toAvatarIconToken("bot")} color={W.text} />
            </span>
          }
          title="Basic icon"
          description="Quick option — pick a Lucide glyph. No portrait generation."
        />
        <SourceCard
          selected={source === "generated"}
          disabled={!aiAvailable}
          onClick={() => aiAvailable ? onSelect("generated") : undefined}
          icon={<Sparkles size={28} style={{ color: W.textSec }} />}
          title="Generated portrait"
          description={
            providerChecking
              ? "Customize gender, style, age, hair, eyes, and vibe while the optional image provider is checked."
              : aiAvailable
              ? `Customize gender, style, age, hair, eyes, and vibe — ${providerStatus?.label ?? "AI"} generates a unique portrait.`
              : "Optional OpenAI image generation. Use a basic icon until it is configured."
          }
        />
      </div>
      {!aiAvailable && providerStatus?.setupHint && (
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
  disabled = false,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: `1.5px solid ${selected ? W.accentBorder : W.border}`,
        background: selected ? W.accentDim : W.card,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.72 : 1,
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
  styles: readonly { id: string; name: string; emoji: string; description: string; keywords: readonly string[]; isNew?: boolean }[];
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
  const selectedStyle = styles.find((style) => style.id === styleId);
  const genderCopy = gender === "androgynous" ? "Androgynous" : gender.charAt(0).toUpperCase() + gender.slice(1);
  const detailParts = [
    age ? `${age}` : null,
    hairColor,
    hairLength,
    eyeColor ? `${eyeColor} eyes` : null,
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        padding: "9px 10px",
        borderRadius: 8,
        background: "rgba(217,119,6,0.08)",
        border: "1px solid rgba(217,119,6,0.2)",
        color: "#fbbf24",
        fontSize: 11,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}>
        <span>
          Selected identity: <strong style={{ color: "#fde68a" }}>{genderCopy}</strong>
          {selectedStyle ? <> · <strong style={{ color: "#fde68a" }}>{selectedStyle.name}</strong></> : null}
        </span>
        <span style={{ color: W.textSec }}>
          {detailParts.length > 0 ? detailParts.join(" · ") : "Optional details can stay open"}
        </span>
      </div>

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
              type="button"
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
                {("isNew" in preset && preset.isNew) ? (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                    padding: "1px 6px", borderRadius: 8,
                    background: "rgba(245,158,11,0.18)", color: "#fbbf24",
                    border: "0.5px solid rgba(245,158,11,0.4)",
                    textTransform: "uppercase",
                  }}>
                    New
                  </span>
                ) : null}
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
      type="button"
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
      type="button"
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
  savedVoiceId,
  gender,
  onSelect,
  voiceUsage,
}: {
  voiceId: string | null;
  savedVoiceId: string | null;
  gender: AvatarGender;
  onSelect: (id: string | null) => void;
  voiceUsage: Record<string, string[]>;
}) {
  const [previewState, setPreviewState] = useState<{ voiceId: string; phase: "loading" | "playing" } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlCacheRef = useRef<Map<string, string>>(new Map());

  function previewSampleUrl(preset: VoicePreset, attempt: number): string {
    return voicePreviewUrl(
      `/api/voice/preview-sample?voiceId=${encodeURIComponent(preset.id)}&v=${VOICE_PREVIEW_CLIENT_VERSION}${attempt > 0 ? `&retry=${attempt}` : ""}`,
    );
  }

  async function readPreviewFailureMessage(sampleUrl: string, fallback: string): Promise<string> {
    const response = await fetch(sampleUrl, {
      headers: {
        Accept: "application/json",
      },
    }).catch(() => null);

    if (!response || response.ok) {
      return fallback;
    }

    const body = await response.json().catch(() => null);
    return normalizeAvatarWizardErrorMessage(body, fallback);
  }

  async function playSample(preset: VoicePreset, attempt: number = 0) {
    setPreviewError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPreviewState({ voiceId: preset.id, phase: "loading" });

    try {
      let sampleUrl = sampleUrlCacheRef.current.get(preset.id);
      if (!sampleUrl || attempt > 0) {
        sampleUrl = previewSampleUrl(preset, attempt);
        sampleUrlCacheRef.current.set(preset.id, sampleUrl);
      }

      const audio = new Audio(sampleUrl);
      audio.preload = "auto";
      audioRef.current = audio;
      audio.onended = () => setPreviewState((current) => (current?.voiceId === preset.id ? null : current));
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Preview took too long to start. Try again.")), 5_000);
        audio.onplaying = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        audio.onerror = async () => {
          window.clearTimeout(timeout);
          const message = await readPreviewFailureMessage(
            sampleUrl,
            `Couldn't play ${preset.name}. Try Preview again.`,
          );
          reject(new Error(message));
        };
        void audio.play().catch((error) => {
          window.clearTimeout(timeout);
          reject(error);
        });
      });
      setPreviewState({ voiceId: preset.id, phase: "playing" });
    } catch (err) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPreviewState((current) => (current?.voiceId === preset.id ? null : current));
      if (attempt < 1) {
        window.setTimeout(() => void playSample(preset, attempt + 1), 250);
        return;
      }
      const message = err instanceof TypeError && /fetch/i.test(err.message)
        ? "Couldn't reach the voice preview service. Try again in a moment."
        : normalizeAvatarWizardErrorMessage(err, "Preview playback failed");
      setPreviewError(message);
    }
  }

  useEffect(() => {
    const sampleUrlCache = sampleUrlCacheRef.current;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      sampleUrlCache.clear();
    };
  }, []);

  const filtered = useMemo(() => voicesForGender(gender), [gender]);
  const savedVoice = voicePresetById(savedVoiceId);
  const selectedVoice = voicePresetById(voiceId);
  const recommendedVoice = voicePresetById(DEFAULT_WIZARD_VOICE_ID);
  const selectedVoiceId = selectedVoice?.id ?? voiceId;
  const selectedVoiceChanged = Boolean(
    selectedVoiceId && savedVoice?.id && selectedVoiceId !== savedVoice.id,
  );

  const genderLabel =
    gender === "female" ? "feminine" : gender === "male" ? "masculine" : "all";

  // If the currently-selected voice falls outside the filter after a gender
  // switch, surface a quiet "it's hidden" note — don't clear it for the user.
  const selectedOutsideFilter = Boolean(
    voiceId && selectedVoiceId && !filtered.some((v) => v.id === selectedVoiceId)
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: W.textSec, margin: "0 0 6px" }}>
        Pick a voice for this agent. Used when you talk to them from a task.
      </p>
      <p style={{ fontSize: 10.5, color: W.muted, margin: "0 0 14px" }}>
        Showing {filtered.length} {genderLabel} voices. Click Preview to hear a live voice sample — the first play generates the sample and caches.
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
      {(savedVoice || selectedVoice || recommendedVoice) && (
        <div style={{
          marginBottom: 12,
          padding: "9px 10px",
          borderRadius: 8,
          background: "rgba(217,119,6,0.1)",
          border: "1px solid rgba(217,119,6,0.28)",
          color: "#fbbf24",
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}>
          {savedVoice && selectedVoiceChanged ? (
            <span>
              Selected voice: <strong style={{ color: "#fde68a" }}>{selectedVoice?.name}</strong>
            </span>
          ) : savedVoice && !selectedVoice ? (
            <span>
              Voice will be cleared. <strong style={{ color: "#fde68a" }}>Apply Avatar</strong> to save that change.
            </span>
          ) : savedVoice ? (
            <span>
              Current voice: <strong style={{ color: "#fde68a" }}>{savedVoice.name}</strong>
            </span>
          ) : selectedVoice ? (
            <span>
              Selected voice: <strong style={{ color: "#fde68a" }}>{selectedVoice.name}</strong>
            </span>
          ) : (
            <span>
              No voice saved yet.
            </span>
          )}
          <span style={{ color: W.textSec }}>
            {savedVoice && selectedVoiceChanged
              ? `Current saved: ${savedVoice.name}. Apply Avatar to switch.`
              : savedVoice
                ? `${savedVoice.style} · ${savedVoice.pace}`
                : selectedVoice
                  ? "Apply Avatar to save this voice for the agent"
                  : recommendedVoice
                    ? `Recommended default: ${recommendedVoice.name}`
                    : "Pick a voice and apply it to save"}
          </span>
        </div>
      )}
      {selectedOutsideFilter && (
        <div style={{
          marginBottom: 12, padding: "8px 10px", borderRadius: 8,
          background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.22)",
          fontSize: 11, color: "#fbbf24",
        }}>
          The previously-selected voice doesn&apos;t match this agent&apos;s gender. Pick a new one below, or go back and change gender to keep the old voice.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {filtered.map((preset) => (
          <VoiceCard
            key={preset.id}
            preset={preset}
            selected={selectedVoiceId === preset.id}
            selectedLabel={savedVoice?.id === preset.id ? "Current" : "Selected"}
            previewPhase={previewState?.voiceId === preset.id ? previewState.phase : null}
            onSelect={() => onSelect(preset.id)}
            onPreview={() => playSample(preset)}
            inUseBy={voiceUsage[preset.id] ?? []}
          />
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
        <button
          type="button"
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
  selectedLabel,
  previewPhase,
  onSelect,
  onPreview,
  inUseBy,
}: {
  preset: VoicePreset;
  selected: boolean;
  selectedLabel: string;
  previewPhase: "loading" | "playing" | null;
  onSelect: () => void;
  onPreview: () => void;
  inUseBy: string[];
}) {
  const usageInline = inUseBy.length > 0 ? `(${inUseBy.join(", ")})` : null;
  const isPreviewing = previewPhase !== null;
  const selectedBorder = "rgba(245,158,11,0.75)";
  const selectedBackground = "linear-gradient(180deg, rgba(120,53,15,0.34), rgba(41,37,36,0.52))";
  return (
    <div
      data-testid={`voice-card-${preset.id}`}
      style={{
        position: "relative",
        borderRadius: 10,
        border: `1.5px solid ${selected ? selectedBorder : W.border}`,
        background: selected ? selectedBackground : W.card,
        boxShadow: selected ? "0 0 0 1px rgba(245,158,11,0.16), 0 10px 28px rgba(120,53,15,0.18)" : "none",
        padding: "10px 12px",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
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
          <Volume2 size={13} style={{ color: selected ? "#f59e0b" : W.textSec }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: W.text }}>
            {preset.name}
            {usageInline && (
              <span style={{ fontWeight: 400, color: W.muted, marginLeft: 6 }}>{usageInline}</span>
            )}
          </span>
          {selected && (
            <span style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 999,
              border: "1px solid rgba(245,158,11,0.42)",
              background: "rgba(245,158,11,0.14)",
              color: "#fbbf24",
              padding: "3px 7px",
              fontSize: 9.5,
              fontWeight: 700,
              lineHeight: 1,
            }}>
              <Check size={10} />
              {selectedLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: W.textSec, lineHeight: 1.35 }}>
          {preset.descriptor}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
            marginTop: 7,
          }}
        >
          {[preset.style, preset.pace, preset.accent].map((tag) => (
            <span
              key={tag}
              style={{
                borderRadius: 999,
                border: `1px solid ${W.border}`,
                background: "rgba(255,255,255,0.035)",
                color: W.textSec,
                fontSize: 9.5,
                lineHeight: 1,
                padding: "4px 6px",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </button>
      <button
        type="button"
        data-testid={`voice-preview-${preset.id}`}
        onClick={(e) => { e.stopPropagation(); onPreview(); }}
        disabled={previewPhase === "loading"}
        style={{
          marginTop: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10.5,
          padding: "4px 10px",
          borderRadius: 12,
          background: isPreviewing ? W.accentDim : "rgba(255,255,255,0.04)",
          border: `1px solid ${selected ? "rgba(245,158,11,0.38)" : isPreviewing ? W.accentBorder : W.border}`,
          color: selected ? "#fbbf24" : isPreviewing ? W.text : W.textSec,
          cursor: previewPhase === "loading" ? "wait" : "pointer",
        }}
      >
        {isPreviewing ? <Loader2 size={10} style={{ animation: "spin 1.1s linear infinite" }} /> : <Play size={10} />}
        {previewPhase === "loading" ? "Generating…" : previewPhase === "playing" ? "Playing…" : "Preview"}
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
            {generating && previews.length === 0
              ? `Generating portraits for ${agentName}…`
              : generating
                ? `Generating more — pick one and Apply any time, or wait for the rest.`
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
              type="button"
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
        {isAi ? "AI-generated avatars" : "Generated portraits require OpenAI image generation"}
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
      type="button"
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
