// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BridgedUSDC} from "../src/BridgedUSDC.sol";

/**
 * @notice Deploy BridgedUSDC on the destination chain (local / custom).
 *         Also grants MINTER_ROLE to the relayer wallet so the bridging engine
 *         can call mint() without any extra steps.
 *
 * Usage — local Hardhat/Anvil node:
 *   forge script script/DeployBridgedUSDC.s.sol \
 *     --rpc-url $DEST_RPC_URL \
 *     --broadcast \
 *     -vvvv
 *
 * Usage — real destination chain:
 *   forge script script/DeployBridgedUSDC.s.sol \
 *     --rpc-url $DEST_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Required env vars (smartcontracts/.env):
 *   DEST_RPC_URL          — destination chain RPC endpoint
 *   DEPLOYER_PRIVATE_KEY  — deployer wallet private key
 *   RELAYER_ADDRESS       — relayer wallet (receives MINTER_ROLE)
 */
contract DeployBridgedUSDC is Script {
    function run() external {
        address relayerAddress = vm.envAddress("RELAYER_ADDRESS");
        uint256 deployerKey    = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint8   decimals_      = uint8(vm.envUint("USDC_DECIMALS"));

        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy — deployer is the initial admin and gets MINTER_ROLE.
        BridgedUSDC bridgedUsdc = new BridgedUSDC(deployer, decimals_);

        // Grant MINTER_ROLE to the relayer so the bridging engine can mint.
        bytes32 minterRole = keccak256("MINTER_ROLE");
        bridgedUsdc.grantRole(minterRole, relayerAddress);

        vm.stopBroadcast();

        console.log("=== BridgedUSDC deployed ===");
        console.log("Address  :", address(bridgedUsdc));
        console.log("Decimals :", decimals_);
        console.log("Admin    :", deployer);
        console.log("Minter   :", relayerAddress);
        console.log("");
        console.log("Add to bridging-engine/.env and frontend/.env.local:");
        console.log("  BRIDGED_USDC_ADDRESS=", address(bridgedUsdc));
    }
}
