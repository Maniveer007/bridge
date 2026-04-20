"use client";

import { useEffect } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { sourceChain, destChain } from "../config/chains";

/**
 * Automatically prompts the wallet to switch to the required chain.
 * @param direction "forward" → must be on sourceChain (Sepolia)
 *                  "reverse" → must be on destChain (local)
 */
export function useChainSwitch(direction: "forward" | "reverse" = "forward") {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  const targetChain   = direction === "forward" ? sourceChain : destChain;
  const isCorrectChain = chainId === targetChain.id;

  useEffect(() => {
    if (isConnected && !isCorrectChain) {
      switchChain({ chainId: targetChain.id });
    }
  }, [isConnected, isCorrectChain, switchChain, targetChain.id]);

  return {
    isCorrectChain,
    isSwitching:     isPending,
    switchError:     error,
    targetChainName: targetChain.name,
  };
}
