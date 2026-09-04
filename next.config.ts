import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // O motor de sync trabalha com respostas grandes das APIs de anúncios.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
