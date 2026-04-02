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
  // better-sqlite3 is a native Node.js addon — must not be bundled by webpack.
  // This is required for Vercel preview deployments where the module is used
  // in API routes (server-side only).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
