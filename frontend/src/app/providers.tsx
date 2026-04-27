"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { wagmiConfig, sourceChain, destChain } from "../config/chains";

const [queryClient] = [new QueryClient()];

/**
 * Wallet providers (Privy + wagmi + React Query).
 *
 * WHY the `mounted` gate:
 * Next.js App Router renders "use client" components on the SERVER for the
 * initial HTML pass. PrivyProvider calls auth.privy.io during that server-side
 * render to validate the app ID — causing a 10-16 s delay before the page
 * is sent to the browser.
 *
 * By returning bare children on the first render (which happens both on the
 * server AND during the matching first client render), we ensure PrivyProvider
 * only mounts after hydration, entirely in the browser.
 * No hydration mismatch because both server and first client render agree.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Server render + first client render: return children without providers.
  // PrivyProvider never runs on the server → no outbound network call → instant HTML.
  if (!mounted) {
    return <>{children}</>;
  }

  // After hydration: mount wallet providers client-side only.
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        defaultChain: sourceChain,
        supportedChains: [sourceChain, destChain],
        appearance: {
          theme: "dark",
          accentColor: "#D4AF37",
        },
        loginMethods: ["wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
