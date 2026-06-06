"use client";

import { Bot, Grip, Maximize2, Minus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { color, P, radius, space, type as T } from "@/lib/ui/tokens";
import { useOverseerCompanyRoute, type OverseerCompanyRoute } from "@/components/overseer/overseer-route";

type OverseerFloatingFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverseerFloatingShellState = OverseerFloatingFrame & {
  open: boolean;
  minimized: boolean;
};

type OverseerFloatingShellContentState = {
  companyParam: string;
  route: OverseerCompanyRoute;
  isMobile: boolean;
  close: () => void;
  minimize: () => void;
};

type OverseerFloatingShellProps = {
  children?: ReactNode | ((state: OverseerFloatingShellContentState) => ReactNode);
  title?: string;
  headerActions?: ReactNode;
};

const STORAGE_VERSION = "v1";
const STORAGE_PREFIX = `hr:overseer:floating-shell:${STORAGE_VERSION}`;
const DESKTOP_BREAKPOINT = 768;
const DESKTOP_MARGIN = 16;
const DEFAULT_WIDTH = 430;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 420;
const MAX_WIDTH = 720;
const MAX_HEIGHT = 760;
const MOBILE_TOP_OFFSET = 48;

function storageKey(companyKey: string): string {
  return `${STORAGE_PREFIX}:${companyKey}`;
}

function viewportSize() {
  return {
    width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function defaultFrame(): OverseerFloatingFrame {
  const viewport = viewportSize();
  const width = clamp(DEFAULT_WIDTH, MIN_WIDTH, Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewport.width - DESKTOP_MARGIN * 2)));
  const height = clamp(DEFAULT_HEIGHT, MIN_HEIGHT, Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, viewport.height - DESKTOP_MARGIN * 2)));

  return {
    width,
    height,
    x: Math.max(DESKTOP_MARGIN, viewport.width - width - 18),
    y: Math.max(DESKTOP_MARGIN, viewport.height - height - 18),
  };
}

function clampFrame(frame: OverseerFloatingFrame): OverseerFloatingFrame {
  const viewport = viewportSize();
  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewport.width - DESKTOP_MARGIN * 2));
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, viewport.height - DESKTOP_MARGIN * 2));
  const width = clamp(frame.width, MIN_WIDTH, maxWidth);
  const height = clamp(frame.height, MIN_HEIGHT, maxHeight);
  const maxX = Math.max(DESKTOP_MARGIN, viewport.width - width - DESKTOP_MARGIN);
  const maxY = Math.max(DESKTOP_MARGIN, viewport.height - height - DESKTOP_MARGIN);

  return {
    width,
    height,
    x: clamp(frame.x, DESKTOP_MARGIN, maxX),
    y: clamp(frame.y, DESKTOP_MARGIN, maxY),
  };
}

function isStoredShellState(value: unknown): value is Partial<OverseerFloatingShellState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const numbersValid = ["x", "y", "width", "height"].every((key) => (
    record[key] === undefined || (typeof record[key] === "number" && Number.isFinite(record[key]))
  ));
  return numbersValid
    && (record.open === undefined || typeof record.open === "boolean")
    && (record.minimized === undefined || typeof record.minimized === "boolean");
}

function loadShellState(companyKey: string): OverseerFloatingShellState {
  const fallback = { ...defaultFrame(), open: false, minimized: false };

  try {
    const raw = window.localStorage.getItem(storageKey(companyKey));
    if (!raw) return fallback;

    const parsed: unknown = JSON.parse(raw);
    if (!isStoredShellState(parsed)) return fallback;

    const frame = clampFrame({
      x: parsed.x ?? fallback.x,
      y: parsed.y ?? fallback.y,
      width: parsed.width ?? fallback.width,
      height: parsed.height ?? fallback.height,
    });

    return {
      ...frame,
      open: parsed.open ?? false,
      minimized: parsed.minimized ?? false,
    };
  } catch {
    return fallback;
  }
}

function persistShellState(companyKey: string, state: OverseerFloatingShellState): void {
  try {
    window.localStorage.setItem(storageKey(companyKey), JSON.stringify(state));
  } catch {
    // This shell is non-critical UI. Private browsing or full storage should not break the page.
  }
}

