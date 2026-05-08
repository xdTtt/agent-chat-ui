/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["*.*.*.*"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
