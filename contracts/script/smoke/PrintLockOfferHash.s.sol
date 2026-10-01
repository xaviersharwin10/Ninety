// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Script, console2 } from "forge-std/Script.sol";

import { OddsLock } from "../../src/OddsLock.sol";
import { IAgentRegistry } from "../../src/interfaces/IAgentRegistry.sol";
import { Side } from "../../src/interfaces/IBetRouter.sol";
import { IMarketManager } from "../../src/interfaces/IMarketManager.sol";

/// @notice Prints OddsLock's EIP-712 digest for a fixed offer, the reference value that
///         packages/core/test/odds-lock.test.ts pins the TypeScript side against.
///         `forge script script/smoke/PrintLockOfferHash.s.sol`
contract PrintLockOfferHash is Script {
    function run() external {
        OddsLock locks =
            new OddsLock(IERC20(address(1)), IAgentRegistry(address(2)), IMarketManager(address(3)));
        OddsLock.LockOffer memory o = OddsLock.LockOffer({
            marketId: 42,
            agentId: 7,
            side: Side.No,
            probBps: 5665,
            maxStake: 25_000_000,
            feeBps: 340,
            holdSeconds: 30,
            expiry: 1_700_000_100,
            salt: 1_234_567_890
        });
        console2.log("chainId", block.chainid);
        console2.log("OddsLock", address(locks));
        console2.logBytes32(locks.hashOffer(o));
    }
}
