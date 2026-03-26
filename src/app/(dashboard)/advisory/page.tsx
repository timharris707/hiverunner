"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Users,
  Plus,
  X,
  Send,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Copy,
  Download,
  Archive,
  Pause,
  Play,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  FileDown,
  Focus,
  Paperclip,
  GitBranch,
} from "lucide-react";
import { exportSessionAsPDF } from "@/components/AdvisoryPDFExport";
import { AgentAvatar, AvatarStack } from "@/components/AgentAvatar";
import type {
  AdvisoryEvent,
  AdvisorySession,
  SessionInsights,
  ReviewLoopState,
  CustomAgent,
} from "@/types/advisory";
import {
  formatDate,
  formatMarkdownExport,
  formatMarkdownFileExport,
  slugify,
  getStatusBadge,
} from "@/components/advisory/constants";

// ─── Component imports ────���───────────────────────��──────────────────────────
import EventBubble from "@/components/advisory/EventBubble";
import TypingIndicator from "@/components/advisory/TypingIndicator";
import SessionSidebar from "@/components/advisory/SessionSidebar";
import SessionInsightsPanel from "@/components/advisory/SessionInsightsPanel";
import ReviewLoopPanel from "@/components/advisory/ReviewLoopPanel";
import LaunchWizard from "@/components/advisory/LaunchWizard";
import SessionComparison from "@/components/advisory/SessionComparison";
import DeepDiveModal from "@/components/advisory/DeepDiveModal";

