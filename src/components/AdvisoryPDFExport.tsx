"use client";

/**
 * PDF export for Advisory Board sessions using @react-pdf/renderer
 * Generates a professionally formatted document suitable for client delivery.
 */

import { Document, Page, Text, View, StyleSheet, Font, pdf } from "@react-pdf/renderer";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PDFEvent {
  id: string;
  timestamp: string;
  type: string;
  speaker: string;
  emoji: string;
  role: string;
  text: string;
  model?: string;
}

export interface PDFSession {
  id: string;
  topic: string;
  mode: string;
  agents: string[];
  createdAt: string;
  completedAt?: string;
  status: string;
  model?: string;
  reviewStyle?: string;
  responseLength?: string;
  rounds?: number | string;
  [key: string]: unknown;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: "#0f0f14",
    color: "#e2e8f0",
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    marginBottom: 28,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d3d",
    paddingBottom: 20,
  },
  headerBrand: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2.5,
    color: "#8b5cf6",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#f1f5f9",
    marginBottom: 8,
    lineHeight: 1.3,
  },
  headerMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  headerMetaChip: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#94a3b8",
    backgroundColor: "#1a1a24",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#2d2d3d",
    letterSpacing: 0.5,
  },

  // ── Participants ────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: "#64748b",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  participantsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  participantChip: {
    fontSize: 9,
    color: "#94a3b8",
    backgroundColor: "#1a1a24",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#2d2d3d",
  },

  // ── Divider ─────────────────────────────────────────────────────────────────
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d3d",
    marginVertical: 18,
  },

  // ── Event bubble ────────────────────────────────────────────────────────────
  eventContainer: {
    marginBottom: 18,
    backgroundColor: "#14141e",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2d2d3d",
    padding: 14,
  },
  eventContainerSupervisor: {
    borderColor: "#4a3728",
    backgroundColor: "#141210",
  },
  eventContainerReviewer: {
    borderColor: "#1e2d3d",
    backgroundColor: "#101420",
  },
  eventContainerApprove: {
    borderColor: "#1e3828",
    backgroundColor: "#101814",
  },
  eventContainerReject: {
    borderColor: "#3d1e1e",
    backgroundColor: "#140f0f",
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    justifyContent: "space-between",
  },
  eventHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  eventEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  eventSpeaker: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#f1f5f9",
  },
  eventRole: {
    fontSize: 9,
    color: "#64748b",
    marginLeft: 4,
  },
  eventTime: {
    fontSize: 8,
    color: "#475569",
    fontFamily: "Helvetica-Oblique",
  },
  roleBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 3,
    marginLeft: 6,
  },

  // ── Event content ────────────────────────────────────────────────────────────
  eventContent: {
    paddingLeft: 0,
  },
  paragraph: {
    fontSize: 10,
    color: "#cbd5e1",
    lineHeight: 1.7,
    marginBottom: 7,
    textIndent: 18,
  },
  paragraphFirst: {
    fontSize: 10,
    color: "#cbd5e1",
    lineHeight: 1.7,
    marginBottom: 7,
    textIndent: 0,
  },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 20,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#2d2d3d",
    paddingTop: 8,
  },
  footerBrand: {
    fontSize: 7,
    color: "#475569",
    letterSpacing: 1,
    fontFamily: "Helvetica-Bold",
  },
  footerPage: {
    fontSize: 7,
    color: "#475569",
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// Strip markdown for clean PDF text
function cleanText(text: string): string {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split text into paragraphs
function splitParagraphs(text: string): string[] {
  return cleanText(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);
}

function getEventBorderStyle(event: PDFEvent) {
  if (event.type === "approve") return styles.eventContainerApprove;
  if (event.type === "reject") return styles.eventContainerReject;
  if (event.role === "supervisor") return styles.eventContainerSupervisor;
  if (event.role === "reviewer") return styles.eventContainerReviewer;
  return {};
}

function getRoleBadgeColor(role: string, type: string): { color: string; bg: string } {
  if (type === "approve") return { color: "#4ade80", bg: "#1e3828" };
  if (type === "reject") return { color: "#ef4444", bg: "#3d1e1e" };
  if (role === "supervisor") return { color: "#fb923c", bg: "#2a1a0a" };
  if (role === "reviewer") return { color: "#60a5fa", bg: "#0a1a2a" };
  return { color: "#94a3b8", bg: "#1a1a24" };
}

// ─── PDF Document Component ───────────────────────────────────────────────────

function AdvisoryPDFDocument({
  session,
  events,
}: {
  session: PDFSession;
  events: PDFEvent[];
}) {
  const dateStr = formatDate(session.createdAt);
  const modelsUsed = [...new Set(events.map((e) => e.model).filter(Boolean))];
  const modelsStr = modelsUsed.length > 0 ? modelsUsed.join(", ") : (session.model ?? "N/A");

  const displayEvents = events.filter(
    (e) => e.text && e.speaker && e.type !== "start"
  );

  return (
    <Document
      title={`Advisory Board — ${session.topic}`}
      author="Harris Autonomous"
      subject="Advisory Board Session Transcript"
      creator="Mission Control — Harris Autonomous"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerBrand}>Harris Autonomous — Advisory Board</Text>
          <Text style={styles.headerTitle}>{session.topic}</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerMetaChip}>📅 {dateStr}</Text>
            <Text style={styles.headerMetaChip}>
              {session.mode === "review" ? "🔍 Review Loop" : "🔄 Roundtable"}
            </Text>
            <Text style={styles.headerMetaChip}>
              {(session.responseLength ?? "balanced").charAt(0).toUpperCase() +
                (session.responseLength ?? "balanced").slice(1)} responses
            </Text>
            {modelsStr !== "N/A" && (
              <Text style={styles.headerMetaChip}>🤖 {modelsStr}</Text>
            )}
            {session.status === "completed" && session.completedAt && (
              <Text style={styles.headerMetaChip}>✅ Completed {formatDate(session.completedAt)}</Text>
            )}
          </View>
        </View>

        {/* Participants */}
        <Text style={styles.sectionLabel}>Participants</Text>
        <View style={styles.participantsGrid}>
          {session.agents.map((agentId) => (
            <Text key={agentId} style={styles.participantChip}>
              {agentId}
            </Text>
          ))}
        </View>

        <View style={styles.divider} />

        {/* Events */}
        {displayEvents.map((event, idx) => {
          const paragraphs = splitParagraphs(event.text);
          const badgeColors = getRoleBadgeColor(event.role, event.type);

          return (
            <View key={event.id} style={[styles.eventContainer, getEventBorderStyle(event)]} wrap={false}>
              {/* Event header */}
              <View style={styles.eventHeader}>
                <View style={styles.eventHeaderLeft}>
                  <Text style={styles.eventSpeaker}>{event.speaker}</Text>
                  <Text style={styles.eventRole}>
                    — {event.role.charAt(0).toUpperCase() + event.role.slice(1)}
                  </Text>
                  <Text
                    style={[
                      styles.roleBadge,
                      {
                        color: badgeColors.color,
                        backgroundColor: badgeColors.bg,
                      },
                    ]}
                  >
                    {event.role.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.eventTime}>{formatTime(event.timestamp)}</Text>
              </View>

              {/* Content paragraphs */}
              <View style={styles.eventContent}>
                {paragraphs.map((para, pIdx) => (
                  <Text
                    key={pIdx}
                    style={pIdx === 0 ? styles.paragraphFirst : styles.paragraph}
                  >
                    {para}
                  </Text>
                ))}
              </View>
            </View>
          );
        })}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerBrand}>HARRIS AUTONOMOUS — ADVISORY BOARD</Text>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

// ─── Export function ───────────────────────────────────────────────────────────

export async function exportSessionAsPDF(
  session: PDFSession,
  events: PDFEvent[]
): Promise<void> {
  const doc = <AdvisoryPDFDocument session={session} events={events} />;
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const dateStr = new Date(session.createdAt).toISOString().split("T")[0];
  const topicSlug = session.topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fileName = `advisory-${dateStr}-${topicSlug}.pdf`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
