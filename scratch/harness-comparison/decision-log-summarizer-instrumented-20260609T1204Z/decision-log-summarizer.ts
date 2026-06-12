import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type DecisionLogMetadata = {
  status: string | null;
  owner: string | null;
  date: string | null;
  tags: string[];
};

export type DecisionLogInstrumentation = {
  sourcePath: string | null;
  inputBytes: number;
  inputLines: number;
  metadataFieldCount: number;
  warningCount: number;
  summarySource: "metadata" | "body" | "empty";
};

export type DecisionLogSummary = DecisionLogMetadata & {
  title: string;
  summary: string;
  warnings: string[];
  instrumentation: DecisionLogInstrumentation;
};

export type DecisionLogRunMetrics = {
  fileCount: number;
  decisionCount: number;
  totalInputBytes: number;
  warningCount: number;
  elapsedMs: number;
};

export type DecisionLogSummaryReport = {
  summaries: DecisionLogSummary[];
  markdown: string;
  metrics: DecisionLogRunMetrics;
};

type ParseOptions = {
  sourcePath?: string;
};

type MetadataParseResult = {
  metadata: Record<string, string>;
  body: string;
  warnings: string[];
};

const KNOWN_FIELDS = new Set(["title", "status", "owner", "date", "tags", "summary"]);
const SUMMARY_LIMIT = 180;

export function parseDecisionLogMarkdown(
  markdown: string,
  options: ParseOptions = {},
): DecisionLogSummary {
  const normalized = markdown.replace(/\r\n?/g, "\n").trimStart();
  const { metadata, body, warnings } = parseMetadata(normalized);
  const title = extractTitle(body) ?? nonEmpty(metadata.title) ?? "Untitled decision";

  for (const key of Object.keys(metadata)) {
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`Unknown metadata field ignored: ${key}`);
    }
  }

  const bodySummary = extractFirstParagraph(body);
  const metadataSummary = nonEmpty(metadata.summary);
  const summarySource = metadataSummary ? "metadata" : bodySummary ? "body" : "empty";
  const summary = shortenSummary(metadataSummary ?? bodySummary ?? "");

  return {
    title,
    status: nonEmpty(metadata.status),
    owner: nonEmpty(metadata.owner),
    date: nonEmpty(metadata.date),
    tags: parseTags(metadata.tags),
    summary,
    warnings,
    instrumentation: {
      sourcePath: options.sourcePath ?? null,
      inputBytes: Buffer.byteLength(markdown, "utf8"),
      inputLines: normalized ? normalized.split("\n").length : 0,
      metadataFieldCount: Object.keys(metadata).length,
      warningCount: warnings.length,
      summarySource,
    },
  };
}

export function formatDecisionLogSummary(summary: DecisionLogSummary): string {
  const status = summary.status ?? "unknown status";
  const owner = summary.owner ?? "unassigned";
  const date = summary.date ?? "undated";
  const tags = summary.tags.length > 0 ? summary.tags.join(", ") : "none";

  return [
    `## ${summary.title}`,
    "",
    `- Status: ${status}`,
    `- Owner: ${owner}`,
    `- Date: ${date}`,
    `- Tags: ${tags}`,
    `- Summary: ${summary.summary || "No summary found."}`,
    `- Instrumentation: ${summary.instrumentation.inputBytes} bytes, ${summary.instrumentation.metadataFieldCount} metadata fields, ${summary.instrumentation.warningCount} warnings, summary source ${summary.instrumentation.summarySource}`,
  ].join("\n");
}

export function summarizeDecisionLogFiles(filePaths: string[]): DecisionLogSummaryReport {
  const startedAt = process.hrtime.bigint();
  const summaries = filePaths.map((filePath) => {
    const markdown = readFileSync(filePath, "utf8");
    return parseDecisionLogMarkdown(markdown, { sourcePath: filePath });
  });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    summaries,
    markdown: summaries.map(formatDecisionLogSummary).join("\n\n"),
    metrics: {
      fileCount: filePaths.length,
      decisionCount: summaries.length,
      totalInputBytes: summaries.reduce(
        (total, summary) => total + summary.instrumentation.inputBytes,
        0,
      ),
      warningCount: summaries.reduce((total, summary) => total + summary.warnings.length, 0),
      elapsedMs,
    },
  };
}

export function formatDecisionLogReport(report: DecisionLogSummaryReport): string {
  return [
    report.markdown,
    "",
    "## Instrumentation",
    "",
    `- Files: ${report.metrics.fileCount}`,
    `- Decisions: ${report.metrics.decisionCount}`,
    `- Input bytes: ${report.metrics.totalInputBytes}`,
    `- Warnings: ${report.metrics.warningCount}`,
    `- Elapsed: ${report.metrics.elapsedMs.toFixed(3)} ms`,
  ].join("\n");
}

function parseMetadata(markdown: string): MetadataParseResult {
  if (!markdown.startsWith("---\n")) {
    return { metadata: {}, body: markdown, warnings: [] };
  }

  const closeIndex = markdown.indexOf("\n---", 4);
  if (closeIndex === -1) {
    return {
      metadata: {},
      body: markdown,
      warnings: ["Opening metadata fence was not closed; metadata ignored."],
    };
  }

  const rawMetadata = markdown.slice(4, closeIndex);
  const body = markdown.slice(closeIndex + "\n---".length).trimStart();
  const metadata: Record<string, string> = {};
  const warnings: string[] = [];

  for (const [index, rawLine] of rawMetadata.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      warnings.push(`Malformed metadata line ${index + 1} ignored.`);
      continue;
    }

    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();
    if (!key) {
      warnings.push(`Malformed metadata line ${index + 1} ignored.`);
      continue;
    }
    metadata[key] = stripMatchingQuotes(value);
  }

  return { metadata, body, warnings };
}

function extractTitle(body: string): string | null {
  const heading = body.match(/^#\s+(.+?)\s*$/m);
  return heading ? heading[1].trim() : null;
}

function extractFirstParagraph(body: string): string | null {
  const withoutTitle = body.replace(/^#\s+.+?\s*$/m, "").trim();
  const paragraph = withoutTitle
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .find((section) => section && !section.startsWith("#") && !section.startsWith("- "));

  return paragraph ?? null;
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  const listValue = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;

  return listValue
    .split(",")
    .map((tag) => stripMatchingQuotes(tag.trim()))
    .filter(Boolean);
}

function shortenSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= SUMMARY_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, SUMMARY_LIMIT - 3).trimEnd()}...`;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function stripMatchingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function fixtureMarkdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => path.join(dir, entry));
}

if (require.main === module) {
  const inputPaths = process.argv.slice(2);
  const files =
    inputPaths.length > 0
      ? inputPaths
      : fixtureMarkdownFiles(path.join(__dirname, "fixtures"));

  console.log(formatDecisionLogReport(summarizeDecisionLogFiles(files)));
}
