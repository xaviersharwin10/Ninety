// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for AUSD in tests. Six decimals, because the real one has six and the payout
///         maths rounds at that precision.
contract MockUSD is ERC20 {
    constructor() ERC20("Mock Agora Dollar", "mAUSD") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
