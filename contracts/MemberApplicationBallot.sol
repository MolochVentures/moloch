pragma solidity ^0.4.18;

import './Voting.sol';
import 'zeppelin-solidity/contracts/ownership/Ownable.sol';

contract MemberApplicationBallot is Ownable, Voting {
  address[] public requiredVoters;

  // standard ballot with 2 proposals
  // proposal 0 is against, 1 is for
  function MemberApplicationBallot(address[] _requiredVoters) Voting(2) public {
    requiredVoters = _requiredVoters;
    // give right to vote for all provided voters
    for (uint8 i = 0; i < _requiredVoters.length; i++) {
      giveRightToVote(_requiredVoters[i]);
    }
  }

  // must be onlyOwner since contract will be owned by moloch contract
  function voteAgainst(address voter) public onlyOwner {
    proxyVote(voter, 0);
  }

  function voteFor(address voter) public onlyOwner {
    proxyVote(voter, 1);
  }

  function howManyVoters() public view returns (uint) {
    return requiredVoters.length;
  }

  function hasEveryoneVoted() public view returns (bool) {
    bool yes = true;
    for (uint8 i = 0; i < requiredVoters.length; i++) {
      yes = yes && hasVoted(requiredVoters[i]);
    }

    return yes;
  }

  function isAccepted() public view returns (bool) {
    require(this.hasEveryoneVoted());
    uint8 winner = winningProposal();

    if (winner == 0) {
      return false;
    } else if (winner == 1) {
      return true;
    } else {
      // cant get here
      assert(false);
    }
  }
}