// ─── CSS ─────────────────────────────────────────────────────────────────────
import "@/styles/advisory.css";

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdvisoryPage() {
  // ── Core session state ────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<AdvisorySession[]>([]);
  const [activeSession, setActiveSession] = useState<AdvisorySession | null>(null);
  const activeSessionRef = useRef<AdvisorySession | null>(null);
  const eventsRef = useRef<AdvisoryEvent[]>([]);

  // Persist active session ID to localStorage to survive component remounts
  useEffect(() => {
    activeSessionRef.current = activeSession;
    if (activeSession) {
      localStorage.setItem("advisory_active_session_id", activeSession.id);
    }
  }, [activeSession]);

  // On mount: restore active session from localStorage if we have one
  const [restoredSessionId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("advisory_active_session_id");
    }
    return null;
  });
  const [events, setEvents] = useState<AdvisoryEvent[]>([]);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [humanMessage, setHumanMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeView, setActiveView] = useState<"live" | "history">("live");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [advancingTurn, setAdvancingTurn] = useState(false);
  const [requestingFullRound, setRequestingFullRound] = useState(false);
  const [thinkingAgent, setThinkingAgent] = useState<string | null>(null);
  const [connectingToAI, setConnectingToAI] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);
  const [showCompareView, setShowCompareView] = useState(false);
  const [compareSessions, setCompareSessions] = useState<[AdvisorySession | null, AdvisorySession | null]>([null, null]);
  const [sessionInsights, setSessionInsights] = useState<SessionInsights | null>(null);
  const [extractingInsights, setExtractingInsights] = useState(false);
  const [reviewLoop, setReviewLoop] = useState<ReviewLoopState | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loopAdvancing, setLoopAdvancing] = useState(false);
  const [loopStarted, setLoopStarted] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [forking, setForking] = useState(false);
  const [deepDiveAgent, setDeepDiveAgent] = useState<{ id: string; name: string; emoji: string; role: string } | null>(null);

  const eventsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const humanInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Scroll helpers ────────────────────────────────────────────────────────

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
  }, []);

  const sexyScrollTo = useCallback((el: HTMLElement, target: number) => {
    const start = el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) <= 2) return;
    const duration = Math.min(600, Math.max(300, Math.abs(distance) * 0.5));
    let startTime: number | null = null;

    const easeOutBounce = (t: number): number => {
      if (t < 0.85) {
        const p = t / 0.85;
        return 1 - Math.pow(1 - p, 3);
      } else {
        const p = (t - 0.85) / 0.15;
        const bounce = Math.sin(p * Math.PI) * 0.012;
        return 1 + bounce;
      }
    };

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      el.scrollTop = start + distance * easeOutBounce(progress);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (!smooth) { el.scrollTo({ top: target, behavior: "instant" }); return; }
    sexyScrollTo(el, target);
  }, [sexyScrollTo]);

  // Scroll to the TOP of the latest message (not the bottom of the page)
  const scrollToLatestMessage = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Find the last event bubble element
    const bubbles = el.querySelectorAll("[data-event-id]");
    if (bubbles.length === 0) { scrollToBottom(true); return; }
    const lastBubble = bubbles[bubbles.length - 1] as HTMLElement;
    // Target: top of the last message, with a small offset so it's not flush against the edge
    const target = lastBubble.offsetTop - 20;
    sexyScrollTo(el, Math.max(0, target));
  }, [sexyScrollTo, scrollToBottom]);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/advisory/sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessionEvents = useCallback(async (id: string, preserveEvents = false) => {
    try {
      const res = await fetch(`/api/advisory/sessions/${id}`);
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        setIsPaused(data.session.paused ?? false);
        if (!preserveEvents || (data.session.events?.length ?? 0) > 0) {
          setEvents(data.session.events || []);
        }
        // Restore thinking/generating state if an agent is mid-response
        if (data.session.thinkingAgent) {
          setThinkingAgent(data.session.thinkingAgent);
          setIsGenerating(true);
          setConnectingToAI(false);
        } else if (data.session.status === "active" && !data.session.paused) {
          // Session is active and not paused but no thinking agent — might be processing
          setIsGenerating(true);
          setConnectingToAI(true);
        }
        if (data.session.reviewLoop) {
          setReviewLoop(data.session.reviewLoop);
          const hasStarted = data.session.reviewLoop.tasks.some(
            (t: { status: string }) => t.status !== "pending"
          );
          if (hasStarted) setLoopStarted(true);
        }
      }
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  }, []);

  const loadCustomAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/advisory/custom-agents");
      const data = await res.json();
      setCustomAgents(data.agents || []);
    } catch (e) {
      console.error("Failed to load custom agents:", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadCustomAgents();
    // Auto-restore active session from localStorage on mount
    if (restoredSessionId) {
      loadSessionEvents(restoredSessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSessions, loadCustomAgents]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (events.length === 0) return;
    // If we're waiting for an agent response (isGenerating) or near bottom, always auto-scroll
    if (isGenerating || isNearBottom()) {
      // Scroll to the TOP of the latest message, not the bottom of the page
      // Longer delay for auto-play (DOM needs time to render) vs manual
      const delay = autoPlay ? 200 : 50;
      setTimeout(() => scrollToLatestMessage(), delay);
      setShowNewMessages(false);
    } else {
      setShowNewMessages(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Keep eventsRef in sync
  useEffect(() => { eventsRef.current = events; }, [events]);

  // ── Polling ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    if (activeSession?.status === "active") {
      pollingRef.current = setInterval(async () => {
        try {
          const currentEvents = eventsRef.current;
          const lastId = currentEvents.length > 0 ? currentEvents[currentEvents.length - 1].id : undefined;
          const url = lastId
            ? `/api/advisory/sessions/${activeSession.id}/events?after=${lastId}`
            : `/api/advisory/sessions/${activeSession.id}/events`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.events && data.events.length > 0) {
            setEvents((prev) => [...prev, ...data.events]);
            setIsGenerating(true);
          }
          if (typeof data.paused === "boolean") {
            setIsPaused(data.paused);
            // When server says session is paused and no agent is thinking, clear generating state
            // This ensures manual pacing correctly halts between agents
            if (data.paused && !data.thinkingAgent) {
              setIsGenerating(false);
              setConnectingToAI(false);
              // AUTO-PLAY: If enabled, automatically trigger the next agent after a short delay
              if (autoPlay && activeSession?.status === "active") {
                setTimeout(() => {
                  handleNextTurn();
                }, 1500); // 1.5s delay so user can see the response landed before next starts
              }
            }
          }
          setThinkingAgent(data.thinkingAgent ?? null);
          // Clear connecting state once we know which agent is thinking
          if (data.thinkingAgent) setConnectingToAI(false);
          // Also clear if new events arrived (agent responded)
          if (data.events && data.events.length > 0) setConnectingToAI(false);
          if (data.title) {
            setActiveSession((s) => s && !s.title ? { ...s, title: data.title } : s);
          }
          if (data.status && data.status !== "active") {
            setIsGenerating(false);
            setThinkingAgent(null);
            setConnectingToAI(false);
            setIsPaused(false);
            // Update the active session status so UI reflects completion
            setActiveSession((s) => s ? { ...s, status: data.status, completedAt: data.completedAt || new Date().toISOString() } : s);
            // Update the sessions list so sidebar shows DONE badge
            setSessions((prev) => prev.map((s) => s.id === activeSession.id ? { ...s, status: data.status } : s));
            // Clear persisted session ID — session is no longer active
            localStorage.removeItem("advisory_active_session_id");
            // Reload session data but KEEP the active session selected
            await loadSessionEvents(activeSession.id);
          }
          if (activeSession.mode === "review") {
            try {
              const loopRes = await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`);
              const loopData = await loopRes.json();
              if (loopData.reviewLoop) {
                setReviewLoop(loopData.reviewLoop);
              }
            } catch { /* ignore */ }
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);
    } else {
      setIsGenerating(false);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // NOTE: intentionally excluding `events` from deps to prevent polling restart on every new event
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.status, loadSessions, loadSessionEvents, autoPlay]);

  // ── Session handlers ──────────────────────────────────────────────────────

  const handleSelectSession = async (session: AdvisorySession) => {
    setEvents([]);
    setShowNewMessages(false);
    setEndSessionConfirm(false);
    setSessionInsights(null);
    setMobileSidebarOpen(false);
    setLoopStarted(false);
    await loadSessionEvents(session.id);
    try {
      const res = await fetch(`/api/advisory/sessions/${session.id}/insights`);
      const data = await res.json();
      if (data.insights) setSessionInsights(data.insights);
    } catch { /* ignore */ }
  };

  const handleLaunch = async (session: AdvisorySession) => {
    setShowLaunchModal(false);
    setMobileSidebarOpen(false);
    setIsGenerating(true);
    await loadSessions();
    await handleSelectSession(session);
    setActiveView("live");
    // Auto-start Round 1 so the user doesn't need to hit Resume first
    if (session.mode !== "review") {
      try {
        setConnectingToAI(true);
        setIsPaused(false);
        const sd = session as unknown as Record<string, unknown>;
        if (sd.pacing === "manual") {
          // Manual pacing: fire one agent at a time, then auto-pause
          const res = await fetch(`/api/advisory/sessions/${session.id}/next-agent`, { method: "POST" });
          const data = await res.json();
          setIsGenerating(true);
          if (data.nextAgent) {
            setThinkingAgent(data.nextAgent);
            setConnectingToAI(false);
          }
        } else {
          await fetch(`/api/advisory/sessions/${session.id}/full-round`, { method: "POST" });
        }
      } catch (e) {
        console.error("Auto-start round 1 error:", e);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!humanMessage.trim() || !activeSession) return;
    setSendingMessage(true);
    setConnectingToAI(true);
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: humanMessage }),
      });
      const data = await res.json();
      if (data.event) {
        setEvents((prev) => [...prev, data.event]);
        setHumanMessage("");
      }
    } catch (e) {
      console.error("Failed to send message:", e);
    } finally {
      setSendingMessage(false);
    }
  };

  // ── Review Loop handlers ──────────────────────────────────────────────────

  const handleLoopAction = async (action: string, extra?: Record<string, unknown>) => {
    if (!activeSession) return;
    setLoopAdvancing(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
    } catch (e) {
      console.error("Loop action error:", e);
    } finally {
      setLoopAdvancing(false);
    }
  };

  const handleAddLoopTask = async () => {
    if (!activeSession || !newTaskText.trim()) return;
    setAddingTask(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-task", description: newTaskText.trim() }),
      });
      setNewTaskText("");
    } catch (e) {
      console.error("Add task error:", e);
    } finally {
      setAddingTask(false);
    }
  };

  const handleOverrideTask = async (taskId: number, newStatus: string, notes?: string) => {
    if (!activeSession) return;
    await handleLoopAction("override", { taskId, newStatus, notes });
  };

  const handleStartLoop = async () => {
    if (!activeSession) return;
    setLoopStarted(true);
    await handleLoopAction("start");
  };

  const handleStopLoop = async () => {
    if (!activeSession) return;
    setLoopStarted(false);
    // End the session
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/end`, { method: "POST" });
      await loadSessionEvents(activeSession.id);
      await loadSessions();
    } catch (e) {
      console.error("Stop loop error:", e);
    }
  };

  const handleSkipTask = async () => {
    if (!activeSession || !reviewLoop) return;
    const currentTask = reviewLoop.tasks[reviewLoop.currentTaskIndex];
    if (!currentTask) return;
    await handleLoopAction("override", { taskId: currentTask.id, newStatus: "approved", notes: "Skipped by user" });
  };

  // ── Session controls ──────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    if (activeSession) await loadSessionEvents(activeSession.id);
    setRefreshing(false);
  };

  const handleCopyToClipboard = async () => {
    if (!activeSession) return;
    const markdown = formatMarkdownExport(activeSession, events);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (e) {
      console.error("Clipboard error:", e);
    }
  };

  const handleExportMarkdown = () => {
    if (!activeSession) return;
    const markdown = formatMarkdownExport(activeSession, events);
    const dateStr = new Date(activeSession.createdAt).toISOString().split("T")[0];
    const topicSlug = slugify(activeSession.topic);
    const fileName = `advisory-${dateStr}-${topicSlug}.txt`;
    const blob = new Blob([markdown], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMD = () => {
    if (!activeSession) return;
    const md = formatMarkdownFileExport(activeSession, events);
    const dateStr = new Date(activeSession.createdAt).toISOString().split("T")[0];
    const topicSlug = slugify(activeSession.topic);
    const fileName = `${topicSlug}-${dateStr}.md`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    if (!activeSession || exportingPDF) return;
    setExportingPDF(true);
    try {
      await exportSessionAsPDF(
        activeSession as unknown as import("@/components/AdvisoryPDFExport").PDFSession,
        events as unknown as import("@/components/AdvisoryPDFExport").PDFEvent[]
      );
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExportingPDF(false);
    }
  };

  const handleArchive = async () => {
    if (!activeSession) return;
    setArchiving(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/archive`, { method: "POST" });
    } catch (e) {
      console.error("Archive error:", e);
    } finally {
      setArchiving(false);
    }
  };

  const handleTogglePause = async () => {
    if (!activeSession) return;
    setTogglingPause(true);
    try {
      const newPaused = !isPaused;
      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: newPaused }),
      });
      setIsPaused(newPaused);
      setActiveSession((s) => s ? { ...s, paused: newPaused } : s);
      // When resuming, trigger agent responses
      if (!newPaused) {
        setConnectingToAI(true);
        if (sessionData?.pacing === "manual") {
          // Manual pacing: fire one agent at a time
          const res = await fetch(`/api/advisory/sessions/${activeSession.id}/next-agent`, { method: "POST" });
          const data = await res.json();
          setIsGenerating(true);
          if (data.nextAgent) {
            setThinkingAgent(data.nextAgent);
            setConnectingToAI(false);
          }
        } else {
          await fetch(`/api/advisory/sessions/${activeSession.id}/full-round`, { method: "POST" });
          setIsGenerating(true);
        }
      }
    } catch (e) {
      console.error("Pause toggle error:", e);
    } finally {
      setTogglingPause(false);
    }
  };

  const handleNextTurn = async () => {
    if (!activeSession || advancingTurn || isGenerating) return;
    setAdvancingTurn(true);
    setConnectingToAI(true);
    try {
      // For manual pacing: fire one agent at a time via next-agent endpoint
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/next-agent`, { method: "POST" });
      const data = await res.json();
      if (data.sessionComplete) {
        // Round limit reached — session is ending with synthesis
        setIsGenerating(true);
        setConnectingToAI(false);
        setThinkingAgent(null);
        // The end route is running async — polling will detect completion
        return;
      }
      setIsPaused(false);
      setIsGenerating(true);
      if (data.nextAgent) {
        setThinkingAgent(data.nextAgent);
        setConnectingToAI(false);
      }
      // Auto-scroll to show the "thinking..." indicator so user knows something is happening
      setTimeout(() => scrollToBottom(true), 150); // scroll to bottom for thinking indicator, then scrollToLatestMessage when response arrives
    } catch (e) {
      console.error("Next turn error:", e);
    } finally {
      setAdvancingTurn(false);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession || endingSession) return;
    setEndingSession(true);
    // Clear persisted session — user is intentionally ending
    localStorage.removeItem("advisory_active_session_id");
    // Immediately hide the deliberating indicator
    setIsGenerating(false);
    setThinkingAgent(null);
    setConnectingToAI(false);
    try {
      const synthesisPlaceholder: AdvisoryEvent = {
        id: `evt_synth_pending_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "supervisor",
        speaker: "System",
        emoji: "⏳",
        role: "supervisor",
        text: "⏳ **Generating final synthesis...** Henry is reviewing the full discussion and preparing closing remarks. This may take 15–30 seconds.",
      };
      setEvents((prev) => [...prev, synthesisPlaceholder]);
      setTimeout(() => scrollToBottom(), 100);
      await fetch(`/api/advisory/sessions/${activeSession.id}/end`, { method: "POST" });
      await loadSessionEvents(activeSession.id, true);
      await loadSessions();
      setIsGenerating(true);
    } catch (e) {
      console.error("End session error:", e);
    } finally {
      setEndingSession(false);
      setEndSessionConfirm(false);
    }
  };

  const handleFullRound = async () => {
    if (!activeSession) return;
    setRequestingFullRound(true);
    setConnectingToAI(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/full-round`, { method: "POST" });
      setIsGenerating(true);
    } catch (e) {
      console.error("Full round error:", e);
    } finally {
      setRequestingFullRound(false);
    }
  };

  const handleContinueDiscussion = async () => {
    if (!activeSession) return;
    setContinuing(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active", completedAt: null, outcome: null, rounds: "persistent", paused: false }),
      });
      setActiveSession((s) => s ? { ...s, status: "active", completedAt: undefined, outcome: undefined } : s);
      setIsGenerating(false);
      await loadSessions();
      await loadSessionEvents(activeSession.id);
    } catch (e) {
      console.error("Continue discussion error:", e);
    } finally {
      setContinuing(false);
    }
  };

  const handleExtractInsights = async () => {
    if (!activeSession) return;
    setExtractingInsights(true);
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/insights`, { method: "POST" });
      const data = await res.json();
      if (data.insights) setSessionInsights(data.insights);
    } catch (e) {
      console.error("Insights extraction error:", e);
    } finally {
      setExtractingInsights(false);
    }
  };

  const handleToggleActionItem = async (index: number, status: "pending" | "done") => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionIndex: index, status }),
      });
      const data = await res.json();
      if (data.insights) setSessionInsights(data.insights);
    } catch (e) {
      console.error("Toggle action item error:", e);
    }
  };

  const handleRetrySession = async () => {
    if (!activeSession) return;
    setRetrying(true);
    try {
      setEvents((prev) => prev.filter((e) => e.type !== "error" && !e.error));
      await fetch(`/api/advisory/sessions/${activeSession.id}/run`, { method: "POST" });
      setIsGenerating(true);
    } catch (e) {
      console.error("Retry error:", e);
    } finally {
      setRetrying(false);
    }
  };

  const handleForkFromEvent = async (eventId: string) => {
    if (!activeSession || forking) return;
    setForking(true);
    try {
      const eventIndex = events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) return;
      const forkedEvents = events.slice(0, eventIndex + 1);
      const sessionData = activeSession as unknown as Record<string, unknown>;
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: activeSession.topic,
          mode: activeSession.mode,
          agents: activeSession.agents,
          reviewStyle: activeSession.reviewStyle,
          model: activeSession.model,
          rounds: "persistent",
          pacing: sessionData.pacing || "manual",
          responseLength: sessionData.responseLength || "balanced",
          extendedThinking: sessionData.extendedThinking || false,
          personaOverlays: sessionData.personaOverlays || {},
          specialist: sessionData.specialist || false,
          specialistAgent: sessionData.specialistAgent || null,
          forkedFrom: activeSession.id,
          forkedAtEvent: eventId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create forked session");
      const data = await res.json();
      const forkMarkerEvent: AdvisoryEvent = {
        id: `evt_fork_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "start",
        speaker: "System",
        emoji: "🔀",
        role: "supervisor",
        text: `🔀 **Forked session.** This session was branched from "${activeSession.title || activeSession.topic}" at event ${eventIndex + 1} of ${events.length}.\n\nAll prior context has been preserved. Continue the discussion from this point.`,
      };
      const newEvents = [...forkedEvents, forkMarkerEvent];
      await fetch(`/api/advisory/sessions/${data.session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: newEvents,
          forkedFrom: activeSession.id,
          forkedAtEvent: eventId,
        }),
      });
      await loadSessions();
      await handleSelectSession({ ...data.session, events: newEvents });
      setActiveView("live");
    } catch (e) {
      console.error("Fork error:", e);
    } finally {
      setForking(false);
    }
  };

  // ── Deep Dive ─��───────────────────────────────────────────────────────────

  const handleDeepDive = (agentId: string, agentName: string, agentEmoji: string, agentRole: string) => {
    setShowLaunchModal(false);
    setDeepDiveAgent({ id: agentId, name: agentName, emoji: agentEmoji, role: agentRole });
  };

  const handleLaunchDeepDive = async (topic: string, model: string) => {
    if (!deepDiveAgent) return;
    try {
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          mode: "roundtable",
          agents: [deepDiveAgent.name],
          reviewStyle: "open",
          model,
          rounds: "persistent",
          pacing: "manual",
          responseLength: "detailed",
          specialist: true,
          specialistAgent: deepDiveAgent.name,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();
      try {
        await fetch(`/api/advisory/sessions/${data.session.id}/run`, { method: "POST" });
      } catch (runErr) {
        console.warn("Run trigger error (non-fatal):", runErr);
      }
      setDeepDiveAgent(null);
      await handleLaunch(data.session);
    } catch (e) {
      console.error("Deep dive launch error:", e);
    }
  };

  // ── Compare sessions ──────────────────────────────────────────────────────

  const handleToggleCompareSelection = (sessionId: string) => {
    setCompareSelections((prev) => {
      if (prev.includes(sessionId)) return prev.filter((s) => s !== sessionId);
      if (prev.length >= 2) return [prev[1], sessionId];
      return [...prev, sessionId];
    });
  };

  const handleOpenCompare = async () => {
    if (compareSelections.length !== 2) return;
    const loaded: [AdvisorySession | null, AdvisorySession | null] = [null, null];
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`/api/advisory/sessions/${compareSelections[i]}`);
        const data = await res.json();
        loaded[i] = data.session || null;
      } catch { /* ignore */ }
    }
    setCompareSessions(loaded as [AdvisorySession | null, AdvisorySession | null]);
    setShowCompareView(true);
    setCompareMode(false);
    setCompareSelections([]);
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          e.preventDefault();
          setShowLaunchModal(true);
        }
      }
      if (e.key === "Escape") {
        if (showCompareView) setShowCompareView(false);
        else if (compareMode) { setCompareMode(false); setCompareSelections([]); }
        else if (showLaunchModal) setShowLaunchModal(false);
        if (endSessionConfirm) setEndSessionConfirm(false);
        if (mobileSidebarOpen) setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLaunchModal, endSessionConfirm, mobileSidebarOpen, showCompareView, compareMode]);

  // ── Round tracking ──────────────────────────────────────────────────────
  // Compute which round each event belongs to by tracking agent cycles.
  // A new round starts when we see a non-human, non-system speaker that
  // already appeared in the current round (i.e. the agent list is cycling).

  const roundMap = new Map<string, number>();
  const totalRoundsRef = useRef(1);
  (() => {
    const agentEvents = events.filter(
      (e) => e.speaker !== "Tim" && e.speaker !== "System" && e.type !== "start" && e.type !== "complete" && !e.error
    );
    let round = 1;
    const seenInRound = new Set<string>();
    for (const e of agentEvents) {
      if (seenInRound.has(e.speaker)) {
        round++;
        seenInRound.clear();
      }
      seenInRound.add(e.speaker);
      roundMap.set(e.id, round);
    }
    totalRoundsRef.current = round;
    // Also assign rounds to human/system events based on surrounding context
    let lastRound = 1;
    for (const e of events) {
      if (roundMap.has(e.id)) {
        lastRound = roundMap.get(e.id)!;
      } else {
        roundMap.set(e.id, lastRound);
      }
    }
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  const sessionData = activeSession as unknown as Record<string, unknown> | null;

  return (
    <>
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 299, display: "none",
          }}
        />
      )}

      <div className="advisory-layout" style={{ display: "flex", height: "calc(100vh - 80px)", gap: "0", minHeight: 0, position: "relative", margin: "-24px", width: "calc(100% + 48px)" }}>

        {/* ─── LEFT SIDEBAR ──────────────────────────────── */}
        {/* When a review loop session is active, replace the session list with the task panel */}
        {reviewLoop && activeSession?.mode === "review" ? (
          <ReviewLoopPanel
            loop={reviewLoop}
            onOverride={handleOverrideTask}
            onAddTask={handleAddLoopTask}
            onAdvance={() => handleLoopAction("advance")}
            onPause={() => handleLoopAction("pause")}
            onResume={() => handleLoopAction("resume")}
            onStartLoop={handleStartLoop}
            onStopLoop={handleStopLoop}
            onSkipTask={handleSkipTask}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            newTaskText={newTaskText}
            onNewTaskTextChange={setNewTaskText}
            addingTask={addingTask}
            loopAdvancing={loopAdvancing}
            sessionStatus={activeSession?.status || "active"}
            onSetAutoContinue={(val) => handleLoopAction("set-auto-continue", { autoContinue: val })}
            loopStarted={loopStarted}
          />
        ) : (
          <SessionSidebar
            sessions={sessions}
            activeSession={activeSession}
            activeView={activeView}
            loading={loading}
            refreshing={refreshing}
            searchQuery={searchQuery}
            filterAgent={filterAgent}
            showFilters={showFilters}
            compareMode={compareMode}
            compareSelections={compareSelections}
            mobileSidebarOpen={mobileSidebarOpen}
            onSelectSession={handleSelectSession}
            onActiveViewChange={setActiveView}
            onRefresh={handleRefresh}
            onSearchChange={setSearchQuery}
            onFilterAgentChange={setFilterAgent}
            onShowFiltersChange={setShowFilters}
            onCompareModeToggle={() => { setCompareMode((v) => !v); setCompareSelections([]); }}
            onCompareToggle={handleToggleCompareSelection}
            onOpenCompare={handleOpenCompare}
            onShowLaunchModal={() => setShowLaunchModal(true)}
            onMobileSidebarClose={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* ─── MAIN CONTENT ─────────────────────────────── */}
        {/* FIX: minWidth:0 prevents flex child from overflowing (text wrapping bug) */}
        <div className="advisory-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Mobile top bar */}
          <div
            className="advisory-mobile-menu-btn"
            style={{
              display: "none", alignItems: "center", gap: "10px",
              padding: "10px 16px", borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--surface)", flexShrink: 0,
            }}
          >
            <button
              onClick={() => setMobileSidebarOpen(true)}
              style={{
                background: "none", border: "1px solid var(--border)", cursor: "pointer",
                color: "var(--text-primary)", padding: "6px 10px", borderRadius: "6px",
                display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600,
              }}
            >
              <Users size={14} />
              Sessions
            </button>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              Advisory Board
            </span>
            <button
              onClick={() => setShowLaunchModal(true)}
              style={{
                marginLeft: "auto", padding: "6px 12px", borderRadius: "6px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer",
                fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px",
              }}
            >
              <Plus size={12} />
              New
            </button>
          </div>

          {activeSession ? (
            <>
              {/* ── Session header (ALWAYS VISIBLE — never scrolls) ── */}
              <div
                className="advisory-session-header"
                style={{
                  padding: "12px 24px",
                  borderBottom: `1px solid ${sessionData?.specialist ? "rgba(16,185,129,0.3)" : "var(--border)"}`,
                  backgroundColor: sessionData?.specialist ? "rgba(16,185,129,0.03)" : "var(--surface)",
                  flexShrink: 0,
                  zIndex: 20,
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                      {(() => {
                        const badge = getStatusBadge(activeSession.status);
                        return (
                          <span style={{
                            fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: badge.color,
                            backgroundColor: badge.bg, padding: "2px 8px", borderRadius: "4px",
                            fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "4px",
                          }}>
                            {activeSession.status === "active" && (
                              <span className="live-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: badge.color, display: "inline-block" }} />
                            )}
                            {badge.label}
                          </span>
                        );
                      })()}
                      <span style={{
                        fontSize: "9px", fontWeight: 600, color: "var(--text-muted)",
                        backgroundColor: "var(--surface-elevated)", padding: "2px 8px",
                        borderRadius: "4px", fontFamily: "var(--font-mono)", textTransform: "uppercase",
                      }}>
                        {activeSession.mode}
                      </span>
                      {!!sessionData?.specialist && (
                        <span style={{ fontSize: "9px", fontWeight: 700, color: "#10b981", backgroundColor: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", padding: "2px 7px", borderRadius: "4px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <Focus size={9} /> DEEP DIVE
                        </span>
                      )}
                      {sessionData?.rounds === "persistent" && !sessionData?.specialist && (
                        <span style={{ fontSize: "9px", fontWeight: 700, color: "#a78bfa", backgroundColor: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", padding: "2px 7px", borderRadius: "4px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>∞ PERSISTENT</span>
                      )}
                      {!!sessionData?.forkedFrom && (
                        <span style={{ fontSize: "9px", fontWeight: 700, color: "#60a5fa", backgroundColor: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", padding: "2px 7px", borderRadius: "4px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <GitBranch size={9} /> FORKED
                        </span>
                      )}
                      {!!sessionData?.referenceContext && (
                        <span style={{ fontSize: "9px", fontWeight: 700, color: "#a78bfa", backgroundColor: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", padding: "2px 7px", borderRadius: "4px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <Paperclip size={9} /> REF MATERIAL
                        </span>
                      )}
                      {activeSession.model && (
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                          {activeSession.model}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)", lineHeight: 1.3, wordBreak: "normal", overflowWrap: "anywhere", whiteSpace: "normal" }}>
                      {activeSession.title ? activeSession.title : activeSession.topic.length > 100 ? `${activeSession.topic.slice(0, 100)}...` : activeSession.topic}
                    </h2>
                    {activeSession.title && (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px", fontStyle: "italic" }}>
                        {activeSession.topic.length > 80 ? `${activeSession.topic.slice(0, 80)}...` : activeSession.topic}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                    <AvatarStack agentIds={activeSession.agents} size={28} max={5} />
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "right" }}>
                      <div>{events.length} events</div>
                      <div>{formatDate(activeSession.createdAt)}</div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {activeSession.status === "active" && (
                        <button onClick={handleTogglePause} disabled={togglingPause} title={isPaused ? "Resume session" : "Pause session"}
                          style={{ padding: "6px 10px", borderRadius: "6px", border: `1px solid ${isPaused ? "rgba(74,222,128,0.5)" : "var(--border)"}`, backgroundColor: isPaused ? "rgba(74,222,128,0.12)" : "var(--surface-elevated)", color: isPaused ? "#4ade80" : "var(--text-muted)", cursor: togglingPause ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, transition: "all 150ms ease", opacity: togglingPause ? 0.6 : 1 }}>
                          {togglingPause ? <Loader2 size={12} className="animate-spin" /> : isPaused ? <Play size={12} /> : <Pause size={12} />}
                          {isPaused ? "Resume" : "Pause"}
                        </button>
                      )}
                      {activeSession.status === "active" && !endSessionConfirm && (
                        <button onClick={() => setEndSessionConfirm(true)} disabled={endingSession} title="End session with Henry's synthesis"
                          style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.35)", backgroundColor: "rgba(239,68,68,0.06)", color: "#ef4444", cursor: endingSession ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, transition: "all 150ms ease", opacity: endingSession ? 0.5 : 1 }}>
                          <X size={12} /> End
                        </button>
                      )}
                      {activeSession.status === "active" && endSessionConfirm && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.08)" }}>
                          <span style={{ fontSize: "10px", color: "#ef4444", fontWeight: 600, whiteSpace: "nowrap" }}>Henry synthesizes & closes →</span>
                          <button onClick={handleEndSession} disabled={endingSession}
                            style={{ padding: "4px 10px", borderRadius: "5px", border: "none", backgroundColor: "#ef4444", color: "#fff", cursor: endingSession ? "not-allowed" : "pointer", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px", opacity: endingSession ? 0.7 : 1 }}>
                            {endingSession ? <Loader2 size={10} className="animate-spin" /> : null} Confirm
                          </button>
                          <button onClick={() => setEndSessionConfirm(false)}
                            style={{ padding: "4px 8px", borderRadius: "5px", border: "1px solid rgba(239,68,68,0.3)", backgroundColor: "transparent", color: "#ef4444", cursor: "pointer", fontSize: "10px", fontWeight: 600 }}>
                            Cancel
                          </button>
                        </div>
                      )}
                      {activeSession.status === "completed" && (
                        <>
                          <button onClick={handleCopyToClipboard} title="Copy as Markdown"
                            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: copiedToast ? "rgba(74,222,128,0.15)" : "var(--surface-elevated)", color: copiedToast ? "#4ade80" : "var(--text-muted)", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", transition: "all 150ms ease", fontWeight: 600 }}>
                            <Copy size={12} /> {copiedToast ? "Copied!" : "Copy"}
                          </button>
                          <button onClick={handleExportMarkdown} title="Export as plain text file"
                            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)", color: "var(--text-muted)", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                            <Download size={12} /> Export
                          </button>
                          <button onClick={handleExportMD} title="Export as Markdown file"
                            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)", color: "var(--text-muted)", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                            <FileDown size={12} /> Export MD
                          </button>
                          <button onClick={handleExportPDF} disabled={exportingPDF} title="Print / Save PDF"
                            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(139,92,246,0.4)", backgroundColor: exportingPDF ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.1)", color: "#a78bfa", cursor: exportingPDF ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, opacity: exportingPDF ? 0.7 : 1, transition: "all 150ms ease" }}>
                            {exportingPDF ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                            {exportingPDF ? "Opening..." : "Print / PDF"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Paused banner */}
              {isPaused && activeSession.status === "active" && (
                <div style={{ padding: "8px 24px", backgroundColor: "rgba(251,146,60,0.08)", borderBottom: "1px solid rgba(251,146,60,0.25)", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  <Pause size={12} color="#fb923c" />
                  <span style={{ fontSize: "11px", color: "#fb923c", fontWeight: 600 }}>Session paused — agents are waiting</span>
                </div>
              )}

              {/* Events stream — full width center area */}
              <div style={{ display: "flex", flex: 1, overflow: "hidden", minWidth: 0 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                  {/* Persistent round indicator */}
                  {activeSession?.status === "active" && events.length > 0 && (
                    <div style={{
                      padding: "8px 24px",
                      backgroundColor: "var(--surface)",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      flexShrink: 0,
                      justifyContent: "center",
                      gap: "8px",
                    }}>
                      {(() => {
                        const configuredRounds = activeSession?.rounds && activeSession.rounds !== "persistent" ? Number(activeSession.rounds) : 0;
                        const numAgents = activeSession?.agents?.length || 1;
                        const totalSteps = configuredRounds * numAgents;
                        // Count completed agent responses
                        const agentResponses = events.filter(
                          (e) => e.speaker !== "Tim" && e.speaker !== "System" && e.type !== "start" && e.type !== "complete" && !e.error
                        ).length;
                        const progressPct = totalSteps > 0 ? Math.min((agentResponses / totalSteps) * 100, 100) : 0;

                        return (
                          <>
                            <span style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              color: "var(--accent)",
                              letterSpacing: "0.5px",
                            }}>
                              ROUND {totalRoundsRef.current} {configuredRounds ? `OF ${configuredRounds}` : ""}
                            </span>
                            {configuredRounds > 0 && (
                              <div style={{
                                flex: 1,
                                maxWidth: "200px",
                                height: "6px",
                                backgroundColor: "var(--border)",
                                borderRadius: "3px",
                                overflow: "hidden",
                                position: "relative",
                              }}>
                                <div style={{
                                  width: `${progressPct}%`,
                                  height: "100%",
                                  backgroundColor: progressPct >= 100 ? "#22c55e" : "var(--accent)",
                                  borderRadius: "3px",
                                  transition: "width 0.5s ease-out",
                                  boxShadow: progressPct >= 100 ? "0 0 8px #22c55e66" : "0 0 6px var(--accent)44",
                                }} />
                              </div>
                            )}
                            {configuredRounds > 0 && (
                              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                {Math.round(progressPct)}% complete
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* FIX: overflowY auto for scrollable events stream */}
                  <div
                    ref={scrollContainerRef}
                    className="advisory-events-stream"
                    style={{ flex: 1, overflowY: "auto", padding: "20px 24px", backgroundColor: "var(--background)", position: "relative" }}
                    onScroll={() => { if (isNearBottom()) setShowNewMessages(false); }}
                  >
                    {events.length === 0 ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", flexDirection: "column", gap: "12px" }}>
                        <Loader2 size={20} className="animate-spin" />
                        <span style={{ fontSize: "12px" }}>Starting conversation...</span>
                      </div>
                    ) : (
                      <>
                        {events.map((event, idx) => {
                          const eventRound = roundMap.get(event.id) ?? 1;
                          const prevRound = idx > 0 ? (roundMap.get(events[idx - 1].id) ?? 1) : 0;
                          const totalRounds = totalRoundsRef.current;
                          // Show divider when entering a new round — including round 1 if multiple rounds exist
                          const isFirstAgentEvent = idx > 0 && event.speaker !== "System" && event.type !== "start";
                          const showRound1 = eventRound === 1 && prevRound === 0 && totalRounds > 1 && isFirstAgentEvent;
                          const showDivider = (eventRound > prevRound && eventRound > 1) || showRound1;
                          return (
                            <div key={event.id} data-event-id={event.id}>
                              {showDivider && (
                                <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "18px 0", opacity: 0.5 }}>
                                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border)" }} />
                                  <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                                    Round {eventRound}{(() => {
                                      const configuredRounds = sessionData?.rounds;
                                      const displayTotal = typeof configuredRounds === "number" ? configuredRounds : totalRounds;
                                      return displayTotal > 1 ? ` of ${displayTotal}` : "";
                                    })()}
                                  </span>
                                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border)" }} />
                                </div>
                              )}
                              <EventBubble
                                event={event}
                                sessionOverlays={(sessionData?.personaOverlays as Record<string, string> | string[] | undefined) ?? {}}
                                sessionTopic={activeSession?.topic}
                                sessionMode={activeSession?.mode}
                                onRetry={(event.type === "error" || event.error) ? handleRetrySession : undefined}
                                onFork={event.type !== "start" && !event.error ? () => handleForkFromEvent(event.id) : undefined}
                              />
                            </div>
                          );
                        })}
                        {endingSession && activeSession?.status === "active" && (
                          <TypingIndicator agentId="Henry" overrideLabel="Henry is writing the final summary..." />
                        )}
                        {isGenerating && activeSession?.status === "active" && !isPaused && !endingSession && (
                          <TypingIndicator
                            agentId={thinkingAgent}
                            overrideLabel={connectingToAI && !thinkingAgent ? "Connecting to AI..." : undefined}
                          />
                        )}
                        {connectingToAI && !isGenerating && activeSession?.status === "active" && !endingSession && (
                          <TypingIndicator agentId={null} overrideLabel="Connecting to AI..." />
                        )}
                        {activeSession?.status === "completed" && (
                          <SessionInsightsPanel
                            insights={sessionInsights}
                            onToggleAction={handleToggleActionItem}
                            extracting={extractingInsights}
                            onExtract={handleExtractInsights}
                          />
                        )}
                        <div ref={eventsEndRef} />
                      </>
                    )}
                  </div>

                  {/* New messages badge */}
                  {showNewMessages && (
                    <div style={{ position: "relative", flexShrink: 0, height: 0 }}>
                      <button
                        onClick={() => { scrollToBottom(); setShowNewMessages(false); }}
                        style={{ position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", padding: "6px 14px", borderRadius: "20px", border: "1px solid var(--accent)", backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", gap: "5px", zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
                        <ChevronDown size={12} /> New messages
                      </button>
                    </div>
                  )}

                  {/* Next Turn bar — shown when paused */}
                  {activeSession.status === "active" && isPaused && (
                    <div style={{ padding: "10px 24px", borderTop: "1px solid rgba(251,146,60,0.2)", backgroundColor: "rgba(251,146,60,0.04)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", flex: 1 }}>
                        {autoPlay ? "Auto-play · Agents will advance automatically" : sessionData?.pacing === "manual" ? "Manual mode · Read the response, then click Next Agent" : "Session paused · Resume or advance"}
                      </span>
                      {/* Auto-play toggle */}
                      <button
                        onClick={() => {
                          const newAutoPlay = !autoPlay;
                          setAutoPlay(newAutoPlay);
                          // If turning on auto-play while paused, immediately trigger next
                          if (newAutoPlay && isPaused && !isGenerating) {
                            setTimeout(() => handleNextTurn(), 500);
                          }
                        }}
                        style={{
                          padding: "6px 14px", borderRadius: "6px",
                          border: `1px solid ${autoPlay ? "rgba(74,222,128,0.5)" : "rgba(139,92,246,0.5)"}`,
                          backgroundColor: autoPlay ? "rgba(74,222,128,0.12)" : "rgba(139,92,246,0.12)",
                          color: autoPlay ? "#4ade80" : "#a78bfa",
                          cursor: "pointer", fontSize: "11px", fontWeight: 700,
                          display: "flex", alignItems: "center", gap: "5px",
                          transition: "all 150ms ease",
                          letterSpacing: "0.3px",
                        }}
                      >
                        {autoPlay ? <Pause size={11} /> : <Play size={11} />}
                        {autoPlay ? "Auto-play ON" : "Auto-play"}
                      </button>
                      {!autoPlay && (
                        <button onClick={handleNextTurn} disabled={advancingTurn || isGenerating}
                          style={{ padding: "8px 16px", borderRadius: "7px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: (advancingTurn || isGenerating) ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", opacity: (advancingTurn || isGenerating) ? 0.7 : 1, fontFamily: "var(--font-heading)" }}>
                          {advancingTurn ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
                          Next Agent →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Human input bar */}
                  {activeSession.status === "active" && (
                    <div className="advisory-input-bar" style={{ padding: "12px 24px 16px", borderTop: "1px solid var(--border)", backgroundColor: "var(--surface)", flexShrink: 0 }}>
                      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <textarea
                            ref={humanInputRef}
                            value={humanMessage}
                            onChange={(e) => setHumanMessage(e.target.value)}
                            placeholder={sessionData?.specialist ? `Continue your conversation with ${sessionData?.specialistAgent || activeSession.agents[0]}...` : "Jump in — share your thoughts or steer the conversation..."}
                            rows={2}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (humanMessage.trim()) handleSendMessage(); }
                              if (e.key === "Enter" && e.metaKey) { e.preventDefault(); if (humanMessage.trim()) handleSendMessage(); }
                            }}
                            style={{ width: "100%", padding: "10px 12px", backgroundColor: "var(--surface-elevated)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-primary)", fontSize: "13px", fontFamily: "var(--font-body)", resize: "none", outline: "none", boxSizing: "border-box" }}
                          />
                          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                            ↵ to send · Shift+↵ for newline · ⌘N new session · Esc close modal
                          </div>
                        </div>
                        <button onClick={handleSendMessage} disabled={sendingMessage || !humanMessage.trim()}
                          style={{ padding: "10px 18px", borderRadius: "8px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: sendingMessage || !humanMessage.trim() ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", opacity: sendingMessage || !humanMessage.trim() ? 0.5 : 1, flexShrink: 0, fontFamily: "var(--font-heading)", marginTop: "0px", position: "relative", zIndex: 10 }}>
                          {sendingMessage ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          Send
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Persistent session - Request Full Round button */}
                  {activeSession.status === "active" && sessionData?.rounds === "persistent" && (
                    <div style={{ padding: "10px 24px", borderTop: "1px solid rgba(139,92,246,0.2)", backgroundColor: "rgba(139,92,246,0.04)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", flex: 1 }}>
                        {sessionData?.specialist ? `Deep dive with ${sessionData?.specialistAgent || activeSession.agents[0]} — ask anything` : "Persistent session — agents wait for your input"}
                      </span>
                      <button onClick={handleFullRound} disabled={requestingFullRound || isGenerating}
                        style={{ padding: "7px 14px", borderRadius: "7px", border: "1px solid rgba(139,92,246,0.5)", backgroundColor: "rgba(139,92,246,0.12)", color: "#a78bfa", cursor: requestingFullRound || isGenerating ? "not-allowed" : "pointer", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", opacity: requestingFullRound || isGenerating ? 0.6 : 1, fontFamily: "var(--font-heading)", transition: "all 150ms ease" }}>
                        {requestingFullRound ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        Request Full Round
                      </button>
                    </div>
                  )}

                  {/* Completed session summary */}
                  {activeSession.status === "completed" && (
                    <div style={{ padding: "14px 24px", borderTop: "2px solid rgba(74,222,128,0.4)", backgroundColor: "rgba(74,222,128,0.05)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0, flexWrap: "wrap" }}>
                      <CheckCircle2 size={18} color="#4ade80" />
                      <div style={{ flex: 1, minWidth: "200px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#4ade80" }}>
                          Session Complete — {activeSession.title || activeSession.topic.slice(0, 60)}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                          {activeSession.completedAt ? formatDate(activeSession.completedAt) : ""}
                          {activeSession.outcome ? ` · ${activeSession.outcome.replace(/-/g, " ")}` : ""}
                        </div>
                      </div>
                      <button onClick={handleContinueDiscussion} disabled={continuing} title="Reopen session for additional rounds"
                        style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid rgba(139,92,246,0.5)", backgroundColor: continuing ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.12)", color: "#a78bfa", cursor: continuing ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, opacity: continuing ? 0.6 : 1, fontFamily: "var(--font-heading)", transition: "all 150ms ease" }}>
                        {continuing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        Continue Discussion
                      </button>
                      <button onClick={handleExportMD} title="Export as Markdown file"
                        style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)", color: "var(--text-muted)", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                        <FileDown size={12} /> Export MD
                      </button>
                      <button onClick={handleExportPDF} disabled={exportingPDF} title="Export as PDF"
                        style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid rgba(139,92,246,0.4)", backgroundColor: exportingPDF ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.08)", color: "#a78bfa", cursor: exportingPDF ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, opacity: exportingPDF ? 0.6 : 1 }}>
                        {exportingPDF ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                        {exportingPDF ? "Generating..." : "Export PDF"}
                      </button>
                      <button onClick={handleArchive} disabled={archiving} title="Archive session to workspace memory"
                        style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid rgba(74,222,128,0.3)", backgroundColor: "rgba(74,222,128,0.08)", color: "#4ade80", cursor: archiving ? "not-allowed" : "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, opacity: archiving ? 0.6 : 1 }}>
                        {archiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
                        {archiving ? "Archiving..." : "Archive"}
                      </button>
                    </div>
                  )}
                </div>{/* close events column */}
              </div>{/* close horizontal split */}
            </>
          ) : (
            /* Landing page — hero + agent showcase */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", overflow: "auto", background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 60%)" }}>
              {/* Hero */}
              <div style={{ textAlign: "center", maxWidth: "520px", marginBottom: "36px" }}>
                <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "12px", fontFamily: "var(--font-heading)", lineHeight: 1.2 }}>
                  Your AI Advisory Board
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "24px" }}>
                  Summon a team of specialized AI agents to debate, research, and collaborate on any challenge. Each agent brings unique expertise — and you can jump in to steer the conversation at any time.
                </div>
                <button
                  onClick={() => setShowLaunchModal(true)}
                  style={{
                    padding: "12px 32px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    fontFamily: "var(--font-heading)",
                    boxShadow: "0 4px 16px rgba(139,92,246,0.3)",
                    transition: "transform 150ms ease, box-shadow 150ms ease",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(139,92,246,0.4)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(139,92,246,0.3)"; }}
                >
                  <Plus size={16} /> Start New Session
                </button>
              </div>

              {/* Agent Showcase Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", maxWidth: "560px", width: "100%", marginBottom: "32px" }}>
                {[
                  { id: "Henry", specialty: "Orchestrates teams and synthesizes decisions" },
                  { id: "Quant", specialty: "Quantitative analysis and trading strategy" },
                  { id: "Scout", specialty: "Research, intelligence, and trend analysis" },
                  { id: "Atlas", specialty: "Stocks, options, and market execution" },
                  { id: "Pixel", specialty: "Full-stack engineering and rapid prototyping" },
                  { id: "Forge", specialty: "Backend architecture and infrastructure" },
                ].map((agent) => (
                  <div
                    key={agent.id}
                    style={{
                      padding: "16px 12px",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--surface)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "8px",
                      transition: "transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.4)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    }}
                  >
                    <AgentAvatar agentId={agent.id} size={44} borderWidth={2} />
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", textAlign: "center" }}>{agent.id}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.4 }}>{agent.specialty}</div>
                  </div>
                ))}
              </div>

              {/* Feature pills */}
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                {[
                  { icon: "🔄", label: "Roundtables" },
                  { icon: "🔍", label: "Review Loops" },
                  { icon: "👤", label: "Join Anytime" },
                  { icon: "🎭", label: "Persona Overlays" },
                ].map((f) => (
                  <span key={f.label} style={{ padding: "5px 14px", borderRadius: "20px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", fontSize: "11px", color: "var(--text-muted)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    {f.icon} {f.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR — toggleable panel for Participants & Session Info (no Legend) */}
      </div>

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}

      {showLaunchModal && (
        <LaunchWizard
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunch}
          customAgents={customAgents}
          onCustomAgentsChange={loadCustomAgents}
          onDeepDive={handleDeepDive}
        />
      )}

      {showCompareView && compareSessions[0] && compareSessions[1] && (
        <SessionComparison
          sessions={[compareSessions[0], compareSessions[1]]}
          onClose={() => setShowCompareView(false)}
        />
      )}

      {deepDiveAgent && (
        <DeepDiveModal
          agent={deepDiveAgent}
          onClose={() => setDeepDiveAgent(null)}
          onLaunch={handleLaunchDeepDive}
        />
      )}
    </>
  );
}
