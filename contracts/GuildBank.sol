pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";

contract GuildBank  {
    using SafeMath for uint256;

    // TODO BlockRocket changed from OZ ownable to bring in smaller version. Please approve or remove.
    address public owner;

    constructor () public {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    event Withdrawal(address indexed receiver, address indexed tokenAddress, uint256 amount);

    function withdraw(address receiver, uint256 shares, uint256 totalShares, IERC20[] memory approvedTokens) public onlyOwner returns (bool) {
        for (uint256 i = 0; i < approvedTokens.length; i++) {
            uint256 amount = approvedTokens[i].balanceOf(address(this)).mul(shares).div(totalShares);
            emit Withdrawal(receiver, address(approvedTokens[i]), amount);
            // TODO BlockRocket changed from 'return approvedTokens[i].transfer(receiver, amount)' - wrapped in require and added return true external to loop. Please approve or remove.
            require(approvedTokens[i].transfer(receiver, amount));
        }
        return true;
    }

    function withdrawToken(IERC20 token, address receiver, uint256 amount) public onlyOwner returns (bool) {
        emit Withdrawal(receiver, address(token), amount);
        return token.transfer(receiver, amount);
    }
}
