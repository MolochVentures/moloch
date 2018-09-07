pragma solidity 0.4.23;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./LootToken.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    LootToken public lootToken;
    mapping (address => bool) knownTokenAddress;
    address[] public tokenAddresses;

    constructor(address lootokenAddress) public {
        lootToken = LootToken(lootokenAddress);
    }

    function offerTokens(
        address holder, 
        address tokenContract, 
        uint256 amount
    ) 
        public 
        returns (bool)
    {
        if ((knownTokenAddress[tokenContract] == false) && (tokenContract != address(lootToken)) {
            knownTokenAddress[tokenContract] = true;
            tokenAddresses.push(tokenContract);
        }
        ERC20 token = ERC20(tokenContract);
        return (token.transferFrom(holder, this, amount));
    }

    function convertLootTokensToLoot(
        address memberAddress, 
        address[] tokenTributeAddresses
    )    
        public 
    {
        uint256 myLootTokens = lootToken.balanceOf(memberAddress);
        uint256 totalLootTokens = lootToken.totalSupply();

        // cash out tokens
        for (uint8 i = 0; i < tokenTributeAddresses.length; i++) {
            ERC20 token = ERC20(tokenTributeAddresses[i]);
            uint256 guildBankTokens = token.balanceOf(address(this));
            uint256 amtToTransfer = (guildBankTokens.mul(myLootTokens)).div(totalLootTokens);
            require(token.transfer(memberAddress, amtToTransfer), "GuildBank::convertLootTokensToLoot - failed to transfer to member");
        }
        // cash out ETH
        uint256 amtEthToTransfer = (address(this).balance.mul(myLootTokens)).div(totalLootTokens);
        memberAddress.transfer(amtEthToTransfer);
        // burn loot tokens
        lootToken.proxyBurn(memberAddress, myLootTokens);
    }
    
    function withdraw(
        address _address, 
        address[] _tokenTributeAddresses, 
        uint[] _tokenTributeAmounts, 
        uint _ethAmount
    ) 
        onlyOwner 
        public 
    {
        for (uint8 i = 0; i < _tokenTributeAddresses.length; i++) {
            ERC20 token = ERC20(_tokenTributeAddresses[i]);
            require(token.transfer(_address, _tokenTributeAmounts[i]), "GuildBank::withdraw - failed to transfer to member");
        }
        _address.transfer(_ethAmount);
    }

    function getTokenAddresses() view public returns (address[]) {
        return tokenAddresses;
    }

    function() public payable {}
}