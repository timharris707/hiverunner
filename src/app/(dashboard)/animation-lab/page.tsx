"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  Bot,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Boxes,
  Compass,
  Cog,
  Coins,
  Crosshair,
  Cpu,
  FileText,
  FolderKanban,
  FolderOpen,
  Goal,
  HandCoins,
  Inbox,
  Lightbulb,
  ListChecks,
  Logs,
  MapPin,
  Megaphone,
  MessagesSquare,
  Mic,
  Monitor,
  PanelTop,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Terminal,
  TrendingUp,
  UserPlus,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";

import { HiveRunnerMarkIcon } from "@/components/HiveRunnerMarkIcon";
import { OrgChartBuildIcon as OrgChartWideBuildIcon } from "@/components/OrgChartBuildIcon";
import { AnimatedFolderOpenIcon } from "@/components/AnimatedFolderOpenIcon";
import { DashboardWidgetBoardIcon } from "@/components/DashboardWidgetBoardIcon";
import { RoutineRouteMoveIcon } from "@/components/RoutineRouteMoveIcon";
import { SlidersLeverMotionIcon } from "@/components/SlidersLeverMotionIcon";
import { FolderOpenStayIcon } from "@/components/FolderOpenStayIcon";
import { FolderDrawCycleIcon } from "@/components/FolderDrawCycleIcon";

type Candidate = {
  label: string;
  group: string;
  motion: string;
  icon: LucideIcon;
};

type NavTarget = {
  group: string;
  label: string;
  icon: LucideIcon;
  motions: string[];
};

const OrgChartBuildIcon = (({ size = 30, strokeWidth = 1.8 }) => (
  <svg
    className="org-chart-build-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect className="org-chart-node org-chart-node-top" x="9" y="2.75" width="6" height="4.6" rx="1.25" />
    <path className="org-chart-line org-chart-line-stem" d="M12 7.35v3.15" />
    <path className="org-chart-line org-chart-line-branch" d="M5.5 10.5h13" />
    <path className="org-chart-line org-chart-line-left" d="M5.5 10.5v3" />
    <path className="org-chart-line org-chart-line-mid" d="M12 10.5v3" />
    <path className="org-chart-line org-chart-line-right" d="M18.5 10.5v3" />
    <rect className="org-chart-node org-chart-node-left" x="2.5" y="13.5" width="6" height="4.6" rx="1.25" />
    <rect className="org-chart-node org-chart-node-mid" x="9" y="13.5" width="6" height="4.6" rx="1.25" />
    <rect className="org-chart-node org-chart-node-right" x="15.5" y="13.5" width="6" height="4.6" rx="1.25" />
    <path className="org-chart-line org-chart-line-foot-left" d="M5.5 18.1v2.4" />
    <path className="org-chart-line org-chart-line-foot-mid" d="M12 18.1v2.4" />
    <path className="org-chart-line org-chart-line-foot-right" d="M18.5 18.1v2.4" />
  </svg>
)) as LucideIcon;

const motionLabels: Record<string, string> = {
  "hive-runner-grow": "Hive nav grow",
  "org-chart-build": "Org chart build",
  "org-chart-build-wide": "Org chart wide build",
  "files-folder-close": "Folder closes",
  "files-folder-open-stay": "Folder opens",
  "files-folder-draw-cycle": "Folder redraw",
  "dashboard-command": "Widget board",
  "task-pop": "Checks pop",
  "task-resolve": "Resolve sweep",
  "task-badge": "Complete badge",
  "inbox-open": "Tray opens",
  "inbox-land": "Message lands",
  "inbox-pulse": "Signal pulse",
  "routine-nodes": "Nodes dance",
  "routine-flow": "Path flow",
  "routine-network": "Network ping",
  "routine-route-move": "Route handoff",
  "runtime-chip": "Chip wakes",
  "runtime-stack": "Blocks stack",
  "runtime-orbit": "Orbit run",
  "agent-bot": "Bot nod",
  "runtime-server": "Server blink",
  "panel-flip": "Panel flip",
  "boxes-shift": "Boxes shift",
  "spark-pop": "Spark pop",
  "broadcast-bars": "Broadcast ripple",
  "voice-wave": "Voice wave",
  "trend-rise": "Trend rise",
  "goal-flag": "Flag pop",
  "goal-hole-in-one": "Center hit",
  "goal-dart": "Dart strike",
  "org-build": "Org build",
  "buildings-grow": "Buildings grow",
  "settings-turn": "Tool turn",
  "settings-gear": "Gear snap",
  "settings-sliders": "Sliders tune",
  "sliders-lever-return": "Levers return",
  "terminal-cursor": "Cursor blink",
  "activity-pulse": "Activity pulse",
  "lightbulb-rays": "Idea rays",
  "boardroom-third": "Third seat joins",
  "mic-sound": "Sound rings",
  "marketing-sound": "Broadcast lines",
  "costs-coins": "Coins pop",
  "costs-dollar": "Dollar pop",
  "rocket-launch": "Launch lift",
  "shield-lock": "Shield lock",
  "calendar-tick": "Date check",
  "search-scan": "Search scan",
  "document-flip": "Document flip",
  "pin-drop": "Pin drop",
  "message-burst": "Message burst",
  "send-streak": "Send streak",
};

