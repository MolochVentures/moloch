pragma solidity ^0.4.18;

import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/token/ERC20/BurnableToken.sol';
import 'zeppelin-solidity/contracts/token/ERC20/MintableToken.sol';

/**
 * almost like a basic token, but not transferrable by normal people
 */
contract VotingShares is MintableToken {
  using SafeMath for uint256;

  string public constant name = "VotingShares"; // solium-disable-line uppercase
  string public constant symbol = "MLV"; // solium-disable-line uppercase
  uint8 public constant decimals = 18; // solium-disable-line uppercase

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Burn(address indexed burner, uint256 value);

  /**
  * override transfer function to be only owner
  */
  function transfer(address _to, uint256 _value) public onlyOwner returns (bool) {
    require(_to != address(0));
    require(_value <= balances[msg.sender]);

    // SafeMath.sub will throw if there is not enough balance.
    balances[msg.sender] = balances[msg.sender].sub(_value);
    balances[_to] = balances[_to].add(_value);
    Transfer(msg.sender, _to, _value);
    return true;
  }

  /**
   * @dev Burns a specific amount of tokens.
   * @param _value The amount of token to be burned.
   */
  function proxyBurn(address _burner, uint256 _value) public onlyOwner {
    require(_value <= balances[_burner]);
    // no need to require value <= totalSupply, since that would imply the
    // sender's balance is greater than the totalSupply, which *should* be an assertion failure

    balances[_burner] = balances[_burner].sub(_value);
    totalSupply_ = totalSupply_.sub(_value);
    Burn(_burner, _value);
  }
}