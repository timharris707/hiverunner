import { spawnSync } from "child_process";
import { isHiveRunnerSystemAuthor } from "@/lib/orchestration/system-authors";

export type LinkVerificationResult = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  reason?: string;
};

type VerifyFn = (url: string) => LinkVerificationResult;

const DEFAULT_MAX_LINKS = 10;
const USER_AGENT = "HiveRunnerLinkCheck/1.0";
const CURL_MAX_TIME_SECONDS = "5";
const CURL_TIMEOUT_MS = 6000;
const RUNTIME_COMMENT_SOURCES = new Set(["openclaw", "anthropic", "codex", "hermes", "gemini"]);

function trimUrl(raw: string): string {
  let value = raw.trim();
  while (/[)\].,;:!?]$/.test(value)) {
    value = value.slice(0, -1);
  }
  return value;
}

function isExternalPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.")
    ) {
      return false;
    }
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172) {
      const octet = Number(match172[1]);
      if (octet >= 16 && octet <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractExternalLinks(body: string): string[] {
  const links = new Set<string>();
  const patterns = [
    /\[[^\]]+\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi,
    /\b(?:href|src)=["'](https?:\/\/[^"']+)["']/gi,
    /\bhttps?:\/\/[^\s<>"']+/gi,
  ];

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const raw = match[1] ?? match[0];
      const url = trimUrl(raw);
      if (isExternalPublicHttpUrl(url)) {
        links.add(url);
      }
    }
  }

  return [...links];
}

export function shouldVerifyAgentCommentLinks(input: {
  authorAgentId?: string | null;
  authorUserId?: string | null;
  source?: string | null;
}): boolean {
  if (input.authorAgentId?.trim()) return true;
  const source = input.source?.trim().toLowerCase() ?? "";
  if (!RUNTIME_COMMENT_SOURCES.has(source)) return false;

  if (isHiveRunnerSystemAuthor(input.authorUserId)) return false;
  return true;
}

function parseCurlStatus(output: string): { status?: number; finalUrl?: string } {
  const trimmed = output.trim();
  const match = trimmed.match(/^(\d{3})\s+(.+)$/);
  if (!match) return {};
  return { status: Number(match[1]), finalUrl: match[2] };
}

function curlStatus(url: string, method: "HEAD" | "GET"): LinkVerificationResult {
  const args =
    method === "HEAD"
      ? ["-I", "-L", "-sS", "-o", "/dev/null", "-w", "%{http_code} %{url_effective}", "--max-time", CURL_MAX_TIME_SECONDS, "-A", USER_AGENT, url]
      : ["-L", "-sS", "-o", "/dev/null", "-w", "%{http_code} %{url_effective}", "--max-time", CURL_MAX_TIME_SECONDS, "-r", "0-4096", "-A", USER_AGENT, url];

  const result = spawnSync("curl", args, { encoding: "utf8", timeout: CURL_TIMEOUT_MS });
  const { status, finalUrl } = parseCurlStatus(result.stdout ?? "");
  if (result.error) {
    return { url, ok: false, status, finalUrl, reason: result.error.message };
  }
  if (result.status !== 0 && !status) {
    return { url, ok: false, reason: (result.stderr || "curl failed").trim() };
  }
  return {
    url,
    ok: typeof status === "number" && status >= 200 && status < 400,
    status,
    finalUrl,
    reason: typeof status === "number" ? `HTTP ${status}` : undefined,
  };
}

function youtubeOembedStatus(url: string): LinkVerificationResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith("youtube.com") && host !== "youtu.be") {
    return null;
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const result = curlStatus(oembedUrl, "GET");
  return {
    url,
    ok: result.ok,
    status: result.status,
    finalUrl: result.finalUrl,
    reason: result.ok ? undefined : `YouTube video is not embeddable or unavailable${result.status ? ` (HTTP ${result.status})` : ""}`,
  };
}

export function verifyExternalUrl(url: string): LinkVerificationResult {
  const youtubeResult = youtubeOembedStatus(url);
  if (youtubeResult) return youtubeResult;

  const head = curlStatus(url, "HEAD");
  if (head.ok) return head;
  if (head.status && ![403, 405, 429].includes(head.status)) return head;
  return curlStatus(url, "GET");
}

function verificationLabel(result: LinkVerificationResult): string {
  if (result.status) return `HTTP ${result.status}`;
  return result.reason || "unverified";
}

export function sanitizeAgentCommentLinks(
  body: string,
  options: { verify?: VerifyFn; maxLinks?: number } = {}
): { body: string; invalidLinks: LinkVerificationResult[]; checkedLinks: LinkVerificationResult[] } {
  const links = extractExternalLinks(body).slice(0, options.maxLinks ?? DEFAULT_MAX_LINKS);
  if (links.length === 0) {
    return { body, invalidLinks: [], checkedLinks: [] };
  }

  const verify = options.verify ?? verifyExternalUrl;
  const checkedLinks = links.map((url) => {
    try {
      return verify(url);
    } catch (error) {
      return {
        url,
        ok: false,
        reason: error instanceof Error ? error.message : "verification failed",
      };
    }
  });
  const invalidLinks = checkedLinks.filter((result) => !result.ok);
  if (invalidLinks.length === 0) {
    return { body, invalidLinks, checkedLinks };
  }

  const lines = [
    "**Link verification failed**",
    "",
    "HiveRunner found broken or unverifiable external links in the agent draft, so it withheld the sourced reply instead of posting bad URLs.",
    "",
    "The agent needs to research again and provide links that open successfully.",
    "",
    "Unverified links:",
    ...invalidLinks.map((result) => `- \`${result.url}\` (${verificationLabel(result)})`),
  ];

  return { body: lines.join("\n"), invalidLinks, checkedLinks };
}
