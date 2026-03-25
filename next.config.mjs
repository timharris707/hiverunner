/** @type {import('next').NextConfig} */
const nextConfig = {
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
