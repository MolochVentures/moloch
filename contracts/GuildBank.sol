pragma solidity 0.5.3;

import "./oz/Ownable.sol";
import "./oz/ERC20.sol";
import "./oz/SafeMath.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    ERC20 public approvedToken; // approved token contract reference

    event Deposit(uint256 amount);
    event Withdrawal(address indexed receiver, uint256 amount);

    constructor(address approvedTokenAddress) public {
        approvedToken = ERC20(approvedTokenAddress);
    }

    function withdraw(address receiver, uint256 shares, uint256 totalShares) public onlyOwner returns (bool) {
        uint256 amount = approvedToken.balanceOf(address(this)).mul(shares).div(totalShares);
        emit Withdrawal(receiver, amount);
        return approvedToken.transfer(receiver, amount);
    }
}
