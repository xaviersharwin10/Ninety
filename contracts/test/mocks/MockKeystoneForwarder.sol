// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Reproduces the real MockKeystoneForwarder's one load-bearing property for tests: it
///         forwards to the receiver with an attacker-chosen metadata header and does not verify
///         any signature, matching the behaviour measured on Monad testnet and recorded in
///         docs/cre-forwarder-trust-model.md.
interface IOnReportReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract MockKeystoneForwarder {
    /// @dev Mirrors the real forwarder's report() signature so the test workflow helper can target
    ///      either one interchangeably. `reportContext` and `signatures` are accepted and ignored,
    ///      exactly like the real mock: it has no signer set to check them against.
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata, /* reportContext */
        bytes[] calldata /* signatures */
    ) external {
        // rawReport = 109-byte Keystone header ++ payload, matching the layout documented for the
        // real forwarder. We only need to split header/payload and re-pack the 64-byte metadata
        // block the same way the real forwarder does before calling onReport.
        bytes memory metadata = new bytes(64);
        bytes32 workflowCid;
        bytes10 workflowName;
        address workflowOwner;
        bytes2 reportId;
        assembly {
            let base := add(rawReport.offset, 45) // skip version(1)+execId(32)+ts(4)+donId(4)+donConfigVersion(4)
            workflowCid := calldataload(base)
            workflowName := calldataload(add(base, 32))
            workflowOwner := shr(96, calldataload(add(base, 42)))
            reportId := calldataload(add(base, 62))
        }
        assembly {
            mstore(add(metadata, 32), workflowCid)
            mstore(add(metadata, 64), workflowName)
        }
        // workflowOwner (20 bytes) at offset 42, reportId (2 bytes) at offset 62 — write via
        // byte-level copy since they don't align to a 32-byte word boundary.
        for (uint256 i = 0; i < 20; ++i) {
            metadata[42 + i] = bytes1(uint8(uint160(workflowOwner) >> (8 * (19 - i))));
        }
        metadata[62] = reportId[0];
        metadata[63] = reportId[1];

        bytes memory payload = rawReport[109:];

        IOnReportReceiver(receiver).onReport(metadata, payload);
    }
}
