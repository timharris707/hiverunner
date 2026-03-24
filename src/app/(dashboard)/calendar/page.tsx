"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock, RefreshCw, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | { kind?: string; expr?: string; tz?: string };
  scheduleHuman: string;
  scheduleDisplay?: string;
  nextRunAt?: string | null;
  nextRun?: string | null;
  lastRunAt?: string | null;
  lastRun?: string | null;
  lastStatus?: string;
  color?: string;
  emoji?: string;
}

interface DaySlot {
  hour: number;
  jobs: CronJob[];
}

const JOB_COLORS: Record<string, { color: string; emoji: string }> = {
  "Morning Brief": { color: "#f59e0b", emoji: "🌅" },
  "Evening Brief": { color: "#a78bfa", emoji: "🌙" },
  "Overnight Employee": { color: "#60a5fa", emoji: "🤖" },
  "Git Backup": { color: "#4ade80", emoji: "🔄" },
};

function getJobStyle(name: string) {
  for (const [key, val] of Object.entries(JOB_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return { color: "var(--accent)", emoji: "⚡" };
}

function parseCronHour(expr: string | Record<string, unknown>): number | null {
  // "0 7 * * *" → 7, or { kind: "cron", expr: "0 7 * * *" } → 7
  const raw = typeof expr === 'string' ? expr : (expr?.expr as string || '');
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const hour = parseInt(parts[1], 10);
  return isNaN(hour) ? null : hour;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatHour(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export default function CalendarPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    fetch("/api/cron")
      .then(r => r.json())
      .then((data: CronJob[]) => {
        const mapped = (Array.isArray(data) ? data : []).map((j) => ({
          ...j,
          scheduleHuman: j.scheduleHuman || j.scheduleDisplay || (typeof j.schedule === 'string' ? j.schedule : (j.schedule as { expr?: string })?.expr || ''),
          nextRunAt: j.nextRunAt || j.nextRun || null,
          lastRunAt: j.lastRunAt || j.lastRun || null,
        }));
        setJobs(mapped);
      })
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  // Get the week's dates
  const getWeekDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  };

  const weekDates = getWeekDates();

  // Build hourly slots for each day
  const getSlotsForDay = (dayIndex: number): DaySlot[] => {
    return HOURS.map(hour => ({
      hour,
      jobs: jobs.filter(job => {
        if (!job.enabled) return false;
        const expr = typeof job.schedule === 'string' ? job.schedule : (job.schedule?.expr || '');
        if (!expr) return false;
        const parts = expr.trim().split(/\s+/);
        if (parts.length < 5) return false;
        const jobHour = parseInt(parts[1], 10);
        const jobDow = parts[4]; // 0-6 or *
        if (isNaN(jobHour) || jobHour !== hour) return false;
        if (jobDow === '*') return true;
        // dayIndex 0=Mon → dow 1=Mon
        const targetDow = dayIndex === 6 ? 0 : dayIndex + 1;
        return jobDow.split(',').map(Number).includes(targetDow);
      }),
    }));
  };

  const today = new Date();
  const todayDayIndex = today.getDay() === 0 ? 6 : today.getDay() - 1;

  // Timeline: show 6am–midnight only
  const visibleHours = HOURS.filter(h => h >= 6 && h <= 23);

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold mb-1"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
          >
            <Calendar className="inline-block w-7 h-7 mr-2 mb-1" style={{ color: "var(--accent)" }} />
            Calendar
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Cron job schedule — visual timeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(0)}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: weekOffset === 0 ? "var(--accent)" : "var(--card)", color: weekOffset === 0 ? "white" : "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-2 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="p-2 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setLoading(true); fetch("/api/cron").then(r => r.json()).then(d => { setJobs(d); setLoading(false); }); }}
            className="p-2 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Upcoming cron jobs */}
      <div
        className="mb-6 p-4 rounded-xl"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          Active Scheduled Jobs
        </h2>
        {loading ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {jobs.filter(j => j.enabled).map(job => {
              const style = getJobStyle(job.name);
              return (
                <div
                  key={job.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: `${style.color}15`,
                    border: `1px solid ${style.color}40`,
                  }}
                >
                  <span>{style.emoji}</span>
                  <span style={{ color: "var(--text-primary)" }}>{job.name}</span>
                  <span style={{ color: style.color }}>{job.scheduleHuman}</span>
                  {job.nextRunAt && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      next: {new Date(job.nextRunAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              );
            })}
            {jobs.filter(j => j.enabled).length === 0 && (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>No active jobs</span>
            )}
          </div>
        )}
      </div>

      {/* Weekly calendar grid */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Day headers */}
        <div className="grid" style={{ gridTemplateColumns: "60px repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ borderRight: "1px solid var(--border)" }} />
          {weekDates.map((date, i) => {
            const isToday = weekOffset === 0 && i === todayDayIndex;
            return (
              <div
                key={i}
                className="p-3 text-center"
                style={{
                  borderRight: i < 6 ? "1px solid var(--border)" : "none",
                  backgroundColor: isToday ? "var(--accent)10" : "transparent",
                }}
              >
                <div className="text-xs font-medium uppercase" style={{ color: "var(--text-muted)" }}>
                  {DAYS[i]}
                </div>
                <div
                  className="text-lg font-bold mt-0.5"
                  style={{ color: isToday ? "var(--accent)" : "var(--text-primary)" }}
                >
                  {date.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time rows */}
        <div className="overflow-y-auto" style={{ maxHeight: "500px" }}>
          {visibleHours.map(hour => {
            const hasAnyJob = DAYS.some((_, di) => getSlotsForDay(di).find(s => s.hour === hour)?.jobs.length);
            return (
              <div
                key={hour}
                className="grid"
                style={{
                  gridTemplateColumns: "60px repeat(7, 1fr)",
                  borderBottom: "1px solid var(--border)",
                  minHeight: "44px",
                  backgroundColor: hasAnyJob ? "var(--accent)04" : "transparent",
                }}
              >
                {/* Hour label */}
                <div
                  className="flex items-center justify-end pr-3 text-xs"
                  style={{ color: "var(--text-muted)", borderRight: "1px solid var(--border)" }}
                >
                  {formatHour(hour)}
                </div>

                {/* Day cells */}
                {DAYS.map((_, dayIndex) => {
                  const isToday = weekOffset === 0 && dayIndex === todayDayIndex;
                  const slotJobs = getSlotsForDay(dayIndex).find(s => s.hour === hour)?.jobs || [];
                  return (
                    <div
                      key={dayIndex}
                      className="p-1"
                      style={{
                        borderRight: dayIndex < 6 ? "1px solid var(--border)" : "none",
                        backgroundColor: isToday ? "var(--accent)05" : "transparent",
                      }}
                    >
                      {slotJobs.map(job => {
                        const style = getJobStyle(job.name);
                        return (
                          <Link
                            key={job.id}
                            href="/cron"
                            className="block text-xs rounded px-1.5 py-1 mb-0.5 truncate"
                            style={{
                              backgroundColor: `${style.color}20`,
                              borderLeft: `2px solid ${style.color}`,
                              color: "var(--text-primary)",
                            }}
                            title={`${job.name} — ${job.scheduleHuman}`}
                          >
                            {style.emoji} {job.name}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Legend:</span>
        {Object.entries(JOB_COLORS).map(([name, { color, emoji }]) => (
          <div key={name} className="flex items-center gap-1.5 text-xs">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: `${color}40`, border: `1px solid ${color}` }} />
            <span style={{ color: "var(--text-secondary)" }}>{emoji} {name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
