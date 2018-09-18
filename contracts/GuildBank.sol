pragma solidity 0.4.24;

import "./oz/Ownable.sol";
import "./oz/ERC20.sol";
import "./oz/SafeMath.sol";
import "./LootToken.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    LootToken public lootToken;
    mapping (address => bool) knownTokens;
    address[] public tokenAddresses;

    constructor(address lootokenAddress) public {
        lootToken = LootToken(lootTokenAddress);
    }

    function depositTributeTokens(
        address sender,
        address tokenAddress,
        uint256 tokenAmount
    ) public returns (bool) {
        if ((knownTokens[tokenAddress] == false) && (tokenAddress != address(lootToken))) {
            knownTokens[tokenAddress] = true;
            tokenAddresses.push(tokenAddress);
        }
        ERC20 token = ERC20(tokenAddress);
        return (token.transferFrom(sender, this, amount));
    }

    function redeemLootTokens(
        address receiver,
        uint256 lootAmount
    ) public {
        uint256 totalLootTokens = lootToken.totalSupply();

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.proxyBurn(msg.sender, lootAmount);

        // transfer proportional share of all tokens held by the guild bank
        for (uint8 i = 0; i < tokenAddresses.length; i++) {
            ERC20 token = ERC20(tokenAddresses[i]);
            uint256 tokenShare = token.balanceOf(this).mul(lootAmount).div(totalLootTokens));
            require(token.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");
        }
    }
}