const navTargets: NavTarget[] = [
  { group: "Navigation", label: "Hives", icon: HiveRunnerMarkIcon as LucideIcon, motions: ["hive-runner-grow"] },
  { group: "Operations", label: "Tasks", icon: ListChecks, motions: ["task-pop", "task-resolve", "task-badge"] },
  { group: "Operations", label: "Dashboard", icon: Building2, motions: ["org-build", "activity-pulse"] },
  { group: "Operations", label: "Inbox", icon: Inbox, motions: ["inbox-open", "inbox-land", "inbox-pulse"] },
  { group: "Operations", label: "Routines", icon: Workflow, motions: ["routine-nodes", "routine-flow", "routine-network"] },
  { group: "Operations", label: "Goals", icon: Goal, motions: ["goal-hole-in-one", "goal-dart", "goal-flag", "spark-pop"] },
  { group: "Preserved Tools", label: "Ideas", icon: Lightbulb, motions: ["lightbulb-rays", "spark-pop", "activity-pulse"] },
  { group: "Preserved Tools", label: "Marketing", icon: Megaphone, motions: ["marketing-sound", "broadcast-bars", "inbox-pulse"] },
  { group: "Preserved Tools", label: "Voice Chat", icon: Mic, motions: ["mic-sound", "voice-wave", "activity-pulse"] },
  { group: "Preserved Tools", label: "Lead/Lag", icon: Activity, motions: ["activity-pulse", "trend-rise"] },
  { group: "Company", label: "Org Chart", icon: OrgChartBuildIcon, motions: ["org-chart-build"] },
  { group: "Company", label: "Org", icon: Building2, motions: ["buildings-grow", "org-build", "routine-network"] },
  { group: "Company", label: "Manage Projects", icon: FolderKanban, motions: ["panel-flip", "boxes-shift"] },
  { group: "Company", label: "Skills", icon: Sparkles, motions: ["spark-pop", "runtime-orbit"] },
  { group: "Company", label: "Runtimes", icon: Cpu, motions: ["runtime-chip", "runtime-stack", "runtime-orbit"] },
  { group: "Company", label: "Costs", icon: Compass, motions: ["costs-coins", "costs-dollar", "trend-rise", "activity-pulse"] },
  { group: "Company", label: "Activity", icon: Activity, motions: ["activity-pulse", "routine-flow"] },
  { group: "Company", label: "Files", icon: FolderOpen, motions: ["panel-flip", "boxes-shift"] },
  { group: "Company", label: "Settings", icon: Wrench, motions: ["settings-gear", "settings-sliders", "settings-turn", "runtime-chip"] },
  { group: "System", label: "Manage Companies", icon: Building2, motions: ["buildings-grow", "org-build", "panel-flip"] },
  { group: "System", label: "Terminal", icon: Terminal, motions: ["terminal-cursor", "runtime-server"] },
  { group: "System", label: "Sessions", icon: Monitor, motions: ["runtime-server", "activity-pulse"] },
  { group: "System", label: "Logs", icon: Logs, motions: ["task-resolve", "terminal-cursor"] },
  { group: "Dynamic", label: "Projects", icon: PanelTop, motions: ["panel-flip", "boxes-shift"] },
  { group: "Dynamic", label: "Agents", icon: Bot, motions: ["agent-bot", "activity-pulse"] },
  { group: "Dynamic", label: "Inventory", icon: Boxes, motions: ["boxes-shift", "runtime-stack"] },
  { group: "Shelf", label: "Money", icon: CircleDollarSign, motions: ["costs-dollar", "costs-coins", "spark-pop"] },
  { group: "Shelf", label: "Coins", icon: Coins, motions: ["costs-coins", "trend-rise"] },
  { group: "Shelf", label: "Billing", icon: HandCoins, motions: ["costs-dollar", "activity-pulse"] },
  { group: "Shelf", label: "Budget", icon: BadgeDollarSign, motions: ["costs-dollar", "task-badge"] },
  { group: "Shelf", label: "Gear Settings", icon: Cog, motions: ["settings-gear", "settings-turn"] },
  { group: "Shelf", label: "Controls", icon: SlidersHorizontal, motions: ["settings-sliders", "routine-flow"] },
  { group: "Shelf", label: "Target", icon: Target, motions: ["goal-hole-in-one", "goal-dart"] },
  { group: "Shelf", label: "Crosshair", icon: Crosshair, motions: ["goal-dart", "activity-pulse"] },
  { group: "Shelf", label: "Launch", icon: Rocket, motions: ["rocket-launch", "spark-pop"] },
  { group: "Shelf", label: "Security", icon: ShieldCheck, motions: ["shield-lock", "task-badge"] },
  { group: "Shelf", label: "Calendar", icon: CalendarCheck, motions: ["calendar-tick", "task-pop"] },
  { group: "Shelf", label: "Search", icon: Search, motions: ["search-scan", "activity-pulse"] },
  { group: "Shelf", label: "Document", icon: FileText, motions: ["document-flip", "panel-flip"] },
  { group: "Shelf", label: "Location", icon: MapPin, motions: ["pin-drop", "goal-hole-in-one"] },
  { group: "Shelf", label: "Messages", icon: MessagesSquare, motions: ["message-burst", "inbox-pulse"] },
  { group: "Shelf", label: "Send", icon: Send, motions: ["send-streak", "broadcast-bars"] },
  { group: "Shelf", label: "New Person", icon: UserPlus, motions: ["boardroom-third", "spark-pop"] },
  { group: "Company", label: "Org Chart", icon: OrgChartWideBuildIcon as LucideIcon, motions: ["org-chart-build-wide"] },
  { group: "Company", label: "Files", icon: AnimatedFolderOpenIcon as LucideIcon, motions: ["files-folder-close"] },
  { group: "Operations", label: "Dashboard", icon: DashboardWidgetBoardIcon as LucideIcon, motions: ["dashboard-command"] },
  { group: "Operations", label: "Routines", icon: RoutineRouteMoveIcon as LucideIcon, motions: ["routine-route-move"] },
  { group: "Shelf", label: "Controls", icon: SlidersLeverMotionIcon as LucideIcon, motions: ["sliders-lever-return"] },
  { group: "Company", label: "Files", icon: FolderOpenStayIcon as LucideIcon, motions: ["files-folder-open-stay"] },
  { group: "Company", label: "Files", icon: FolderDrawCycleIcon as LucideIcon, motions: ["files-folder-draw-cycle"] },
];