function renderContent(
  children: OverseerFloatingShellProps["children"],
  state: OverseerFloatingShellContentState,
): ReactNode {
  if (typeof children === "function") return children(state);
  if (children !== undefined) return children;

  return (
    <div
      style={{
        minHeight: 220,
        display: "grid",
        placeItems: "center",
        padding: space.lg,
        borderRadius: radius.md,
        border: `0.5px dashed ${color.border}`,
        color: color.textMuted,
        fontSize: T.bodySmall.size,
        textAlign: "center",
      }}
    >
      Compact Overseer content mounts here.
    </div>
  );
}

export function OverseerFloatingShell({
  children,
  title = "Overseer",
  headerActions,
}: OverseerFloatingShellProps) {
  const route = useOverseerCompanyRoute();
  const [isReady, setIsReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [loadedCompanyKey, setLoadedCompanyKey] = useState("");
  const [shellState, setShellState] = useState<OverseerFloatingShellState | null>(null);
  const activeInteractionRef = useRef<{
    mode: "drag" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    frame: OverseerFloatingFrame;
  } | null>(null);
  const interactionCleanupRef = useRef<(() => void) | null>(null);

  const companyKey = route?.storageCompanyKey ?? "";

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < DESKTOP_BREAKPOINT);
    const readyFrame = window.requestAnimationFrame(() => {
      checkMobile();
      setIsReady(true);
    });
    window.addEventListener("resize", checkMobile);
    return () => {
      window.cancelAnimationFrame(readyFrame);
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  useEffect(() => {
    const loadFrame = window.requestAnimationFrame(() => {
      if (!companyKey) {
        setLoadedCompanyKey("");
        setShellState(null);
        return;
      }

      setShellState(loadShellState(companyKey));
      setLoadedCompanyKey(companyKey);
    });

    return () => window.cancelAnimationFrame(loadFrame);
  }, [companyKey]);

  useEffect(() => {
    if (!companyKey || loadedCompanyKey !== companyKey || !shellState) return;
    persistShellState(companyKey, shellState);
  }, [companyKey, loadedCompanyKey, shellState]);

  useEffect(() => {
    if (!shellState || isMobile) return;

    const handleResize = () => {
      setShellState((current) => {
        if (!current) return current;
        const frame = clampFrame(current);
        if (
          frame.x === current.x
          && frame.y === current.y
          && frame.width === current.width
          && frame.height === current.height
        ) {
          return current;
        }
        return { ...current, ...frame };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile, shellState]);

  useEffect(() => {
    if (!shellState?.open || shellState.minimized) return undefined;
    if (!isMobile) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [isMobile, shellState?.minimized, shellState?.open]);

  const patchState = useCallback((patch: Partial<OverseerFloatingShellState>) => {
    setShellState((current) => {
      const base = current ?? { ...defaultFrame(), open: false, minimized: false };
      const next = { ...base, ...patch };
      return isMobile ? next : { ...next, ...clampFrame(next) };
    });
  }, [isMobile]);

  const openShell = useCallback(() => {
    patchState({ open: true, minimized: false });
  }, [patchState]);

  const closeShell = useCallback(() => {
    patchState({ open: false, minimized: false });
  }, [patchState]);

  const minimizeShell = useCallback(() => {
    patchState({ open: true, minimized: true });
  }, [patchState]);

  const restoreShell = useCallback(() => {
    patchState({ open: true, minimized: false });
  }, [patchState]);

  const beginInteraction = useCallback((
    mode: "drag" | "resize",
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (isMobile || !shellState) return;
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionCleanupRef.current?.();
    activeInteractionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame: {
        x: shellState.x,
        y: shellState.y,
        width: shellState.width,
        height: shellState.height,
      },
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = mode === "drag" ? "grabbing" : "nwse-resize";
    document.body.style.userSelect = "none";

    const cleanupInteraction = () => {
      activeInteractionRef.current = null;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
      interactionCleanupRef.current = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const active = activeInteractionRef.current;
      if (!active || active.pointerId !== moveEvent.pointerId) return;

      const dx = moveEvent.clientX - active.startX;
      const dy = moveEvent.clientY - active.startY;
      const nextFrame = active.mode === "drag"
        ? clampFrame({
            ...active.frame,
            x: active.frame.x + dx,
            y: active.frame.y + dy,
          })
        : clampFrame({
            ...active.frame,
            width: active.frame.width + dx,
            height: active.frame.height + dy,
          });

      setShellState((current) => current ? { ...current, ...nextFrame } : current);
    };

    const endInteraction = (endEvent: PointerEvent) => {
      const active = activeInteractionRef.current;
      if (!active || active.pointerId !== endEvent.pointerId) return;

      cleanupInteraction();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
    interactionCleanupRef.current = cleanupInteraction;
  }, [isMobile, shellState]);

  useEffect(() => {
    return () => {
      interactionCleanupRef.current?.();
    };
  }, []);

  const contentState = useMemo<OverseerFloatingShellContentState | null>(() => {
    if (!route) return null;
    return {
      companyParam: route.companyParam,
      route,
      isMobile,
      close: closeShell,
      minimize: minimizeShell,
    };
  }, [closeShell, isMobile, minimizeShell, route]);

  if (
    !isReady
    || !route
    || route.isFullOverseerRoute
    || loadedCompanyKey !== companyKey
    || !shellState
    || !contentState
  ) {
    return null;
  }

  if (!shellState.open) {
    return (
      <aside aria-label="Overseer launcher" style={launcherHostStyle(isMobile)}>
        <button
          type="button"
          data-testid="floating-overseer-launcher"
          onClick={openShell}
          aria-label="Open Overseer"
          style={launcherButtonStyle}
        >
          <Bot size={15} strokeWidth={2.1} />
          <span>Overseer</span>
        </button>
      </aside>
    );
  }

  if (isMobile && shellState.minimized) {
    return (
      <aside aria-label="Overseer launcher" style={launcherHostStyle(true)}>
        <button
          type="button"
          data-testid="floating-overseer-launcher"
          onClick={restoreShell}
          aria-label="Restore Overseer"
          style={launcherButtonStyle}
        >
          <Bot size={15} strokeWidth={2.1} />
          <span>Overseer</span>
        </button>
      </aside>
    );
  }

  if (isMobile) {
    return (
      <aside
        aria-label="Overseer"
        data-company-slug={route.storageCompanyKey}
        data-testid="floating-overseer-sheet"
        style={mobileSheetStyle}
      >
        <ShellHeader
          title={title}
          dragHandle={false}
          headerActions={headerActions}
          onMinimize={minimizeShell}
          onClose={closeShell}
        />
        <div style={mobileBodyStyle}>
          {renderContent(children, contentState)}
        </div>
      </aside>
    );
  }

  if (shellState.minimized) {
    return (
      <aside
        aria-label="Overseer minimized"
        data-company-slug={route.storageCompanyKey}
        style={{
          ...minimizedShellStyle,
          left: shellState.x,
          top: shellState.y,
          width: Math.min(shellState.width, 360),
        }}
      >
        <button
          type="button"
          data-testid="floating-overseer-drag-handle"
          onPointerDown={(event) => beginInteraction("drag", event)}
          onDoubleClick={restoreShell}
          style={minimizedDragButtonStyle}
          aria-label="Drag minimized Overseer"
          title="Drag Overseer"
        >
          <Grip size={14} strokeWidth={2} color={color.textMuted} />
          <Bot size={14} strokeWidth={2.1} />
          <span>Overseer</span>
        </button>
        <button type="button" onClick={restoreShell} aria-label="Restore Overseer" title="Restore Overseer" style={iconButtonStyle}>
          <Maximize2 size={14} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          data-testid="floating-overseer-close"
          onClick={closeShell}
          aria-label="Close Overseer"
          title="Close Overseer"
          style={iconButtonStyle}
        >
          <X size={14} strokeWidth={2.1} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Overseer"
      data-company-slug={route.storageCompanyKey}
      data-testid="floating-overseer-panel"
      style={{
        ...desktopShellStyle,
        left: shellState.x,
        top: shellState.y,
        width: shellState.width,
        height: shellState.height,
      }}
    >
      <ShellHeader
        title={title}
        dragHandle
        headerActions={headerActions}
        onDragStart={(event) => beginInteraction("drag", event)}
        onMinimize={minimizeShell}
        onClose={closeShell}
      />
      <div style={desktopBodyStyle}>
        {renderContent(children, contentState)}
      </div>
      <button
        type="button"
        data-testid="floating-overseer-resize-handle"
        aria-label="Resize Overseer"
        title="Resize Overseer"
        onPointerDown={(event) => beginInteraction("resize", event)}
        style={resizeHandleStyle}
      >
        <Grip size={13} strokeWidth={2} color={color.textMuted} style={{ transform: "rotate(-45deg)" }} />
      </button>
    </aside>
  );
}

function ShellHeader({
  title,
  dragHandle,
  headerActions,
  onDragStart,
  onMinimize,
  onClose,
}: {
  title: string;
  dragHandle: boolean;
  headerActions?: ReactNode;
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <header style={headerStyle}>
      <button
        type="button"
        data-testid={dragHandle ? "floating-overseer-drag-handle" : undefined}
        onPointerDown={onDragStart}
        aria-label={dragHandle ? "Drag Overseer" : undefined}
        style={{
          ...headerHandleStyle,
          cursor: dragHandle ? "grab" : "default",
        }}
      >
        {dragHandle ? <Grip size={14} strokeWidth={2} color={color.textMuted} /> : null}
        <span style={headerIconStyle}>
          <Bot size={14} strokeWidth={2.1} />
        </span>
        <span style={headerTitleStyle}>{title}</span>
      </button>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {headerActions}
        <button type="button" onClick={onMinimize} aria-label="Minimize Overseer" title="Minimize Overseer" style={iconButtonStyle}>
          <Minus size={14} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          data-testid="floating-overseer-close"
          onClick={onClose}
          aria-label="Close Overseer"
          title="Close Overseer"
          style={iconButtonStyle}
        >
          <X size={14} strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}

function launcherHostStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    right: isMobile ? 12 : 18,
    bottom: isMobile ? 74 : 18,
    zIndex: 48,
    color: P.text,
    fontFamily: "var(--font-body)",
  };
}

const launcherButtonStyle: CSSProperties = {
  minHeight: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 11px",
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: color.surfaceElevated,
  color: color.text,
  boxShadow: "0 12px 34px rgba(0, 0, 0, 0.28)",
  cursor: "pointer",
  fontSize: T.bodySmall.size,
  fontWeight: 650,
};

const desktopShellStyle: CSSProperties = {
  position: "fixed",
  zIndex: 48,
  display: "grid",
  gridTemplateRows: "42px minmax(0, 1fr)",
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  overflow: "hidden",
  borderRadius: radius.lg,
  border: `0.5px solid ${color.border}`,
  background: color.surface,
  color: color.text,
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.36)",
  fontFamily: "var(--font-body)",
};

const minimizedShellStyle: CSSProperties = {
  position: "fixed",
  zIndex: 48,
  minWidth: 260,
  height: 40,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 30px 30px",
  alignItems: "center",
  gap: 3,
  padding: 4,
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: color.surfaceElevated,
  color: color.text,
  boxShadow: "0 14px 38px rgba(0, 0, 0, 0.32)",
  fontFamily: "var(--font-body)",
};

const mobileSheetStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  top: MOBILE_TOP_OFFSET,
  bottom: 0,
  zIndex: 60,
  display: "grid",
  gridTemplateRows: "44px minmax(0, 1fr)",
  borderTop: `0.5px solid ${color.border}`,
  background: color.surface,
  color: color.text,
  boxShadow: "0 -18px 50px rgba(0, 0, 0, 0.34)",
  fontFamily: "var(--font-body)",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "6px 6px 6px 8px",
  borderBottom: `0.5px solid ${color.border}`,
  background: color.surfaceElevated,
};

const headerHandleStyle: CSSProperties = {
  minWidth: 0,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: 0,
  background: "transparent",
  color: color.text,
  padding: "0 4px",
  textAlign: "left",
};

const headerIconStyle: CSSProperties = {
  width: 22,
  height: 22,
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: radius.sm,
  border: `0.5px solid ${color.border}`,
  background: color.surface,
  color: color.textSecondary,
};

const headerTitleStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: T.cardTitle.size,
  fontWeight: T.cardTitle.weight,
  color: color.text,
};

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: 0,
  borderRadius: radius.sm,
  background: "transparent",
  color: color.textSecondary,
  cursor: "pointer",
  padding: 0,
};

const desktopBodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: space.md,
};

const mobileBodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: space.md,
  paddingBottom: `calc(${space.lg}px + env(safe-area-inset-bottom))`,
};

const resizeHandleStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  bottom: 0,
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: 0,
  background: "transparent",
  color: color.textMuted,
  cursor: "nwse-resize",
  padding: 0,
};

const minimizedDragButtonStyle: CSSProperties = {
  minWidth: 0,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: 0,
  borderRadius: radius.sm,
  background: "transparent",
  color: color.text,
  cursor: "grab",
  padding: "0 6px",
  fontSize: T.bodySmall.size,
  fontWeight: 650,
};
