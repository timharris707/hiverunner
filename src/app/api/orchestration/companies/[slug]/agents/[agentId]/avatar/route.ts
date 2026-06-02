import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { MC_DATA_DIR } from "@/lib/data-dir";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

const MAX_THUMBNAIL_SIZE = 256;
const DEFAULT_THUMBNAIL_QUALITY = 72;
const PUBLIC_DIR = path.join(process.cwd(), "public");
const AVATAR_CACHE_DIR = path.join(MC_DATA_DIR, "cache", "agent-avatars");

function bufferBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function parseThumbnailSize(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get("size")?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(16, Math.min(MAX_THUMBNAIL_SIZE, Math.round(parsed)));
}

function safeCacheSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96) || "unknown";
}

async function loadLocalPublicFile(avatarUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!avatarUrl.startsWith("/")) return null;
  const relativePath = avatarUrl.replace(/^\/+/, "");
  const absolutePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!absolutePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : "image/png";

  return {
    buffer: await fs.readFile(absolutePath),
    contentType,
  };
}

async function loadAvatarSource(avatarUrl: string): Promise<{ buffer: Buffer; contentType: string; redirectUrl?: string }> {
  if (/^https?:\/\//i.test(avatarUrl)) {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      throw new Error(`Avatar source responded with ${response.status}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png",
      redirectUrl: avatarUrl,
    };
  }

  const localFile = await loadLocalPublicFile(avatarUrl);
  if (localFile) return localFile;

  const match = avatarUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/);
  if (!match) {
    throw new Error("Unsupported avatar format");
  }
  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType: match[1],
  };
}

async function thumbnailResponse(input: {
  avatarUrl: string;
  agentId: string;
  signature: string;
  size: number;
}): Promise<NextResponse> {
  const cacheName = [
    safeCacheSegment(input.agentId),
    safeCacheSegment(input.signature),
    `${input.size}.webp`,
  ].join("-");
  const cachePath = path.join(AVATAR_CACHE_DIR, cacheName);

  const source = await loadAvatarSource(input.avatarUrl);
  const thumbnail = await sharp(source.buffer, { failOn: "none" })
    .rotate()
    .resize(input.size, input.size, { fit: "cover", position: "center" })
    .webp({ quality: DEFAULT_THUMBNAIL_QUALITY })
    .toBuffer();

  await fs.mkdir(AVATAR_CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath, thumbnail).catch(() => undefined);

  return new NextResponse(bufferBody(thumbnail), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Avatar-Source-Hash": createHash("sha1").update(source.buffer).digest("hex").slice(0, 12),
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { slug, agentId } = await params;
    const thumbnailSize = parseThumbnailSize(req);
    const db = getOrchestrationDb();

    const company = db
      .prepare(
        `SELECT id
         FROM companies
         WHERE archived_at IS NULL
           AND (id = ? OR slug = ? OR UPPER(company_code) = UPPER(?))
         LIMIT 1`
      )
      .get(slug, slug, slug) as { id: string } | undefined;

    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    const agent = db
      .prepare(
        `SELECT
           id,
           avatar_url IS NOT NULL AS has_avatar,
           LENGTH(avatar_url) AS avatar_length,
           SUBSTR(avatar_url, 1, 80) AS avatar_prefix,
           SUBSTR(avatar_url, -80) AS avatar_suffix
         FROM agents
         WHERE company_id = ?
           AND archived_at IS NULL
           AND (id = ? OR lower(slug) = lower(?) OR lower(name) = lower(?))
         LIMIT 1`
      )
      .get(company.id, agentId, agentId, agentId) as {
        id: string;
        has_avatar: 0 | 1;
        avatar_length: number | null;
        avatar_prefix: string | null;
        avatar_suffix: string | null;
      } | undefined;

    if (!agent?.has_avatar) {
      return errorResponse(404, "avatar_not_found", "Agent avatar not found");
    }

    const avatarSignature = createHash("sha1")
      .update(`${agent.avatar_length ?? 0}:${agent.avatar_prefix ?? ""}:${agent.avatar_suffix ?? ""}`)
      .digest("hex")
      .slice(0, 16);

    if (thumbnailSize) {
      const cachedName = [
        safeCacheSegment(agent.id),
        safeCacheSegment(avatarSignature),
        `${thumbnailSize}.webp`,
      ].join("-");
      const cachedPath = path.join(AVATAR_CACHE_DIR, cachedName);
      try {
        const cached = await fs.readFile(cachedPath);
        return new NextResponse(cached, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      } catch {
        // Cache miss. Load the full source only when generation is required.
      }

      const sourceRow = db
        .prepare("SELECT avatar_url FROM agents WHERE id = ? LIMIT 1")
        .get(agent.id) as { avatar_url: string | null } | undefined;
      const avatarUrl = sourceRow?.avatar_url?.trim();
      if (!avatarUrl) {
        return errorResponse(404, "avatar_not_found", "Agent avatar not found");
      }
      return thumbnailResponse({
        avatarUrl,
        agentId: agent.id,
        signature: avatarSignature,
        size: thumbnailSize,
      });
    }

    const sourceRow = db
      .prepare("SELECT avatar_url FROM agents WHERE id = ? LIMIT 1")
      .get(agent.id) as { avatar_url: string | null } | undefined;
    const avatarUrl = sourceRow?.avatar_url?.trim();
    if (!avatarUrl) {
      return errorResponse(404, "avatar_not_found", "Agent avatar not found");
    }

    if (/^https?:\/\//i.test(avatarUrl)) {
      return NextResponse.redirect(avatarUrl);
    }

    if (avatarUrl.startsWith("/")) {
      return NextResponse.redirect(new URL(avatarUrl, req.nextUrl.origin));
    }

    const match = avatarUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/);
    if (!match) {
      return errorResponse(415, "unsupported_avatar", "Agent avatar format is not supported");
    }

    return new NextResponse(bufferBody(Buffer.from(match[2], "base64")), {
      headers: {
        "Content-Type": match[1],
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return handleRouteError(error, "company-agent-avatar:get");
  }
}
