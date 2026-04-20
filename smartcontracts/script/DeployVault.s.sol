// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BridgeVault} from "../src/BridgeVault.sol";

/**
 * @notice Deploy BridgeVault on the source chain (Sepolia).
 *
 * Usage:
 *   forge script script/DeployVault.s.sol \
 *     --rpc-url $SOURCE_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Required env vars (smartcontracts/.env):
 *   SOURCE_RPC_URL        — Sepolia RPC endpoint
 *   DEPLOYER_PRIVATE_KEY  — deployer wallet private key
 *   USDC_ADDRESS          — Sepolia USDC (0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
 *   RELAYER_ADDRESS       — relayer wallet that the bridging engine uses
 */
contract DeployVault is Script {
    function run() external {
        address usdcAddress   = vm.envAddress("USDC_ADDRESS");
        address relayerAddress = vm.envAddress("RELAYER_ADDRESS");
        uint256 deployerKey   = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        BridgeVault vault = new BridgeVault(usdcAddress, relayerAddress);

        vm.stopBroadcast();

        console.log("=== BridgeVault deployed ===");
        console.log("Address  :", address(vault));
        console.log("USDC     :", usdcAddress);
        console.log("Relayer  :", relayerAddress);
        console.log("");
        console.log("Add to bridging-engine/.env and frontend/.env.local:");
        console.log("  VAULT_ADDRESS=", address(vault));
    }
}
