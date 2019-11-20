pragma solidity ^0.5.2;

import "./oz/ERC20.sol";

contract Token is ERC20 {
    bool transfersEnabled = true;

    constructor(uint256 supply) public {
        _mint(msg.sender, supply);
    }

    function updateTransfersEnabled(bool enabled) external {
        transfersEnabled = enabled;
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(transfersEnabled);
        return super.transfer(to, value);
    }
}
