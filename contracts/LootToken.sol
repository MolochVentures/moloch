pragma solidity 0.4.21;

import './Ownable.sol';
import './BurnableToken.sol';
import './MintableToken.sol';

contract LootToken is BurnableToken, MintableToken {
  uint256 totalSupply_;

  string public constant name = "LootToken"; // solium-disable-line uppercase
  string public constant symbol = "MLL"; // solium-disable-line uppercase
  uint8 public constant decimals = 18; // solium-disable-line uppercase

  // no constructor, all tokens will be minted
}