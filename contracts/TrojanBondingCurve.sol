pragma solidity ^0.5.2;


import "./BondingCurve.sol";

contract TrojanBondingCurve is BondingCurve {

    address payable wallet;

    // Desired Curve: Linear Progression W/ % Buy/Sell Delta
    // Ex: Sell is always 90% of buy price.
    // https://www.desmos.com/calculator/9ierxx6kjw
    uint256 slopeNumerator;
    uint256 slopeDenominator;
    uint256 sellPercentage; // ex: 90 == 90% of buy price

    event Payout(uint256 payout, uint256 indexed timestamp);

    constructor(
        address payable _wallet,
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 _slopeNumerator,
        uint256 _slopeDenominator,
        uint256 _sellPercentage
    ) public BondingCurve(name, symbol, decimals) {
        require(
            _sellPercentage < 100 && _sellPercentage != 0,
            "Percentage must be between 0 & 100"
        );
        wallet = _wallet;
        slopeNumerator = _slopeNumerator;
        slopeDenominator = _slopeDenominator;
        sellPercentage = _sellPercentage;
    }

    function buyIntegral(uint256 x)
        internal view returns (uint256)
    {
        return (slopeNumerator * x * x) / (2 * slopeDenominator);
    }

    function sellIntegral(uint256 x)
        internal view returns (uint256)
    {
        return (slopeNumerator * x * x * sellPercentage) / (200 * slopeDenominator);
    }

    function spread(uint256 toX)
        public view returns (uint256)
    {
        uint256 buy = buyIntegral(toX);
        uint256 sell = sellIntegral(toX);
        return buy.sub(sell);
    }

    /// Overwrite
    function buy(uint256 tokens) public payable {
        uint256 spreadBefore = spread(totalSupply());
        super.buy(tokens);

        uint256 spreadAfter = spread(totalSupply());

        uint256 spreadPayout = spreadAfter.sub(spreadBefore);
        reserve = reserve.sub(spreadPayout);
        wallet.transfer(spreadPayout);

        emit Payout(spreadPayout, now);
    }

    function calculatePurchaseReturn(uint256 tokens)
        public view returns (uint256)
    {
        return buyIntegral(
            totalSupply().add(tokens)
        ).sub(reserve);
    }

    function calculateSaleReturn(uint256 tokens)
        public view returns (uint256)
    {
        return reserve.sub(
            sellIntegral(
                totalSupply().sub(tokens)
        ));
    }
}
