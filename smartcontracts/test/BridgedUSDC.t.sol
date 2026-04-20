// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BridgedUSDC} from "../src/BridgedUSDC.sol";

contract BridgedUSDCTest is Test {
    BridgedUSDC token;

    address admin   = makeAddr("admin");
    address minter  = makeAddr("minter");
    address alice   = makeAddr("alice");

    bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 constant AMOUNT      = 100e6;
    bytes32 constant LOCK_ID     = keccak256("lock1");

    function setUp() public {
        vm.startPrank(admin);
        token = new BridgedUSDC(admin, 6);
        token.grantRole(MINTER_ROLE, minter);
        vm.stopPrank();
    }

    // ── mint() ───────────────────────────────────────────────────────────────

    function test_mint_mintsTokens() public {
        vm.prank(minter);
        token.mint(alice, AMOUNT, LOCK_ID);
        assertEq(token.balanceOf(alice), AMOUNT);
    }

    function test_mint_emitsEvent() public {
        vm.prank(minter);
        vm.expectEmit(true, true, false, true);
        emit BridgedUSDC.TokensMinted(alice, AMOUNT, LOCK_ID);
        token.mint(alice, AMOUNT, LOCK_ID);
    }

    function test_mint_preventsDoubleMint() public {
        vm.startPrank(minter);
        token.mint(alice, AMOUNT, LOCK_ID);

        vm.expectRevert("BridgedUSDC: lockId already minted");
        token.mint(alice, AMOUNT, LOCK_ID);
        vm.stopPrank();
    }

    function test_mint_revertsForNonMinter() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, AMOUNT, LOCK_ID);
    }

    function test_mint_revertsOnZeroAmount() public {
        vm.prank(minter);
        vm.expectRevert("BridgedUSDC: zero amount");
        token.mint(alice, 0, LOCK_ID);
    }

    // ── burn() ───────────────────────────────────────────────────────────────

    function test_burn_burnsTokens() public {
        vm.prank(minter);
        token.mint(alice, AMOUNT, LOCK_ID);

        vm.prank(alice);
        token.burn(AMOUNT, 11155111, alice);

        assertEq(token.balanceOf(alice), 0);
    }

    function test_burn_emitsEvent() public {
        vm.prank(minter);
        token.mint(alice, AMOUNT, LOCK_ID);

        // burnId = keccak256(chainId, tokenAddress, burnNonce=0)
        bytes32 expectedBurnId = keccak256(
            abi.encodePacked(block.chainid, address(token), uint256(0))
        );

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit BridgedUSDC.TokensBurned(alice, AMOUNT, expectedBurnId, 11155111, alice);
        token.burn(AMOUNT, 11155111, alice);
    }

    function test_burn_incrementsBurnNonce() public {
        vm.prank(minter);
        token.mint(alice, AMOUNT * 2, LOCK_ID);

        assertEq(token.burnNonce(), 0);
        vm.prank(alice);
        token.burn(AMOUNT, 11155111, alice);
        assertEq(token.burnNonce(), 1);

        vm.prank(alice);
        token.burn(AMOUNT, 11155111, alice);
        assertEq(token.burnNonce(), 2);
    }

    function test_burn_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("BridgedUSDC: zero amount");
        token.burn(0, 11155111, alice);
    }

    // ── metadata ─────────────────────────────────────────────────────────────

    function test_decimals() public view {
        assertEq(token.decimals(), 6);
    }

    function test_name() public view {
        assertEq(token.name(), "Bridged USDC");
    }
}
