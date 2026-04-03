/**
 * factory.ts — Types for the Software Factory Pipeline.
 * Formalizes: Idea → Architecture → Build → Test → Deploy
 */

export type PipelineStage = "idea" | "architecture" | "build" | "test" | "deploy";
export type PipelineStageStatus = "pending" | "active" | "completed" | "failed" | "skipped";

export interface StageTransition {
  from: PipelineStage | "created";
  to: PipelineStage;
  timestamp: string;
  agent?: string;
  summary?: string;
}

export interface IdeaStage {
  problem: string;
  targetAudience: string;
  marketSignal?: string;
  sourceUrl?: string;
  subreddit?: string;
  viabilityScore?: number; // 1-100
  competitors?: string[];
  keywords?: string[];
}

export interface ArchitectureStage {
  techStack: string[];
  components: { name: string; description: string }[];
  estimatedEffort: "hours" | "days" | "weeks";
  overview: string; // text-based architecture description
  dataModel?: string;
  apiDesign?: string;
}

export interface BuildStage {
  taskId?: string; // links to existing build queue task
  buildId?: string; // links to build-log entry
  repoName?: string;
  status?: "pending" | "in-progress" | "completed" | "failed";
  output?: string;
}

export interface TestStage {
  passed?: boolean;
  testCount?: number;
  passCount?: number;
  failCount?: number;
  testOutput?: string;
  coverage?: string;
}

export interface DeployStage {
  url?: string;
  platform?: string; // e.g. "vercel", "railway", "docker"
  deployedAt?: string;
  status?: "pending" | "deploying" | "live" | "failed";
}

export interface FactoryPipeline {
  id: string;
  name: string;
  description: string;
  source: "manual" | "reddit" | "idea-intake";
  stage: PipelineStage;
  status: "active" | "completed" | "failed" | "paused";
  createdAt: string;
  updatedAt: string;
  assignedAgent?: string;

  // Per-stage data
  idea?: IdeaStage;
  architecture?: ArchitectureStage;
  build?: BuildStage;
  test?: TestStage;
  deploy?: DeployStage;

  // Audit trail
  stageHistory: StageTransition[];
}

export interface RedditOpportunity {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  score: number;
  commentCount: number;
  problem: string;
  targetAudience: string;
  viabilityScore: number;
  keywords: string[];
  scannedAt: string;
}

/** Stage metadata for UI rendering */
export const PIPELINE_STAGES: {
  id: PipelineStage;
  label: string;
  emoji: string;
  color: string;
  description: string;
}[] = [
  { id: "idea", label: "Idea", emoji: "💡", color: "#f59e0b", description: "Problem identification & market signal" },
  { id: "architecture", label: "Architecture", emoji: "📐", color: "#d97706", description: "Tech stack, components & API design" },
  { id: "build", label: "Build", emoji: "🔨", color: "#d97706", description: "Autonomous MVP construction" },
  { id: "test", label: "Test", emoji: "🧪", color: "#06b6d4", description: "Automated test suite execution" },
  { id: "deploy", label: "Deploy", emoji: "🚀", color: "#10b981", description: "Ship to production" },
];
