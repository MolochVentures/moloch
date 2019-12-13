pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";

contract GuildBank  {
    using SafeMath for uint256;

    address public owner;

    constructor () public {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    event Withdrawal(address indexed receiver, address indexed tokenAddress, uint256 amount);

    function withdraw(address _receiver, uint256 _shares, uint256 _totalShares, IERC20[] memory _approvedTokens) public onlyOwner returns (bool) {
        for (uint256 i = 0; i < _approvedTokens.length; i++) {
            uint256 amount = _approvedTokens[i].balanceOf(address(this)).mul(_shares).div(_totalShares);
            emit Withdrawal(_receiver, address(_approvedTokens[i]), amount);
            require(_approvedTokens[i].transfer(_receiver, amount));
        }
        return true;
    }

    function withdrawToken(IERC20 _token, address _receiver, uint256 _amount) public onlyOwner returns (bool) {
        emit Withdrawal(_receiver, address(_token), _amount);
        return _token.transfer(_receiver, _amount);
    }
}
