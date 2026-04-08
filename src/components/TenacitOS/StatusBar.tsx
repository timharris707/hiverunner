"use client";

import { useEffect, useState } from "react";
import { Cpu, HardDrive, MemoryStick, Shield, ShieldCheck, Clock } from "lucide-react";
import { useMissionControlRealtime } from "@/components/live/RealtimeProvider";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "./Dock";
import { useDockCollapsed } from "@/lib/dock-state";

import type { SystemStats } from "@/lib/system-stats";

export function StatusBar() {
  const { collapsed: dockCollapsed } = useDockCollapsed();
  const realtime = useMissionControlRealtime();
  const [stats, setStats] = useState<SystemStats>({
    cpu: 0,
    ram: { used: 0, total: 4 },
    disk: { used: 0, total: 100 },
    vpnActive: false,
    firewallActive: true,
    activeServices: 0,
    totalServices: 4,
    uptime: "0d 0h",
  });
  const liveStats = realtime?.snapshot?.systemStats;

  useEffect(() => {
    if (liveStats) {
      setStats(liveStats);
    }
  }, [liveStats]);

  useEffect(() => {
    if (liveStats) {
      return;
    }

    const fetchStats = async () => {
      try {
        const res = await fetch("/api/system/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (error) {
        console.error("Failed to fetch system stats:", error);
      }
    };

    fetchStats();
    const STATS_POLL_MS = process.env.NODE_ENV === "development" ? 30_000 : 10_000;
    const interval = setInterval(fetchStats, STATS_POLL_MS);

    return () => clearInterval(interval);
  }, [liveStats]);

  const cpuColor = stats.cpu < 60 ? "var(--positive)" : stats.cpu < 85 ? "var(--warning)" : "var(--negative)";
  const ramPercent = (stats.ram.used / stats.ram.total) * 100;
  const ramColor = ramPercent < 60 ? "var(--positive)" : ramPercent < 85 ? "var(--warning)" : "var(--negative)";
  const diskPercent = (stats.disk.used / stats.disk.total) * 100;
  const diskColor = diskPercent < 60 ? "var(--positive)" : diskPercent < 85 ? "var(--warning)" : "var(--negative)";

  // StatusMetric component
  const StatusMetric = ({ icon: Icon, label, value, barPercent, color }: any) => (
    <div className="flex items-center gap-1.5" style={{ height: "24px" }}>
      <Icon style={{ width: "14px", height: "14px", color: "var(--text-muted)" }} />
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "1px",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--text-secondary)",
        }}
      >
        {value}
      </span>
      {barPercent !== undefined && (
        <div
          style={{
            width: "48px",
            height: "4px",
            backgroundColor: "var(--surface-elevated)",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, barPercent)}%`,
              height: "100%",
              backgroundColor: color,
              borderRadius: "2px",
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      className="status-bar"
      style={{
        position: "fixed",
        bottom: 0,
        left: `${dockCollapsed ? DOCK_COLLAPSED_WIDTH : DOCK_WIDTH}px`,
        right: 0,
        height: "32px",
        backgroundColor: "var(--bg)",
        borderTop: "0.5px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: "16px",
        zIndex: 51,
      }}
    >
      {/* CPU */}
      <StatusMetric icon={Cpu} label="CPU" value={`${stats.cpu}%`} barPercent={stats.cpu} color={cpuColor} />

      {/* RAM */}
      <StatusMetric
        icon={MemoryStick}
        label="RAM"
        value={`${stats.ram.used.toFixed(1)}/${stats.ram.total}GB`}
        barPercent={ramPercent}
        color={ramColor}
      />

      {/* Disk */}
      <StatusMetric
        icon={HardDrive}
        label="DISK"
        value={`${diskPercent.toFixed(0)}%`}
        barPercent={diskPercent}
        color={diskColor}
      />

      {/* Separator */}
      <div style={{ width: "1px", height: "16px", backgroundColor: "var(--border)" }} />

      {/* VPN Status */}
      <div className="flex items-center gap-1">
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: stats.vpnActive ? "var(--positive)" : "var(--negative)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "1px",
            color: "var(--text-muted)",
          }}
        >
          VPN
        </span>
      </div>

      {/* Firewall Status */}
      <div className="flex items-center gap-1">
        <ShieldCheck
          style={{
            width: "12px",
            height: "12px",
            color: stats.firewallActive ? "var(--positive)" : "var(--negative)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "1px",
            color: "var(--text-muted)",
          }}
        >
          UFW
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: "1px", height: "16px", backgroundColor: "var(--border)" }} />

      {/* Systemd Services */}
      <div className="flex items-center gap-1">
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "10px",
            fontWeight: 500,
            color: "var(--text-muted)",
          }}
        >
          SVC: {stats.activeServices}/{stats.totalServices}
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: "1px", height: "16px", backgroundColor: "var(--border)" }} />

      {/* Uptime */}
      <div className="flex items-center gap-1">
        <Clock style={{ width: "12px", height: "12px", color: "var(--text-muted)" }} />
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "10px",
            fontWeight: 500,
            color: "var(--text-muted)",
          }}
        >
          Uptime: {stats.uptime}
        </span>
      </div>
    </div>
  );
}
