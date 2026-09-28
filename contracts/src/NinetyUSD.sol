// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title NinetyUSD (nUSD)
/// @notice The testnet stablecoin fans bet with and agent vaults hold. Six decimals, like USDC and
///         AUSD, because OddsMath rounds payouts at that precision.
///
/// @dev Why our own token rather than an existing testnet stablecoin: the shared Agora AUSD faucet
///      on Monad testnet ran dry (`InsufficientFunds()` for every recipient), and Circle's testnet
///      USDC is only claimable through a captcha-gated web page, 20 at a time. Either way a fan or
///      judge opening the app could end up with nothing to bet with. The faucet here is the token
///      itself -- `claim()` mints -- so it cannot be drained, and the app can call it in one tap.
///      A per-address cooldown keeps one address from inflating its balance without limit, which
///      matters only for how leaderboards read, not for safety: nUSD has no value by design.
contract NinetyUSD is ERC20, Ownable {
    /// @notice What one `claim()` mints: 1,000 nUSD.
    uint256 public constant CLAIM_AMOUNT = 1000e6;
    /// @notice How long an address waits between claims.
    uint256 public constant CLAIM_COOLDOWN = 1 hours;

    /// @notice Unix seconds of each address's last claim; 0 if it never claimed.
    mapping(address account => uint256) public lastClaimAt;

    event Claimed(address indexed account, uint256 amount);

    error ClaimTooSoon(uint256 availableAt);

    constructor(
        address owner_
    ) ERC20("Ninety USD", "nUSD") Ownable(owner_) { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint `CLAIM_AMOUNT` to the caller, at most once per `CLAIM_COOLDOWN`.
    function claim() external {
        uint256 availableAt = nextClaimAt(msg.sender);
        if (block.timestamp < availableAt) revert ClaimTooSoon(availableAt);
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice When `account` may next claim; 0 means now.
    function nextClaimAt(
        address account
    ) public view returns (uint256) {
        uint256 last = lastClaimAt[account];
        return last == 0 ? 0 : last + CLAIM_COOLDOWN;
    }

    /// @notice Owner-only mint, used to seed the house agents' vaults.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
