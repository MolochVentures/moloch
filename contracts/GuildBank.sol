pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';

contract GuildBank is Ownable {
  address[] public tokensHeld; // array of token contracts that are held by bank. any better way to do this?

  function addToken(address _tokenContractAddress) public onlyOwner {
    tokensHeld.push(_tokenContractAddress);
  }

  function() public payable {}
}