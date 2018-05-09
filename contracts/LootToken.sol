pragma solidity 0.4.23;

import "openzeppelin-solidity/contracts/token/ERC20/BurnableToken.sol";
import "openzeppelin-solidity/contracts/token/ERC20/MintableToken.sol";

contract LootToken is MintableToken {
    event Burn(address indexed from, uint256 amount);

    string public constant name = "LootToken"; // solium-disable-line uppercase
    string public constant symbol = "MLL"; // solium-disable-line uppercase
    uint8 public constant decimals = 18; // solium-disable-line uppercase

    // no constructor, all tokens will be minted

    /**
     * @dev Burns a specific amount of tokens.
     * @param _burner Who to burn tokens from.
     * @param _value The amount of token to be burned.
     */
    function proxyBurn(address _burner, uint256 _value) public onlyOwner {
        require(_value <= balances[_burner], "LootToken::proxyBurn - amount to burn is greater than balance");
        // no need to require value <= totalSupply, since that would imply the
        // sender's balance is greater than the totalSupply, which *should* be an assertion failure

        balances[_burner] = balances[_burner].sub(_value);
        totalSupply_ = totalSupply_.sub(_value);
        emit Burn(_burner, _value);
    }
}