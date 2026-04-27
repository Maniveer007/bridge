import "dotenv/config";
import { loadConfig }  from "./config.js";
import { startListener } from "./listener.js";
import { startApi }    from "./api.js";
import { closeStore }  from "./store.js";

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║          Bridge Relayer Starting             ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Load and validate all config up-front — fails fast if any env var is missing.
  // Async because it reads the MongoDB block cursors.
  const config = await loadConfig();

  console.log(`Source chain      : ${config.source.name}`);
  console.log(`  RPC             : ${config.source.rpcUrl}`);
  console.log(`  Vault           : ${config.source.vaultAddress}`);
  console.log(`  Start block     : ${config.source.startBlock}`);
  console.log(`  Confirmations   : ${config.source.confirmations}`);
  console.log(`Destination chain : ${config.destination.name}`);
  console.log(`  RPC             : ${config.destination.rpcUrl}`);
  console.log(`  BridgedUSDC     : ${config.destination.bridgedUsdcAddress}`);
  console.log(`Poll interval     : ${config.pollIntervalMs}ms`);
  console.log(`Sync batch size   : ${config.syncBatchSize} blocks`);
  console.log(`Batch delay       : ${config.batchDelayMs}ms`);
  console.log(`\nStartup flow:`);
  console.log(`  [1] Historical sync — scan all events in ${config.syncBatchSize}-block batches`);
  console.log(`  [2] Live polling   — watch for new events every ${config.pollIntervalMs}ms`);
  console.log("──────────────────────────────────────────────\n");

  // Verify chain connectivity before starting.
  let sourceBlock: number;
  try {
    sourceBlock = await config.source.provider.getBlockNumber();
    console.log(`[Init] Source chain connected      — latest block: ${sourceBlock}`);
  } catch (err) {
    console.error("[Init] ✗ Cannot connect to source chain RPC:", err);
    process.exit(1);
  }

  try {
    const destBlock = await config.destination.provider.getBlockNumber();
    console.log(`[Init] Destination chain connected — latest block: ${destBlock}`);
  } catch (err) {
    console.error("[Init] ✗ Cannot connect to destination chain RPC:", err);
    process.exit(1);
  }

  console.log("");

  // Start the REST API that the frontend talks to.
  const apiPort   = parseInt(process.env.PORT ?? "4000", 10);
  const stopApi   = startApi(apiPort);

  // Start the listener (historical sync → live polling).
  const stopListener = startListener(config);

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`\n[Relayer] ${signal} received — shutting down gracefully...`);
    stopListener();
    stopApi();
    await closeStore();
    process.exit(0);
  }

  process.on("SIGINT",  () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Relayer] Fatal error:", err);
  process.exit(1);
});
