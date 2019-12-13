pragma solidity ^0.5.2;

import "../oz/ERC20.sol";

contract Token is ERC20 {
    bool transfersEnabled = true;
    bool transfersReturningFalse = false;

    constructor(uint256 supply) public {
        _mint(msg.sender, supply);
    }

    function updateTransfersEnabled(bool enabled) external {
        transfersEnabled = enabled;
    }

    function updateTransfersReturningFalse(bool enabled) external {
        transfersReturningFalse = enabled;
    }

    function transfer(address to, uint256 value) public returns (bool) {
        if (transfersReturningFalse) {
            return false;
        }
        require(transfersEnabled);
        return super.transfer(to, value);
    }
}
