// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @notice Prints a reference EIP-712 signature for a fixed quote and known private key, so the
///         TypeScript signing helper (packages/agents/src/eip712.ts) can be pinned against a
///         value computed independently in Solidity rather than only checked against itself.
/// @dev A standalone EIP712 domain matching BetRouter's constructor exactly ("Ninety", "1"), so
///      this needs no deployed contract -- just the same domain separator computation.
contract DomainOnly is EIP712 {
    constructor() EIP712("Ninety", "1") { }

    function hashTypedData(
        bytes32 structHash
    ) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
}

contract PrintQuoteSignature is Script {
    // Fixed test vector -- must match the constants in eip712.test.ts exactly.
    uint256 constant MARKET_ID = 42;
    uint32 constant AGENT_ID = 7;
    uint16 constant PROB_YES_BPS = 4635;
    uint16 constant PROB_NO_BPS = 5665;
    uint128 constant MAX_STAKE = 25_000_000;
    uint64 constant EXPIRY = 1_700_000_100;
    uint256 constant SALT = 1234567890;
    uint256 constant SIGNER_PK = 0xA11CE;

    function run() external {
        DomainOnly d = new DomainOnly();

        bytes32 typehash = keccak256(
            "Quote(uint256 marketId,uint32 agentId,uint16 probYesBps,uint16 probNoBps,uint128 maxStake,uint64 expiry,uint256 salt)"
        );
        bytes32 structHash = keccak256(
            abi.encode(typehash, MARKET_ID, AGENT_ID, PROB_YES_BPS, PROB_NO_BPS, MAX_STAKE, EXPIRY, SALT)
        );
        bytes32 digest = d.hashTypedData(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);

        console2.log("signer   ", vm.addr(SIGNER_PK));
        console2.log("chainId  ", block.chainid);
        console2.log("verifier ", address(d));
        console2.logBytes32(digest);
        console2.logBytes(abi.encodePacked(r, s, v));
    }
}
