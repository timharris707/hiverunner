import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { getSystemStats } from "@/lib/system-stats";

const execAsync = promisify(exec);

// Services monitored per backend
const SYSTEMD_SERVICES: string[] = [];
const PM2_SERVICES: string[] = [];
// Placeholder services (not yet deployed on this Mac)
const PLACEHOLDER_SERVICES: Array<{ name: string; description: string; status: string }> = [];

interface ServiceEntry {
  name: string;
  status: string;
  description: string;
  backend: string;
  uptime?: number | null;
  restarts?: number;
  pid?: number | null;
  mem?: number | null;
  cpu?: number | null;
}

interface TailscaleDevice {
  hostname: string;
  ip: string;
  os: string;
  online: boolean;
}

interface FirewallRule {
  port: string;
  action: string;
  from: string;
  comment: string;
}

// Normalize PM2 status to a common set
function normalizePm2Status(status: string): string {
  switch (status) {
    case "online":
      return "active";
    case "stopped":
    case "stopping":
      return "inactive";
    case "errored":
    case "error":
      return "failed";
    case "launching":
    case "waiting restart":
      return "activating";
    default:
      return status;
  }
}

// Friendly display names for PM2 process names
const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "hiverunner": "HiveRunner",
  classvault: "ClassVault – LMS Platform",
  "content-vault": "Content Vault – Draft Management Webapp",
  "postiz-simple": "Postiz – Social Media Scheduler",
  brain: "Brain – Internal Tools",
  creatoros: "Creatoros Platform",
};

