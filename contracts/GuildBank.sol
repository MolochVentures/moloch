pragma solidity 0.5.2;

import "./oz/Ownable.sol";
import "./oz/IERC20.sol";
import "./oz/SafeMath.sol";
import "./TrojanBondingCurve.sol";

contract GuildBank is TrojanBondingCurve, Ownable {
    using SafeMath for uint256;

    event Withdrawal(address indexed receiver, uint256 amount);

    constructor(
        address payable _wallet,
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 _slopeNumerator,
        uint256 _slopeDenominator,
        uint256 _sellPercentage
    ) public TrojanBondingCurve(
        _wallet,
        name,
        symbol,
        decimals,
        _slopeNumerator,
        _slopeDenominator,
        _sellPercentage
    ) {
    }

    function withdraw(address payable receiver, uint256 shares, uint256 totalShares) public onlyOwner returns (uint256) {
        uint256 amount = balanceOf(address(this)).mul(shares).div(totalShares);
        emit Withdrawal(receiver, amount);
        return sell(receiver, amount);
    }
}
