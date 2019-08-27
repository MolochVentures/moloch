pragma solidity 0.5.3;

import "./oz/Ownable.sol";
import "./oz/IERC20.sol";
import "./oz/SafeMath.sol";
import "./MolochVentures.sol";

// TODO - circular reference between moloch.sol <> guildbank.sol

contract GuildBank is Ownable {
    using SafeMath for uint256;

    MolochVentures public moloch;

    event Withdrawal(address indexed receiver, uint256 amount);

    constructor(address molochAddress) public {
        moloch = MolochVentures(molochAddress);
    }

    function withdraw(address receiver, uint256 shares, uint256 totalShares, IERC20[] approvedTokens) public onlyOwner returns (bool) {
        for (var i=0; i < approvedTokens.length; i++) {
            uint256 amount = approvedTokens[i].balanceOf(address(this)).mul(shares).div(totalShares);
            return approvedTokens[i].transfer(receiver, amount);
        }

        // emit Withdrawal(receiver, amount);
    }

    function withdrawToken(address tokenAddress, address receiver, uint256 amount) public onlyOwner returns (bool) {
        emit Withdrawal(receiver, amount);
        return IERC20(tokenAddress).transfer(receiver, amount);
    }

}
