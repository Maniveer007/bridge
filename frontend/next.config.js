/** @type {import('next').NextConfig} */
const nextConfig = {
  // All NEXT_PUBLIC_ env vars are inlined at build time — no extra config needed.

  // Compress responses — reduces transfer size ~70% on slow connections.
  compress: true,

  // Tell Next.js to transpile Privy + wagmi ESM packages through SWC
  // so it can tree-shake them properly and split them into smaller chunks.
  transpilePackages: [
    "@privy-io/react-auth",
    "@privy-io/wagmi",
    "@privy-io/js-sdk-core",
  ],

  webpack(config) {
    // Privy and its transitive deps pull in optional Farcaster / Solana /
    // React-Native modules that are never used in this browser-only app.
    // Alias them to `false` so webpack skips them silently.
    const optionalAliases = [
      "@farcaster/mini-app-solana",
      "@react-native-async-storage/async-storage",
      "@solana-program/memo",
      "@solana-program/system",
      "@solana-program/token",
      "@solana/kit",
      "@abstract-foundation/agw-client",
      "permissionless",
    ];

    optionalAliases.forEach((pkg) => {
      config.resolve.alias[pkg] = false;
    });

    return config;
  },
};

module.exports = nextConfig;
