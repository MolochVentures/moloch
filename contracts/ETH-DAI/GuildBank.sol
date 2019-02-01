pragma solidity 0.4.24;

import "./oz/Ownable.sol";
import "./oz/ERC20.sol";
import "./oz/SafeMath.sol";
import "./LootToken.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    LootToken public lootToken; // loot token contract reference
    ERC20 public approvedToken; // approved token contract reference

    event DepositTributeTokens(address indexed sender, uint256 tokenAmount);
    event RedeemLootTokens(address indexed receiver, uint256 lootAmount, uint256 ethShare, uint256 tokenShare);

    constructor(address lootTokenAddress, address approvedTokenAddress) {
        lootToken = LootToken(lootTokenAddress);
        approvedToken = ERC20(approvedTokenAddress);
    }

    function depositTributeTokens(
        address sender,
        uint256 tokenAmount
    ) public onlyOwner returns (bool) {
        emit DepositTributeTokens(sender, tokenAmount);
        return (approvedToken.transferFrom(sender, this, tokenAmount));
    }

    function redeemLootTokens(
        address receiver,
        uint256 lootAmount
    ) public {
        // read the total supply into memory first so the math will work even if we burn first
        uint256 totalLootTokens = lootToken.totalSupply();

        require(lootToken.transferFrom(msg.sender, this, lootAmount), "GuildBank::redeemLootTokens - lootToken transfer failed");

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.burn(lootAmount);

        uint256 ethShare = this.balance.mul(lootAmount).div(totalLootTokens);
        receiver.transfer(ethShare);

        uint256 tokenShare = token.balanceOf(this).mul(lootAmount).div(totalLootTokens);
        require(approvedToken.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");

        emit RedeemLootTokens(receiver, lootAmount, ethShare, tokenShare);
    }
}