pragma solidity 0.5.2;

import "./oz/Ownable.sol";
import "./oz/SafeMath.sol";
import "./BondingCurve.sol";

contract CurvedGuildBank is BondingCurve, Ownable {
    using SafeMath for uint256;

    event Withdrawal(address indexed receiver, uint256 amount);

    //address payable wallet;

    // Desired Curve: Linear Progression W/ % Buy/Sell Delta
    // Ex: Sell is always 90% of buy price.
    // https://www.desmos.com/calculator/9ierxx6kjw
    uint256 slopeNumerator;
    uint256 slopeDenominator;
    uint256 sellPercentage; // ex: 90 == 90% of buy price

    event Payout(uint256 payout, uint256 indexed timestamp);

    constructor(
        //address payable _wallet,
        string memory name,
        string memory symbol,
        uint256 _slopeNumerator,
        uint256 _slopeDenominator,
        uint256 _sellPercentage
    ) public BondingCurve(name, symbol) {
        require(
            _sellPercentage < 100 && _sellPercentage != 0,
            "Percentage must be between 0 & 100"
        );
        //wallet = _wallet;
        slopeNumerator = _slopeNumerator;
        slopeDenominator = _slopeDenominator;
        sellPercentage = _sellPercentage;
    }

    function buyIntegral(uint256 x) internal view returns (uint256) {
        return (slopeNumerator * x * x) / (2 * slopeDenominator);
    }

    function sellIntegral(uint256 x) internal view returns (uint256) {
        return (slopeNumerator * x * x * sellPercentage) / (200 * slopeDenominator);
    }

    function spread(uint256 toX) public view returns (uint256) {
        uint256 buy = buyIntegral(toX);
        uint256 sell = sellIntegral(toX);
        return buy.sub(sell);
    }

    function calculatePurchaseReturn(uint256 tokens) public view returns (uint256) {
        return buyIntegral(
            totalSupply().add(tokens)
        ).sub(reserve);
    }

    function calculateSaleReturn(uint256 tokens) public view returns (uint256) {
        return reserve.sub(
            sellIntegral(
                totalSupply().sub(tokens)
        ));
    }

    /// Overwrite
    function buy(address payable processor, address payable proposer, uint256 tokens) public payable onlyOwner {
        uint256 spreadBefore = spread(totalSupply());
        super.buy(processor, proposer, tokens);

        uint256 spreadAfter = spread(totalSupply());

        uint256 spreadPayout = spreadAfter.sub(spreadBefore);
        reserve = reserve.sub(spreadPayout);
        processor.transfer(spreadPayout);

        emit Payout(spreadPayout, now);
    }

    function withdraw(address payable receiver, uint256 shares, uint256 totalShares) public onlyOwner returns (bool) {
        uint256 amount = balanceOf(address(this)).mul(shares).div(totalShares);
        emit Withdrawal(receiver, amount);
        return transfer(receiver, amount);
    }
}
