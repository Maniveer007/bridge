import { ethers } from "ethers";
import { BridgeConfig } from "./config.js";
import { BRIDGED_USDC_ABI, BRIDGE_VAULT_ABI } from "./abis.js";
import { isProcessed, markProcessed, isReleaseProcessed, markReleaseProcessed } from "./store.js";

const MAX_RETRIES   = 3;
const RETRY_BASE_MS = 2_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Decoded TokensLocked event from BridgeVault on the source chain. */
export interface LockEvent {
  sender: string;
  amount: bigint;
  nonce: bigint;
  lockId: string;
  destinationChainId: bigint;
  destinationAddress: string;
  txHash: string;
  blockNumber: number;
}

/** Decoded TokensBurned event from BridgedUSDC on the destination chain. */
export interface BurnEvent {
  burner: string;
  amount: bigint;
  burnId: string;
  destinationChainId: bigint;
  destinationAddress: string;
  txHash: string;
  blockNumber: number;
}

// ─── Forward bridge — Lock → Mint ────────────────────────────────────────────

/**
 * Mint bUSDC on the destination chain for a given lock event.
 * Idempotent — skips if the lockId was already processed locally or on-chain.
 * Retries up to MAX_RETRIES times with exponential backoff.
 */
export async function processMint(
  event: LockEvent,
  config: BridgeConfig
): Promise<void> {
  const { lockId, amount, destinationAddress, txHash } = event;

  // ── Local deduplication (MongoDB) ─────────────────────────────────────────
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

  // ── On-chain deduplication ─────────────────────────────────────────────────
  const alreadyMinted = await bridgedUsdc.processedMints(lockId);
  if (alreadyMinted) {
    console.log(`[Minter] Already minted on-chain — marking local store. lockId: ${lockId}`);
    await markProcessed(lockId);
    return;
  }

  // ── Mint with retry ────────────────────────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[Minter] Attempt ${attempt}/${MAX_RETRIES} — minting ${ethers.formatUnits(amount, config.usdcDecimals)} bUSDC` +
        ` to ${destinationAddress} | lockId: ${lockId} | sourceTx: ${txHash}`
      );

      const tx = await bridgedUsdc.mint(destinationAddress, amount, lockId);
      console.log(`[Minter] Tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[Minter] Confirmed in block ${receipt.blockNumber} — lockId: ${lockId}`);

      // Only mark processed after on-chain confirmation.
      await markProcessed(lockId);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Minter] Attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
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

// ─── Reverse bridge — Burn → Unlock ──────────────────────────────────────────

/**
 * Call BridgeVault.unlock() on the source chain after detecting a TokensBurned
 * event on the destination chain.
 * Idempotent — skips if the burnId was already processed locally or on-chain.
 * Retries up to MAX_RETRIES times with exponential backoff.
 */
export async function processUnlock(
  event: BurnEvent,
  config: BridgeConfig
): Promise<void> {
  const { burnId, amount, destinationAddress, txHash } = event;

  // ── Local deduplication (MongoDB) ─────────────────────────────────────────
  if (await isReleaseProcessed(burnId)) {
    console.log(`[Unlocker] Already processed locally — skipping burnId: ${burnId}`);
    return;
  }

  const relayerWallet = new ethers.Wallet(
    config.relayerKey,
    config.source.provider
  );

  const vault = new ethers.Contract(
    config.source.vaultAddress,
    BRIDGE_VAULT_ABI,
    relayerWallet
  );

  // ── On-chain deduplication ─────────────────────────────────────────────────
  const alreadyReleased = await vault.processedReleases(burnId);
  if (alreadyReleased) {
    console.log(`[Unlocker] Already released on-chain — marking local store. burnId: ${burnId}`);
    await markReleaseProcessed(burnId);
    return;
  }

  // ── Unlock with retry ──────────────────────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[Unlocker] Attempt ${attempt}/${MAX_RETRIES} — unlocking ${ethers.formatUnits(amount, config.usdcDecimals)} USDC` +
        ` to ${destinationAddress} | burnId: ${burnId} | destTx: ${txHash}`
      );

      const tx = await vault.unlock(destinationAddress, amount, burnId);
      console.log(`[Unlocker] Tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[Unlocker] Confirmed in block ${receipt.blockNumber} — burnId: ${burnId}`);

      // Only mark processed after on-chain confirmation.
      await markReleaseProcessed(burnId);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Unlocker] Attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
        throw new Error(
          `[Unlocker] All ${MAX_RETRIES} attempts failed for burnId ${burnId}. Manual intervention required.`
        );
      }

      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[Unlocker] Retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
