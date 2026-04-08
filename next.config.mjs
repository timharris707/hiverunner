/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable strict mode to prevent double-mount that clears advisory session state in dev
  reactStrictMode: false,
  devIndicators: false,
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",")
    : ["127.0.0.1", "localhost"],
  typescript: {
    // Advisory board page has pre-existing type errors (being refactored)
    // TODO: Remove this once advisory refactor is complete
    ignoreBuildErrors: true,
  },
  // Native Node.js addons — must not be bundled by webpack.
  // better-sqlite3: required for SQLite access in API routes.
  // ws/bufferutil/utf-8-validate: required for WebSocket gateway bridge;
  //   without this, webpack dev mode fails with "bufferUtil.mask is not a function".
  serverExternalPackages: ["better-sqlite3", "ws", "bufferutil", "utf-8-validate"],
};

export default nextConfig;
