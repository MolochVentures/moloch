pragma solidity ^0.4.0;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./LootToken.sol";

contract GuildBank is Ownable {
    ERC20[] public tokensHeld; // array of token contracts that are held by bank. any better way to do this?
    LootToken public lootToken;

    function GuildBank(_lootTokenAddress) public {
        lootToken = LootToken(_lootTokenAddress);
    }

    function offerTokens(ERC20 _tokenContract, uint256 _amount) public {
        require(_tokenContract.transferFrom(msg.sender, this, _amount));
        tokensHeld.push(_tokenContract);
    }

    function convertLootTokensToLoot() public {

    }

    function() public payable {}
}