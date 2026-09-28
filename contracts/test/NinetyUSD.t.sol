// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Test } from "forge-std/Test.sol";

import { NinetyUSD } from "../src/NinetyUSD.sol";

contract NinetyUSDTest is Test {
    NinetyUSD internal token;
    address internal owner = makeAddr("owner");
    address internal fan = makeAddr("fan");

    function setUp() public {
        vm.warp(1_760_000_000);
        token = new NinetyUSD(owner);
    }

    function test_metadata() public view {
        assertEq(token.name(), "Ninety USD");
        assertEq(token.symbol(), "nUSD");
        assertEq(token.decimals(), 6);
    }

    function test_claim_mintsClaimAmount() public {
        vm.prank(fan);
        token.claim();
        assertEq(token.balanceOf(fan), token.CLAIM_AMOUNT());
        assertEq(token.nextClaimAt(fan), block.timestamp + token.CLAIM_COOLDOWN());
    }

    function test_claim_revertsInsideCooldown() public {
        vm.startPrank(fan);
        token.claim();
        uint256 availableAt = block.timestamp + token.CLAIM_COOLDOWN();
        vm.warp(availableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(NinetyUSD.ClaimTooSoon.selector, availableAt));
        token.claim();
        vm.stopPrank();
    }

    function test_claim_worksAgainAfterCooldown() public {
        vm.startPrank(fan);
        token.claim();
        vm.warp(block.timestamp + token.CLAIM_COOLDOWN());
        token.claim();
        vm.stopPrank();
        assertEq(token.balanceOf(fan), 2 * token.CLAIM_AMOUNT());
    }

    function test_nextClaimAt_zeroForNewAddress() public view {
        assertEq(token.nextClaimAt(fan), 0);
    }

    function test_mint_onlyOwner() public {
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fan));
        token.mint(fan, 1);

        vm.prank(owner);
        token.mint(fan, 5e6);
        assertEq(token.balanceOf(fan), 5e6);
    }
}
