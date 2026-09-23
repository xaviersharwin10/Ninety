// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { BetRouter } from "../../src/BetRouter.sol";
import { Quote, Side, SignedQuote } from "../../src/interfaces/IBetRouter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @notice One-off smoke test: signs a quote and places a bet against a live deployment.
/// @dev Not part of the production script set — a throwaway harness for the Day 4 fork rehearsal.
contract PlaceBetSmoke is Script {
    function run() external {
        BetRouter r = BetRouter(vm.envAddress("ROUTER"));

        Quote memory q = Quote({
            marketId: vm.envUint("MARKET_ID"),
            agentId: uint32(vm.envUint("AGENT_ID")),
            probYesBps: 4635,
            probNoBps: 5665,
            maxStake: 25_000_000,
            expiry: uint64(block.timestamp + 30),
            salt: 1
        });

        bytes memory sig = _sign(r, q, vm.envUint("SIGNER_PK"));

        SignedQuote[] memory quotes = new SignedQuote[](1);
        quotes[0] = SignedQuote({ quote: q, signature: sig });

        uint256 fanPk = vm.envUint("FAN_PK");
        vm.startBroadcast(fanPk);
        IERC20(vm.envAddress("AUSD_ADDRESS")).approve(address(r), 10_000_000);
        (uint256 groupId, uint256[] memory betIds) = r.placeBet(q.marketId, Side.Yes, 10_000_000, 0, quotes);
        vm.stopBroadcast();

        console2.log("groupId", groupId);
        console2.log("betId  ", betIds[0]);
    }

    function _sign(BetRouter r, Quote memory q, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                r.QUOTE_TYPEHASH(),
                q.marketId,
                q.agentId,
                q.probYesBps,
                q.probNoBps,
                q.maxStake,
                q.expiry,
                q.salt
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", r.domainSeparator(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(rr, s, v);
    }
}
