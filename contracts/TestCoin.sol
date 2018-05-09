
pragma solidity 0.4.23;

import "openzeppelin-solidity/contracts/token/ERC20/StandardToken.sol";

contract TestCoin is ERC20, StandardToken {
    string public name = "TEST COIN";
    string public symbol = "TEST";
    uint8 public decimals = 18;
    uint public INITIAL_SUPPLY = 10000000000;

    constructor() public {
        totalSupply_ = INITIAL_SUPPLY;
        balances[msg.sender] = INITIAL_SUPPLY;
    }
}