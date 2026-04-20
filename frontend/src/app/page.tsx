import { BridgeForm } from "../components/BridgeForm";

const SOURCE_CHAIN_NAME = process.env.NEXT_PUBLIC_SOURCE_CHAIN_NAME ?? "BSC";
const DEST_CHAIN_NAME   = process.env.NEXT_PUBLIC_DEST_CHAIN_NAME   ?? "Amerox";

export default function Home() {
  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(160deg, #050505 0%, #0F0A00 55%, #050505 100%)" }}
    >
      {/* Navbar */}
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
