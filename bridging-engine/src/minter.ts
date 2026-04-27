import { ethers } from "ethers";
import { BridgeConfig } from "./config.js";
import { BRIDGED_USDC_ABI } from "./abis.js";
import {
  isProcessed,
  markProcessed,
  saveBridgeTx,
  completeBridgeTx,
  failBridgeTx,
} from "./store.js";

const MAX_RETRIES   = 3;
const RETRY_BASE_MS = 2_000;

export interface LockEvent {
  sender:             string;
  amount:             bigint;
  nonce:              bigint;
  lockId:             string;
  destinationChainId: bigint;
  destinationAddress: string;
  txHash:             string;
  blockNumber:        number;
}

/**
 * Mint bUSDC on the destination chain for a given lock event.
 * Idempotent — skips if the lockId was already processed locally or on-chain.
 * Saves a BridgeTx record to MongoDB, then updates it to "completed" / "failed".
 */
export async function processMint(
  event: LockEvent,
  config: BridgeConfig
): Promise<void> {
  const { lockId, amount, destinationAddress, txHash, blockNumber, sender } = event;

  // ── Local deduplication ─────────────────────────────────────────────────
  if (await isProcessed(lockId)) {
    console.log(`[Minter] Already processed locally — skipping lockId: ${lockId}`);
    return;
  }

  const relayerWallet = new ethers.Wallet(
    config.relayerKey,
    config.destination.provider
  );

  const bridgedUsdc = new ethers.Contract(
    config.destination.bridgedUsdcAddress,
    BRIDGED_USDC_ABI,
    relayerWallet
  );

  // ── On-chain deduplication ──────────────────────────────────────────────
  const alreadyMinted = await bridgedUsdc.processedMints(lockId);
  if (alreadyMinted) {
    console.log(`[Minter] Already minted on-chain — marking local store. lockId: ${lockId}`);
    await markProcessed(lockId);
    return;
  }

  // ── Persist a "pending" record so the frontend can see it immediately ───
  const humanAmount = ethers.formatUnits(amount, config.tokenDecimals);
  await saveBridgeTx({
    txId:         lockId,
    direction:    "forward",
    fromAddress:  sender,
    toAddress:    destinationAddress,
    amount:       humanAmount,
    sourceChain:  config.source.name,
    destChain:    config.destination.name,
    lockTxHash:   txHash,
    mintTxHash:   null,
    burnTxHash:   null,
    unlockTxHash: null,
    status:       "pending",
    error:        null,
    blockNumber,
    createdAt:    new Date(),
    completedAt:  null,
  });

  // ── Mint with retry ─────────────────────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[Minter] Attempt ${attempt}/${MAX_RETRIES} — minting ${humanAmount} bUSDC` +
        ` to ${destinationAddress} | lockId: ${lockId} | sourceTx: ${txHash}`
      );

      const tx      = await bridgedUsdc.mint(destinationAddress, amount, lockId);
      console.log(`[Minter] Tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[Minter] Confirmed in block ${receipt.blockNumber} — lockId: ${lockId}`);

      // Mark processed in dedup store + update BridgeTx to "completed".
      await markProcessed(lockId);
      await completeBridgeTx(lockId, tx.hash);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Minter] Attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
        // Persist the failure so the frontend can show the user.
        await failBridgeTx(lockId, msg);
        throw new Error(
          `[Minter] All ${MAX_RETRIES} attempts failed for lockId ${lockId}. Manual intervention required.`
        );
      }

      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[Minter] Retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
