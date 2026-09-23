// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { OddsMath } from "../../src/libraries/OddsMath.sol";

/// @notice External wrapper around OddsMath.
/// @dev `OddsMath` functions are `internal`, so they inline into the caller and revert at the same
///      call depth as a `vm.expectRevert` cheatcode, which Foundry rejects. Routing revert
///      assertions through this harness gives them a real external frame to unwind.
contract OddsMathHarness {
    function payoutFor(uint256 stake, uint256 probBps) external pure returns (uint256) {
        return OddsMath.payoutFor(stake, probBps);
    }

    function liabilityFor(uint256 stake, uint256 probBps) external pure returns (uint256) {
        return OddsMath.liabilityFor(stake, probBps);
    }

    function decimalOddsWad(
        uint256 probBps
    ) external pure returns (uint256) {
        return OddsMath.decimalOddsWad(probBps);
    }

    function validateQuote(
        uint256 probYesBps,
        uint256 probNoBps,
        uint256 minProbBps,
        uint256 maxProbBps,
        uint256 minMarginBps
    ) external pure {
        OddsMath.validateQuote(probYesBps, probNoBps, minProbBps, maxProbBps, minMarginBps);
    }

    function ladderAllocate(
        uint256 totalStake,
        uint256[] memory caps,
        uint16[] memory weightsBps
    ) external pure returns (uint256[] memory) {
        return OddsMath.ladderAllocate(totalStake, caps, weightsBps);
    }
}
