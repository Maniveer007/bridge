import "dotenv/config";
import { loadConfig } from "./config.js";
import { startListener } from "./listener.js";
import { clearStore, closeStore } from "./store.js";

// ── --fresh flag ──────────────────────────────────────────────────────────────
// Run with:  npm run dev -- --fresh
// Clears MongoDB state so the engine re-scans all history from START_BLOCK.
// Useful after redeploying contracts or fixing a missed event.

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║          Bridge Relayer Starting             ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  if (process.argv.includes("--fresh")) {
    await clearStore();
  }

  const config = await loadConfig();

  console.log("  Source chain");
  console.log(`    Name        : ${config.source.name}`);
  console.log(`    RPC         : ${config.source.rpcUrl}`);
  console.log(`    Vault       : ${config.source.vaultAddress}`);
  console.log(`    Start block : ${config.source.startBlock === 0 ? `auto (last ${config.lookbackBlocks.toLocaleString()} blocks)` : config.source.startBlock}`);
  console.log(`    Confirms    : ${config.source.confirmations}`);
  console.log("");
  console.log("  Destination chain");
  console.log(`    Name        : ${config.destination.name}`);
  console.log(`    RPC         : ${config.destination.rpcUrl}`);
  console.log(`    BridgedUSDC : ${config.destination.bridgedUsdcAddress}`);
  console.log(`    Start block : ${config.destination.startBlock === 0 ? "auto (current block)" : config.destination.startBlock}`);
  console.log("");
  console.log(`  Poll interval : ${config.pollIntervalMs}ms`);
  console.log(`  Batch size    : ${config.syncBatchSize.toLocaleString()} blocks`);
  console.log(`  Store         : MongoDB (bridge db)`);
  console.log("");
  console.log("  Startup flow:");
  console.log("    [1] Historical sync — forward  (TokensLocked  → mint)");
  console.log("    [2] Historical sync — reverse  (TokensBurned  → unlock)");
  console.log("    [3] Live polling    — both directions every", `${config.pollIntervalMs}ms`);
  console.log("──────────────────────────────────────────────\n");

  // Verify RPC connectivity before starting listeners.
  try {
    const block = await config.source.provider.getBlockNumber();
    console.log(`[Init] ✓ Source chain connected      — latest block: ${block}`);
  } catch {
    console.error("[Init] ✗ Cannot connect to source chain RPC:", config.source.rpcUrl);
    console.error("         Check SOURCE_RPC_URL in root .env, then run  make sync-env");
    process.exit(1);
  }

  try {
    const block = await config.destination.provider.getBlockNumber();
    console.log(`[Init] ✓ Destination chain connected — latest block: ${block}`);
  } catch {
    console.error("[Init] ✗ Cannot connect to destination chain RPC:", config.destination.rpcUrl);
    console.error("         Is Anvil running?  make node");
    process.exit(1);
  }

  // Verify both contracts are deployed.
  const vaultCode = await config.source.provider.getCode(config.source.vaultAddress);
  if (vaultCode === "0x") {
    console.error(`[Init] ✗ BridgeVault has no bytecode at ${config.source.vaultAddress} on ${config.source.name}`);
    console.error("         Deploy it first:  make deploy-vault");
    process.exit(1);
  }
  console.log(`[Init] ✓ BridgeVault contract verified   — ${config.source.vaultAddress}`);

  const bridgedUsdcCode = await config.destination.provider.getCode(config.destination.bridgedUsdcAddress);
  if (bridgedUsdcCode === "0x") {
    console.error(`[Init] ✗ BridgedUSDC has no bytecode at ${config.destination.bridgedUsdcAddress} on ${config.destination.name}`);
    console.error("         Deploy it first:  make deploy-bridged");
    process.exit(1);
  }
  console.log(`[Init] ✓ BridgedUSDC contract verified   — ${config.destination.bridgedUsdcAddress}`);

  console.log("");

  const stop = startListener(config);

  // Graceful shutdown on Ctrl-C / kill
  async function shutdown(signal: string) {
    console.log(`\n[Relayer] ${signal} — shutting down...`);
    stop();
    await closeStore();
    setTimeout(() => process.exit(0), 3_000);
  }

  process.on("SIGINT",  () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Relayer] Fatal error:", err);
  process.exit(1);
});
