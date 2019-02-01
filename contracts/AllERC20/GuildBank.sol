pragma solidity 0.5.3;

import "./oz/Ownable.sol";
import "./oz/ERC20.sol";
import "./oz/SafeMath.sol";
import "./LootToken.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    LootToken public lootToken; // loot token contract reference
    mapping (address => bool) public knownTokens; // true for tokens that have ever been deposited into the guild back
    address[] public tokenAddresses; // the complete set of unique token addresses held by guild bank

    mapping (uint256 => mapping (address => bool)) safeRedeemsById; // tracks token addresses already withdrawn for each unique safeRedeem attempt to prevent double-withdrawals
    uint256 safeRedeemId = 0; // incremented on every safeRedeem attempt

    function setLootTokenAddress(address lootTokenAddress) public onlyOwner returns (address) {
        require (address(lootTokenAddress) != address(0), "GuildBank::setLootTokenAddress address must not be zero");
        require (address(lootToken) == address(0),"GuildBank::setLootTokenAddress Loot Token address already set");
        lootToken = LootToken(lootTokenAddress);
        return lootTokenAddress;
    }

    function depositTributeTokens(
        address sender,
        address tokenAddress,
        uint256 tokenAmount
    ) public onlyOwner returns (bool) {
        if ((knownTokens[tokenAddress] == false) && (tokenAddress != address(lootToken))) {
            knownTokens[tokenAddress] = true;
            tokenAddresses.push(tokenAddress);
        }
        ERC20 token = ERC20(tokenAddress);
        return (token.transferFrom(sender, address(this), tokenAmount));
    }

    function redeemLootTokens(
        address receiver,
        uint256 lootAmount
    ) public {
        uint256 totalLootTokens = lootToken.totalSupply();

        require(lootToken.transferFrom(msg.sender, address(this), lootAmount), "GuildBank::redeemLootTokens - lootToken transfer failed");

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.burn(lootAmount);

        // transfer proportional share of all tokens held by the guild bank
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            ERC20 token = ERC20(tokenAddresses[i]);
            uint256 tokenShare = token.balanceOf(address(this)).mul(lootAmount).div(totalLootTokens);
            require(token.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");
        }
    }


    function safeRedeemLootTokens(
        address receiver,
        uint256 lootAmount,
        address[] memory safeTokenAddresses
    ) public {
        safeRedeemId = safeRedeemId.add(1);

        uint256 totalLootTokens = lootToken.totalSupply();

        require(lootToken.transferFrom(msg.sender, address(this), lootAmount), "GuildBank::redeemLootTokens - lootToken transfer failed");

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.burn(lootAmount);

        // transfer proportional share of all tokens held by the guild bank
        for (uint256 i = 0; i < safeTokenAddresses.length; i++) {
            if (!safeRedeemsById[safeRedeemId][safeTokenAddresses[i]]) {
                safeRedeemsById[safeRedeemId][safeTokenAddresses[i]] = true;
                ERC20 token = ERC20(safeTokenAddresses[i]);
                uint256 tokenShare = token.balanceOf(address(this)).mul(lootAmount).div(totalLootTokens);
                require(token.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");
            }
        }
    }
}
