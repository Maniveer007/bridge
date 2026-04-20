// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {BridgeVault} from "../src/BridgeVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Minimal mock USDC for testing.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract BridgeVaultTest is Test {
    BridgeVault vault;
    MockUSDC usdc;

    address owner   = makeAddr("owner");
    address relayer = makeAddr("relayer");
    address alice   = makeAddr("alice");

    uint256 constant DEST_CHAIN = 31337;
    uint256 constant AMOUNT     = 100e6; // 100 USDC

    function setUp() public {
        vm.startPrank(owner);
        usdc  = new MockUSDC();
        vault = new BridgeVault(address(usdc), relayer);
        vm.stopPrank();

        // Fund alice.
        usdc.mint(alice, AMOUNT * 10);
    }

    // ── lock() ───────────────────────────────────────────────────────────────

    function test_lock_emitsEvent() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), AMOUNT);

        bytes32 expectedLockId = keccak256(
            abi.encodePacked(block.chainid, address(vault), uint256(0))
        );

        vm.expectEmit(true, true, false, true);
        emit BridgeVault.TokensLocked(alice, AMOUNT, 0, expectedLockId, DEST_CHAIN, alice);

        vault.lock(AMOUNT, DEST_CHAIN, alice);
        vm.stopPrank();
    }

    function test_lock_transfersTokens() public {
        uint256 vaultBefore = usdc.balanceOf(address(vault));
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.startPrank(alice);
        usdc.approve(address(vault), AMOUNT);
        vault.lock(AMOUNT, DEST_CHAIN, alice);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), vaultBefore + AMOUNT);
        assertEq(usdc.balanceOf(alice), aliceBefore - AMOUNT);
    }

    function test_lock_incrementsNonce() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), AMOUNT * 2);
        vault.lock(AMOUNT, DEST_CHAIN, alice);
        assertEq(vault.nonce(), 1);
        vault.lock(AMOUNT, DEST_CHAIN, alice);
        assertEq(vault.nonce(), 2);
        vm.stopPrank();
    }

    function test_lock_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("BridgeVault: zero amount");
        vault.lock(0, DEST_CHAIN, alice);
    }

    function test_lock_revertsOnZeroDestAddress() public {
        vm.prank(alice);
        vm.expectRevert("BridgeVault: zero destination address");
        vault.lock(AMOUNT, DEST_CHAIN, address(0));
    }

    // ── unlock() ─────────────────────────────────────────────────────────────

    function _lockAndGetId() internal returns (bytes32 lockId) {
        lockId = keccak256(
            abi.encodePacked(block.chainid, address(vault), vault.nonce())
        );
        vm.startPrank(alice);
        usdc.approve(address(vault), AMOUNT);
        vault.lock(AMOUNT, DEST_CHAIN, alice);
        vm.stopPrank();
    }

    function test_unlock_releasesTokens() public {
        bytes32 lockId = _lockAndGetId();

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(relayer);
        vault.unlock(alice, AMOUNT, lockId);

        assertEq(usdc.balanceOf(alice), aliceBefore + AMOUNT);
    }

    function test_unlock_preventsDouble() public {
        bytes32 lockId = _lockAndGetId();

        vm.startPrank(relayer);
        vault.unlock(alice, AMOUNT, lockId);

        vm.expectRevert("BridgeVault: releaseId already processed");
        vault.unlock(alice, AMOUNT, lockId);
        vm.stopPrank();
    }

    function test_unlock_revertsForNonRelayer() public {
        bytes32 lockId = _lockAndGetId();

        vm.prank(alice);
        vm.expectRevert("BridgeVault: caller is not relayer");
        vault.unlock(alice, AMOUNT, lockId);
    }

    // ── setRelayer() ─────────────────────────────────────────────────────────

    function test_setRelayer_ownerOnly() public {
        address newRelayer = makeAddr("newRelayer");
        vm.prank(owner);
        vault.setRelayer(newRelayer);
        assertEq(vault.relayer(), newRelayer);
    }

    function test_setRelayer_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setRelayer(makeAddr("x"));
    }
}
