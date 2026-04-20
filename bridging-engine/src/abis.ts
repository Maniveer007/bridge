/**
 * Minimal ABIs — only the events and functions the bridging engine needs.
 * These are kept inline so the engine has zero dependency on the build output.
 */

export const BRIDGE_VAULT_ABI = [
  // Events
  "event TokensLocked(address indexed sender, uint256 amount, uint256 nonce, bytes32 indexed lockId, uint256 destinationChainId, address destinationAddress)",
  "event TokensUnlocked(address indexed recipient, uint256 amount, bytes32 indexed releaseId)",
  // Write
  "function unlock(address recipient, uint256 amount, bytes32 releaseId) external",
  // Read
  "function nonce() view returns (uint256)",
  "function processedReleases(bytes32 releaseId) view returns (bool)",
] as const;

export const BRIDGED_USDC_ABI = [
  // Events
  "event TokensBurned(address indexed burner, uint256 amount, bytes32 indexed burnId, uint256 destinationChainId, address destinationAddress)",
  // Write
  "function mint(address recipient, uint256 amount, bytes32 lockId) external",
  // Read
  "function processedMints(bytes32 lockId) view returns (bool)",
  "function burnNonce() view returns (uint256)",
] as const;
