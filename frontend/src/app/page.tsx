import dynamic from "next/dynamic";

const SOURCE_CHAIN_NAME = process.env.NEXT_PUBLIC_SOURCE_CHAIN_NAME ?? "BSC";
const DEST_CHAIN_NAME   = process.env.NEXT_PUBLIC_DEST_CHAIN_NAME   ?? "Amerox";

// ─── Skeleton shown while the JS bundle loads ────────────────────────────────
// Matches the BridgeForm card shape so there is no layout shift.
function BridgeSkeleton() {
  return (
    <div
      className="w-full rounded-2xl p-6 animate-pulse"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(212,175,55,0.08)" }}
    >
      {/* Direction toggle */}
      <div className="flex gap-2 mb-6">
        <div className="h-9 flex-1 rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="h-9 flex-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }} />
      </div>

      {/* Chain row */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-16 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }} />
        <div className="w-8 h-8 rounded-full"   style={{ background: "rgba(212,175,55,0.15)" }} />
        <div className="flex-1 h-16 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>

      {/* Amount input */}
      <div className="h-14 rounded-xl mb-4" style={{ background: "rgba(255,255,255,0.05)" }} />

      {/* Balance row */}
      <div className="h-4 w-40 rounded mb-6" style={{ background: "rgba(255,255,255,0.04)" }} />

      {/* CTA button */}
      <div className="h-12 rounded-xl" style={{ background: "rgba(212,175,55,0.12)" }} />
    </div>
  );
}

// ─── Lazy-load BridgeForm ─────────────────────────────────────────────────────
// ssr:false — wallet hooks (Privy, wagmi) are browser-only; skipping SSR removes
// the hydration overhead that was causing the 5-10s blank-screen delay.
const BridgeForm = dynamic(
  () => import("../components/BridgeForm").then((m) => m.BridgeForm),
  { ssr: false, loading: () => <BridgeSkeleton /> }
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(160deg, #050505 0%, #0F0A00 55%, #050505 100%)" }}
    >
      {/* Navbar — pure HTML, renders instantly */}
      <nav className="w-full flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden"
            style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="8" width="16" height="4" rx="2" fill="black" fillOpacity="0.85" />
              <rect x="5" y="4" width="2" height="12" rx="1" fill="black" fillOpacity="0.85" />
              <rect x="13" y="4" width="2" height="12" rx="1" fill="black" fillOpacity="0.85" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight" style={{ color: "#D4AF37" }}>Bridge</span>
        </div>
        <div className="text-xs font-medium" style={{ color: "rgba(212,175,55,0.4)" }}>
          {SOURCE_CHAIN_NAME} ↔ {DEST_CHAIN_NAME}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex flex-col items-center px-4 pt-4 pb-16">
        <div className="w-full max-w-[480px]">
          <BridgeForm />
        </div>

        <p className="mt-8 text-xs text-center" style={{ color: "rgba(212,175,55,0.25)" }}>
          Powered by an off-chain relayer · 1 USDC = 1 bUSDC
        </p>
      </main>
    </div>
  );
}
