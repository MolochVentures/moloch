pragma solidity 0.4.21;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./LootToken.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";

library GuildBankLib {
    using SafeMath for uint;

    struct Vault { 
        LootToken loot;
        ERC20[] tokensHeld;
        mapping(address => Withdrawls) withdrawls;
    }

    struct Token {
        address tokenAddress;
        uint tokenAmount;
    }

    struct Withdrawls {
        Token[] tokens;
    }

    function init(Vault storage _vault, address _lootTokenAddress) public {
        _vault.loot = LootToken(_lootTokenAddress);
    }

    function offerTokens(Vault storage _vault, ERC20 _tokenAddress, uint256 _amount) public {
        require(_tokenAddress.transferFrom(msg.sender, this, _amount));
        _vault.tokensHeld.push(_tokenAddress);
    }

    function redeemLootTokens(Vault storage _vault) public {
        uint256 userLootBalance = _vault.loot.balanceOf(msg.sender);
        uint256 totalLootSupply = _vault.loot.totalSupply();

        uint ethToRedeem = (address(this).balance.mul(userLootBalance)).div(totalLootSupply);

        Token[] tokensToRedeem;

        for (uint i = 0; i < _vault.tokensHeld.length; i++) {
            uint guildBankTokens = _vault.tokensHeld[i].balanceOf(this);
            uint lootTransferAmount = (guildBankTokens.mul(userLootBalance)).div(totalLootSupply);
            tokensToRedeem.push(Token({tokenAddress:_vault.tokensHeld[i], tokenAmount:lootTransferAmount}));         
        }


        _vault.withdrawls[msg.sender] = Withdrawls(ethToRedeem, tokensToRedeem);
    }
}