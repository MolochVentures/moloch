pragma solidity ^0.5.2;


import "./oz/SafeMath.sol";
import "./oz/ERC20.sol";
import "./oz/ERC20Detailed.sol";

contract BondingCurve is ERC20, ERC20Detailed {

    using SafeMath for uint256;

    uint256 public reserve;

    event CurveBuy(uint256 amount, uint256 paid, uint256 indexed when);
    event CurveSell(uint256 amount, uint256 rewarded, uint256 indexed when);

    constructor(string memory name, string memory symbol) public ERC20Detailed(name, symbol, 18) {
    }

    /**
     * Curve function interfaces 
     */
    function calculatePurchaseReturn(uint256 tokens) public view returns (uint256 thePrice);
    function calculateSaleReturn(uint256 tokens) public view returns (uint256 theReward);

    function sell(address payable receiver, uint256 tokens) internal returns (uint256 rewarded) {
        require(tokens > 0, "Must spend non-zero amount of tokens.");
        require(
            balanceOf(msg.sender) >= tokens,
            "Guild does not have enough tokens to spend."
        );

        rewarded = calculateSaleReturn(tokens);
        reserve = reserve.sub(rewarded);
        _burn(msg.sender, tokens);
        receiver.transfer(rewarded);

        emit CurveSell(tokens, rewarded, now);
    }
    
}
