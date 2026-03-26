/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable strict mode to prevent double-mount that clears advisory session state in dev
  reactStrictMode: false,
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",")
    : [],
  typescript: {
    // Advisory board page has pre-existing type errors (being refactored)
    // TODO: Remove this once advisory refactor is complete
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
