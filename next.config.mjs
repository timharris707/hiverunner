/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep strict mode disabled for now to avoid double-mounting long-lived local streams in dev.
  reactStrictMode: false,
  devIndicators: false,
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",")
    : ["127.0.0.1", "localhost"],
  typescript: {
    // The public repo still carries pre-existing type debt outside this cleanup.
    // The dedicated typecheck gate remains the source of truth during PR review.
    ignoreBuildErrors: true,
  },
  // Native Node.js addons — must not be bundled by webpack.
  // better-sqlite3: required for SQLite access in API routes.
  // ws/bufferutil/utf-8-validate: required for WebSocket gateway bridge;
  //   without this, webpack dev mode fails with "bufferUtil.mask is not a function".
  serverExternalPackages: ["better-sqlite3", "ws", "bufferutil", "utf-8-validate"],
  webpack: (config, { dev }) => {
    // In dev mode, the Fast Refresh watcher was treating SQLite WAL/SHM files
    // as source changes — every orchestration API call writes to
    // data/orchestration.db-wal, triggering a rebuild + full re-mount of the
    // active dashboard. With several endpoints polling on 3-10s cycles the
    // page can otherwise flicker constantly.
    // Exclude the runtime DB dirs + logs so writes there don't kick HMR.
    if (dev) {
      // 2026-04-23: Next 16 injects a non-string (RegExp or empty-string) as
      // the default `ignored` entry, which webpack's validator rejects with
      // "configuration.watchOptions.ignored[0] should be a non-empty string"
      // when combined with our extra string globs. Only preserve
      // user-provided string patterns from the existing config.
      const raw = config.watchOptions?.ignored;
      const existingStrings = Array.isArray(raw)
        ? raw.filter((p) => typeof p === "string" && p.length > 0)
        : typeof raw === "string" && raw.length > 0
          ? [raw]
          : [];
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          ...existingStrings,
          "**/data/**",
          "**/data-dev/**",
          "**/logs/**",
          "**/output/**",
          "**/.playwright-cli/**",
          "**/.next/**",
          "**/node_modules/**",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
