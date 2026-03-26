"use client";

/**
 * PDF export for Advisory Board sessions using browser print API.
 * Opens a print-optimized view with white background and clean typography.
 */

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

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
    .replace(/[¡]/g, "")
    .replace(/[=]{3,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text: string): string[] {
  return cleanText(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);
}

function getRoleLabel(role: string, type: string): string {
  if (type === "approve") return "Approved";
  if (type === "reject") return "Rejected";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// ─── Print CSS ───────────────────────────────────────────────────────────────

function getPrintCSS(): string {
  return `
    @page {
      size: A4;
      margin: 1in 0.75in;
      @bottom-center {
        content: counter(page) " of " counter(pages);
        font-size: 9px;
        color: #94a3b8;
        font-family: "Inter", -apple-system, system-ui, sans-serif;
      }
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 11px;
      line-height: 1.7;
      color: #1e293b;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .pdf-container {
      max-width: 100%;
      padding: 0;
    }

    /* Header */
    .pdf-header {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e2e8f0;
    }

    .pdf-brand {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 2.5px;
      color: #6d28d9;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .pdf-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
      margin-bottom: 12px;
    }

    .pdf-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pdf-meta-chip {
      font-size: 9px;
      font-weight: 600;
      color: #475569;
      background: #f1f5f9;
      padding: 3px 10px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
    }

    /* Participants */
    .pdf-section-label {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 8px;
      margin-top: 20px;
    }

    .pdf-participants {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 20px;
    }

    .pdf-participant {
      font-size: 10px;
      font-weight: 600;
      color: #334155;
      background: #f8fafc;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    .pdf-divider {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 20px 0;
    }

    /* Round divider */
    .pdf-round-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0 16px;
      page-break-inside: avoid;
    }

    .pdf-round-divider::before,
    .pdf-round-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #cbd5e1;
    }

    .pdf-round-label {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
      white-space: nowrap;
    }

    /* Event blocks */
    .pdf-event {
      margin-bottom: 20px;
      padding: 16px 18px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      background: #fafbfc;
      page-break-inside: avoid;
    }

    .pdf-event-human {
      background: #fffbeb;
      border-color: #fde68a;
    }

    .pdf-event-supervisor {
      background: #fff7ed;
      border-color: #fed7aa;
    }

    .pdf-event-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f1f5f9;
    }

    .pdf-event-speaker {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
    }

    .pdf-event-role {
      font-size: 10px;
      color: #64748b;
      margin-left: 6px;
      font-weight: 500;
    }

    .pdf-event-badge {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.8px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
    }

    .pdf-badge-worker { color: #6d28d9; background: #f3e8ff; }
    .pdf-badge-supervisor { color: #c2410c; background: #fff7ed; }
    .pdf-badge-reviewer { color: #1d4ed8; background: #eff6ff; }
    .pdf-badge-approve { color: #15803d; background: #f0fdf4; }
    .pdf-badge-reject { color: #dc2626; background: #fef2f2; }
    .pdf-badge-human { color: #92400e; background: #fffbeb; }

    .pdf-event-time {
      font-size: 9px;
      color: #94a3b8;
      font-style: italic;
    }

    .pdf-event-model {
      font-size: 8px;
      color: #94a3b8;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
      margin-left: 8px;
    }

    .pdf-event-content p {
      font-size: 11px;
      color: #334155;
      line-height: 1.75;
      margin-bottom: 8px;
    }

    .pdf-event-content p:last-child {
      margin-bottom: 0;
    }

    /* Footer */
    .pdf-footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8px;
      color: #94a3b8;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8px 0.75in;
      background: #fff;
    }

    .pdf-footer-brand {
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
  `;
}

// ─── HTML generation ────────────────────────────────────────────────────────

function buildPrintHTML(session: PDFSession, events: PDFEvent[]): string {
  const dateStr = formatDate(session.createdAt);
  const modelsUsed = [...new Set(events.map((e) => e.model).filter(Boolean))];
  const modelsStr = modelsUsed.length > 0 ? modelsUsed.join(", ") : (session.model ?? "");

  const displayEvents = events.filter(
    (e) => e.text && e.speaker && e.type !== "start"
  );

  // Compute rounds
  const agentEvents = displayEvents.filter(
    (e) => e.speaker !== "Tim" && e.speaker !== "System" && e.type !== "complete" && e.type !== "error"
  );
  const roundForEvent = new Map<string, number>();
  let round = 1;
  const seenInRound = new Set<string>();
  for (const e of agentEvents) {
    if (seenInRound.has(e.speaker)) {
      round++;
      seenInRound.clear();
    }
    seenInRound.add(e.speaker);
    roundForEvent.set(e.id, round);
  }
  const totalRounds = round;
  // Backfill non-agent events
  let lastRound = 1;
  for (const e of displayEvents) {
    if (roundForEvent.has(e.id)) {
      lastRound = roundForEvent.get(e.id)!;
    } else {
      roundForEvent.set(e.id, lastRound);
    }
  }

  // Build meta chips
  const metaChips: string[] = [];
  metaChips.push(`<span class="pdf-meta-chip">${dateStr}</span>`);
  metaChips.push(`<span class="pdf-meta-chip">${session.mode === "review" ? "Review Loop" : "Roundtable"}</span>`);
  if (session.responseLength) {
    metaChips.push(`<span class="pdf-meta-chip">${session.responseLength.charAt(0).toUpperCase() + session.responseLength.slice(1)} responses</span>`);
  }
  if (modelsStr) {
    metaChips.push(`<span class="pdf-meta-chip">${escapeHTML(modelsStr)}</span>`);
  }
  if (session.status === "completed" && session.completedAt) {
    metaChips.push(`<span class="pdf-meta-chip">Completed ${formatDate(session.completedAt)}</span>`);
  }
  if (totalRounds > 1) {
    metaChips.push(`<span class="pdf-meta-chip">${totalRounds} rounds</span>`);
  }

  // Build participants
  const participants = session.agents
    .map((a) => `<span class="pdf-participant">${escapeHTML(a)}</span>`)
    .join("");

  // Build events
  let eventsHTML = "";
  let prevRound = 0;
  for (const event of displayEvents) {
    const eventRound = roundForEvent.get(event.id) ?? 1;

    // Round divider
    if (eventRound > prevRound && eventRound > 1) {
      eventsHTML += `<div class="pdf-round-divider"><span class="pdf-round-label">Round ${eventRound}${totalRounds > 1 ? ` of ${totalRounds}` : ""}</span></div>`;
    }
    prevRound = eventRound;

    const isHuman = event.speaker === "Tim";
    const paragraphs = splitParagraphs(event.text);
    const roleLabel = getRoleLabel(event.role, event.type);
    const badgeClass = event.type === "approve" ? "pdf-badge-approve"
      : event.type === "reject" ? "pdf-badge-reject"
      : isHuman ? "pdf-badge-human"
      : event.role === "supervisor" ? "pdf-badge-supervisor"
      : event.role === "reviewer" ? "pdf-badge-reviewer"
      : "pdf-badge-worker";
    const eventClass = isHuman ? "pdf-event pdf-event-human"
      : event.role === "supervisor" ? "pdf-event pdf-event-supervisor"
      : "pdf-event";

    const parasHTML = paragraphs.map((p) => `<p>${escapeHTML(p)}</p>`).join("");

    eventsHTML += `
      <div class="${eventClass}">
        <div class="pdf-event-header">
          <div>
            <span class="pdf-event-speaker">${event.emoji} ${escapeHTML(isHuman ? "Tim Harris" : event.speaker)}</span>
            <span class="pdf-event-role">— ${escapeHTML(isHuman ? "CEO" : roleLabel)}</span>
            <span class="pdf-event-badge ${badgeClass}">${escapeHTML(isHuman ? "HUMAN" : event.type === "approve" ? "APPROVED" : event.type === "reject" ? "REJECTED" : roleLabel.toUpperCase())}</span>
            ${event.model ? `<span class="pdf-event-model">${escapeHTML(event.model)}</span>` : ""}
          </div>
          <span class="pdf-event-time">${formatTime(event.timestamp)}</span>
        </div>
        <div class="pdf-event-content">${parasHTML}</div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Advisory Board — ${escapeHTML(session.topic)}</title>
  <style>${getPrintCSS()}</style>
</head>
<body>
  <div class="pdf-container">
    <div class="pdf-header">
      <div class="pdf-brand">Harris Autonomous — Advisory Board</div>
      <div class="pdf-title">${escapeHTML(session.topic)}</div>
      <div class="pdf-meta">${metaChips.join("")}</div>
    </div>

    <div class="pdf-section-label">Participants</div>
    <div class="pdf-participants">${participants}</div>

    <hr class="pdf-divider" />

    ${eventsHTML}

    <div class="pdf-footer">
      <span class="pdf-footer-brand">Harris Autonomous — Advisory Board</span>
      <span>Session: ${escapeHTML(session.id.slice(0, 8))}</span>
    </div>
  </div>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Export function ───────────────────────────────────────────────────────────

export async function exportSessionAsPDF(
  session: PDFSession,
  events: PDFEvent[]
): Promise<void> {
  const html = buildPrintHTML(session, events);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to export the PDF.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  // Wait for content to render before triggering print
  printWindow.addEventListener("load", () => {
    setTimeout(() => {
      printWindow.print();
    }, 300);
  });
  // Fallback in case load event already fired
  setTimeout(() => {
    printWindow.print();
  }, 800);
}
