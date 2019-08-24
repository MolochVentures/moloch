pragma solidity 0.5.3;

import "./oz/Ownable.sol";
import "./oz/IERC20.sol";
import "./oz/SafeMath.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    // TODO make this just "Token"
    // - update share based withdraw to loop over all tokens
    IERC20 public approvedToken; // approved token contract reference

    event Withdrawal(address indexed receiver, uint256 amount);

    constructor(address approvedTokenAddress) public {
        approvedToken = IERC20(approvedTokenAddress);
    }

    function withdraw(address receiver, uint256 shares, uint256 totalShares) public onlyOwner returns (bool) {
        uint256 amount = approvedToken.balanceOf(address(this)).mul(shares).div(totalShares);
        emit Withdrawal(receiver, amount);
        return approvedToken.transfer(receiver, amount);
    }

    // TODO function to withdraw token from address / amount
    // - onlyOwner
    // - called when proposals require payment
    function withdrawToken(address receiver, address token) public onlyOwner returns (bool) {
        emit Withdrawal(receiver, amount);
        return approvedToken.transfer(receiver, amount);
    }

}
