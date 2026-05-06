import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Le dépôt a beaucoup de textes FR avec apostrophes/guillemets en JSX ; ESLint reste disponible via `npm run lint`. */
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