const candidates: Candidate[] = navTargets.flatMap((target) =>
  target.motions.map((motion) => ({
    group: `${target.group} / ${target.label}`,
    label: motionLabels[motion] ?? motion,
    motion,
    icon: target.icon,
  })),
);

export default function AnimationLabPage() {
  return (
    <div className="animation-lab-page">
      <header className="animation-lab-header">
        <div>
          <p className="animation-lab-kicker">HiveRunner</p>
          <h1>Animation Lab</h1>
        </div>
      </header>

      <section className="animation-lab-grid" aria-label="Icon animation candidates">
        {candidates.map((candidate, index) => {
          const Icon = candidate.icon;
          const candidateId = String(index + 1).padStart(3, "0");
          return (
            <button
              type="button"
              key={`${candidate.group}-${candidate.label}`}
              className="animation-lab-card"
              data-motion={candidate.motion}
            >
              <span className="animation-lab-icon" aria-hidden="true">
                <Icon size={30} strokeWidth={1.85} />
                <span className="animation-lab-effect" />
              </span>
              <span className="animation-lab-copy">
                <span>{candidate.group}</span>
                <strong>{candidate.label}</strong>
              </span>
              <span className="animation-lab-id" aria-label={`Animation candidate ${candidateId}`}>
                #{candidateId}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
