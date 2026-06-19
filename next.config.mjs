/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "graph.facebook.com" },
    ],
  },
  async headers() {
    return [
      { source: "/manifest.json", headers: [{ key: "Content-Type", value: "application/manifest+json" }] },
    ];
  },
};
export default nextConfig;
