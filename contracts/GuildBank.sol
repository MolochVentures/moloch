pragma solidity 0.4.23;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./LootToken.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    ERC20[] public tokensHeld; // array of token contracts that are held by bank. any better way to do this?
    LootToken public lootToken;
    address public owner;

    constructor(address _lootokenAddress) public {
        owner = msg.sender;
        lootToken = LootToken(_lootokenAddress);
    }

    function offerTokens(ERC20 _tokenContract, uint256 _amount) public {
        require(_tokenContract.transferFrom(msg.sender, this, _amount), "GuildBank::offerTokens - failed to transfer tokens to GuildBank");
        tokensHeld.push(_tokenContract);
    }

    function convertLootTokensToLoot(address memberAddress) public {
        uint256 myLootTokens = lootToken.balanceOf(memberAddress);
        uint256 totalLootTokens = lootToken.totalSupply();

        // cash out tokens
        for (uint8 i = 0; i < tokensHeld.length; i++) {
            uint256 guildBankTokens = tokensHeld[i].balanceOf(address(this));
            uint256 amtToTransfer = (guildBankTokens.mul(myLootTokens)).div(totalLootTokens);
            require(tokensHeld[i].transfer(memberAddress, amtToTransfer), "GuildBank::convertLootTokensToLoot - failed to transfer to member");
        }

        // cash out ETH
        uint256 amtEthToTransfer = (address(this).balance.mul(myLootTokens)).div(totalLootTokens);
        memberAddress.transfer(amtEthToTransfer);

        // burn loot tokens
        lootToken.proxyBurn(owner, memberAddress, myLootTokens);
    }
    
    function() public payable {}
}