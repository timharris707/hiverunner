import { exec } from "child_process";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

const LAUNCHD_SERVICES = ["com.harris-autonomous.hr-dev", "com.harris-autonomous.hr-stable", "com.harris-autonomous.mc-dev", "com.harris-autonomous.mc-stable"];
const SYSTEMD_SERVICES = ["hiverunner"];
const STATS_CACHE_MS = 30 * 1000;

export interface SystemStats {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  vpnActive: boolean;
  firewallActive: boolean;
  activeServices: number;
  totalServices: number;
  uptime: string;
}

let statsCache: { data: SystemStats; ts: number } | null = null;

export async function getSystemStats(now = Date.now()): Promise<SystemStats> {
  if (statsCache && now - statsCache.ts < STATS_CACHE_MS) {
    return statsCache.data;
  }

  const loadAvg = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpu = Math.min(Math.round((loadAvg / cpuCount) * 100), 100);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ram = {
    used: parseFloat((usedMem / 1024 / 1024 / 1024).toFixed(2)),
    total: parseFloat((totalMem / 1024 / 1024 / 1024).toFixed(2)),
  };

  let diskUsed = 0;
  let diskTotal = 100;
  try {
    const dfCommand = process.platform === "darwin" ? "df -g / | tail -1" : "df -BG / | tail -1";
    const { stdout } = await execAsync(dfCommand);
    const parts = stdout.trim().split(/\s+/);
    const totalToken = parts[1] ?? "";
    const usedToken = parts[2] ?? "";
    const totalParsed = parseInt(totalToken.replace(/[^0-9]/g, ""), 10);
    const usedParsed = parseInt(usedToken.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(totalParsed) && totalParsed > 0) diskTotal = totalParsed;
    if (Number.isFinite(usedParsed) && usedParsed >= 0) diskUsed = usedParsed;
  } catch (error) {
    console.error("Failed to get disk stats:", error);
  }

  let activeServices = 0;
  let totalServices = process.platform === "darwin" ? LAUNCHD_SERVICES.length : SYSTEMD_SERVICES.length;
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execAsync("launchctl list 2>/dev/null || true");
      for (const name of LAUNCHD_SERVICES) {
        const line = stdout.split("\n").find((item) => item.includes(name));
        const pid = line?.trim().split(/\s+/)[0] ?? "-";
        if (pid !== "-") activeServices++;
      }
    } catch (error) {
      console.error("Failed to get launchd stats:", error);
      totalServices = 0;
    }
  } else {
    try {
      for (const name of SYSTEMD_SERVICES) {
        const { stdout } = await execAsync(`systemctl is-active ${name} 2>/dev/null || true`);
        if (stdout.trim() === "active") activeServices++;
      }
    } catch (error) {
      console.error("Failed to get systemd stats:", error);
    }
  }

  let vpnActive = false;
  try {
    const { stdout } = await execAsync("tailscale status 2>/dev/null || true");
    vpnActive = stdout.trim().length > 0 && !stdout.includes("Tailscale is stopped");
  } catch {
    vpnActive = true;
  }

  let firewallActive = true;
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execAsync("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || true");
      firewallActive = /enabled/i.test(stdout);
    } else {
      const { stdout } = await execAsync("ufw status 2>/dev/null | head -1 || true");
      firewallActive = stdout.includes("active");
    }
  } catch {
    firewallActive = true;
  }

  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const uptime = `${days}d ${hours}h`;

  const result: SystemStats = {
    cpu,
    ram,
    disk: { used: diskUsed, total: diskTotal },
    vpnActive,
    firewallActive,
    activeServices,
    totalServices,
    uptime,
  };

  statsCache = { data: result, ts: now };
  return result;
}
