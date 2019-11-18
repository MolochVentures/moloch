pragma solidity 0.5.3;

import "./oz/Ownable.sol";
import "./oz/IERC20.sol";
import "./oz/SafeMath.sol";

contract GuildBank is Ownable {
    using SafeMath for uint256;

    event Withdrawal(address indexed receiver, address indexed tokenAddress, uint256 amount);

    function withdraw(address receiver, uint256 shares, uint256 totalShares, IERC20[] memory approvedTokens) public onlyOwner returns (bool) {
        for (uint256 i = 0; i < approvedTokens.length; i++) {
            uint256 amount = approvedTokens[i].balanceOf(address(this)).mul(shares).div(totalShares);
            emit Withdrawal(receiver, address(approvedTokens[i]), amount);
            require(approvedTokens[i].transfer(receiver, amount));
        }
        return true;
    }

    function withdrawToken(IERC20 token, address receiver, uint256 amount) public onlyOwner returns (bool) {
        emit Withdrawal(receiver, address(token), amount);
        return token.transfer(receiver, amount);
    }
}
