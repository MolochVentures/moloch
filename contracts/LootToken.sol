pragma solidity ^0.4.18;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/token/ERC20/BurnableToken.sol';
import 'zeppelin-solidity/contracts/token/ERC20/MintableToken.sol';

contract LootToken is BurnableToken, MintableToken {
  uint256 totalSupply_;

  string public constant name = "LootToken"; // solium-disable-line uppercase
  string public constant symbol = "MLL"; // solium-disable-line uppercase
  uint8 public constant decimals = 18; // solium-disable-line uppercase

  // no constructor, all tokens will be minted
}