export async function GET() {
  try {
    // ── CPU ──────────────────────────────────────────────────────────────────
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg();
    const cpuUsage = Math.min(Math.round((loadAvg[0] / cpuCount) * 100), 100);

    // ── RAM ──────────────────────────────────────────────────────────────────
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // ── Disk ─────────────────────────────────────────────────────────────────
    let diskTotal = 100;
    let diskUsed = 0;
    let diskFree = 100;
    try {
      const stats = await getSystemStats();
      diskTotal = stats.disk.total;
      diskUsed = stats.disk.used;
      diskFree = Math.max(0, diskTotal - diskUsed);
    } catch (error) {
      console.error("Failed to get disk stats:", error);
    }
    const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

    // ── Network (macOS/Linux compatible) ───────────────────────────────────────
    let network = { rx: 0, tx: 0 };
    try {
      // Try to get actual stats on macOS via netstat
      try {
        const { stdout: netstatOut } = await execAsync("netstat -ibn 2>/dev/null | grep -v Name | grep -v lo0 | awk 'NR==1{print $7, $10}'");
        const parts = netstatOut.trim().split(/\s+/);
        if (parts.length >= 2) {
          network = {
            rx: parseFloat((parseInt(parts[0] || '0') / 1024 / 1024).toFixed(3)),
            tx: parseFloat((parseInt(parts[1] || '0') / 1024 / 1024).toFixed(3)),
          };
        }
      } catch {
        // Fallback: try /proc/net/dev for Linux
        try {
          const { readFileSync } = await import('fs');
          const netDev = readFileSync('/proc/net/dev', 'utf-8');
          const lines = netDev.trim().split('\n').slice(2);
          let rx = 0, tx = 0;
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const iface = parts[0].replace(':', '');
            if (iface === 'lo') continue;
            rx += parseInt(parts[1]) || 0;
            tx += parseInt(parts[9]) || 0;
          }
          // Use module-level cache for per-second rate
          const current = { rx, tx, ts: Date.now() };
          if ((global as Record<string, unknown>).__netPrev) {
            const prev = (global as Record<string, unknown>).__netPrev as { rx: number; tx: number; ts: number };
            const dtSec = (current.ts - prev.ts) / 1000;
            if (dtSec > 0) {
              network = {
                rx: parseFloat(Math.max(0, (current.rx - prev.rx) / 1024 / 1024 / dtSec).toFixed(3)),
                tx: parseFloat(Math.max(0, (current.tx - prev.tx) / 1024 / 1024 / dtSec).toFixed(3)),
              };
            }
          }
          (global as Record<string, unknown>).__netPrev = current;
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error("Failed to get network stats:", error);
    }

    // ── Services ─────────────────────────────────────────────────────────────
    const services: ServiceEntry[] = [];

    // 1. Systemd services (Linux only — skip gracefully on macOS)
    for (const name of SYSTEMD_SERVICES) {
      try {
        const { stdout } = await execAsync(`which systemctl > /dev/null 2>&1 && systemctl is-active ${name} 2>/dev/null || echo "not_applicable"`);
        const rawStatus = stdout.trim();
        services.push({
          name,
          status: rawStatus === "not_applicable" ? "n/a" : rawStatus,
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "systemd",
        });
      } catch {
        services.push({
          name,
          status: "n/a",
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "systemd",
        });
      }
    }

    // 2. PM2 services — single call, parse JSON
    try {
      const { stdout: pm2Json } = await execAsync("pm2 jlist 2>/dev/null");
      const pm2List = JSON.parse(pm2Json) as Array<{
        name: string;
        pid: number | null;
        pm2_env: {
          status: string;
          pm_uptime?: number;
          restart_time?: number;
          monit?: { cpu: number; memory: number };
        };
      }>;

      const pm2Map: Record<string, (typeof pm2List)[0]> = {};
      for (const proc of pm2List) {
        pm2Map[proc.name] = proc;
      }

      for (const name of PM2_SERVICES) {
        const proc = pm2Map[name];
        if (!proc) {
          services.push({
            name,
            status: "unknown",
            description: SERVICE_DESCRIPTIONS[name] ?? name,
            backend: "pm2",
          });
          continue;
        }

        const rawStatus = proc.pm2_env?.status ?? "unknown";
        const uptime =
          rawStatus === "online" && proc.pm2_env?.pm_uptime
            ? Date.now() - proc.pm2_env.pm_uptime
            : null;

        services.push({
          name,
          status: normalizePm2Status(rawStatus),
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "pm2",
          uptime,
          restarts: proc.pm2_env?.restart_time ?? 0,
          pid: proc.pid,
          cpu: proc.pm2_env?.monit?.cpu ?? null,
          mem: proc.pm2_env?.monit?.memory ?? null,
        });
      }
    } catch (err) {
      console.error("Failed to query PM2:", err);
      // Fallback: mark all PM2 services as unknown
      for (const name of PM2_SERVICES) {
        services.push({
          name,
          status: "unknown",
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "pm2",
        });
      }
    }

    // 3. Placeholder services (not yet deployed)
    for (const svc of PLACEHOLDER_SERVICES) {
      services.push({ ...svc, backend: "none" });
    }

    // ── Detect running local processes ────────────────────────────────────────
    try {
      // Add HiveRunner itself
      try {
        const { stdout: mcCheck } = await execAsync(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${process.env.PORT || "3010"}/api/health 2>/dev/null || echo '000'`);
        const mcStatus = mcCheck.trim() === "200" ? "active" : "unknown";
        services.push({
          name: "hiverunner",
          status: mcStatus,
          description: "HiveRunner — Dashboard",
          backend: "local",
        });
      } catch {
        services.push({ name: "hiverunner", status: "unknown", description: "HiveRunner — Dashboard", backend: "local" });
      }

      // Add optional OpenClaw runtime if it is present locally.
      try {
        const { stdout: ocCheck } = await execAsync("pgrep -f 'openclaw' > /dev/null 2>&1 && echo 'active' || echo 'inactive'");
        services.push({
          name: "openclaw",
          status: ocCheck.trim(),
          description: "OpenClaw — optional runtime",
          backend: "local",
        });
      } catch {
        services.push({ name: "openclaw", status: "unknown", description: "OpenClaw — optional runtime", backend: "local" });
      }
    } catch (err) {
      console.error("Failed to detect local processes:", err);
    }

    // ── Tailscale VPN ─────────────────────────────────────────────────────────
    let tailscaleActive = false;
    let tailscaleIp = "";
    const tailscaleDevices: TailscaleDevice[] = [];
    try {
      const { stdout: tsStatus } = await execAsync("tailscale status 2>/dev/null || true");
      const lines = tsStatus.trim().split("\n").filter(Boolean);
      if (lines.length > 0 && !tsStatus.includes("not running")) {
        tailscaleActive = true;
        for (const line of lines) {
          if (line.startsWith("#")) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            tailscaleDevices.push({
              ip: parts[0],
              hostname: parts[1],
              os: parts[3] || "",
              online: line.includes("active"),
            });
          }
        }
        if (tailscaleDevices.length > 0) {
          tailscaleIp = tailscaleDevices[0].ip || tailscaleIp;
        }
      }
    } catch (error) {
      console.error("Failed to get Tailscale status:", error);
    }

    // ── Firewall (macOS or UFW) ───────────────────────────────────────────────
    let firewallActive = false;
    const firewallRulesList: FirewallRule[] = [];
    try {
      // Try macOS firewall status
      const { stdout: macFw } = await execAsync("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || true");
      if (macFw.includes("enabled") || macFw.includes("ENABLED")) {
        firewallActive = true;
        firewallRulesList.push({ port: "System", action: "ENABLED", from: "macOS ALF", comment: "Application Layer Firewall active" });
      }
    } catch {
      // Try UFW as fallback
      try {
        const { stdout: ufwStatus } = await execAsync("ufw status numbered 2>/dev/null || true");
        if (ufwStatus.includes("Status: active")) {
          firewallActive = true;
          const lines = ufwStatus.split("\n");
          for (const line of lines) {
            const match = line.match(/\[\s*\d+\]\s+([\w/:]+)\s+(\w+)\s+(\S+)\s*(#?.*)$/);
            if (match) {
              firewallRulesList.push({
                port: match[1].trim(),
                action: match[2].trim(),
                from: match[3].trim(),
                comment: match[4].replace("#", "").trim(),
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      cpu: {
        usage: cpuUsage,
        cores: os.cpus().map(() => Math.round(Math.random() * 100)),
        loadAvg,
      },
      ram: {
        total: parseFloat((totalMem / 1024 / 1024 / 1024).toFixed(2)),
        used: parseFloat((usedMem / 1024 / 1024 / 1024).toFixed(2)),
        free: parseFloat((freeMem / 1024 / 1024 / 1024).toFixed(2)),
        cached: 0,
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        percent: diskPercent,
      },
      network,
      systemd: services, // kept field name for backwards compat with page.tsx
      tailscale: {
        active: tailscaleActive,
        ip: tailscaleIp,
        devices: tailscaleDevices,
      },
      firewall: {
        active: firewallActive,
        rules: firewallRulesList,
        ruleCount: firewallRulesList.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching system monitor data:", error);
    return NextResponse.json(
      { error: "Failed to fetch system monitor data" },
      { status: 500 }
    );
  }
}
