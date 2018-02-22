pragma solidity ^0.4.18;

import './Voting.sol';

contract MemberApplicationBallot is Voting {
  address[] requiredVoters;

  // standard ballot with 2 proposals
  // proposal 0 is against, 1 is for
  function MemberApplicationBallot(address[] _requiredVoters) Voting(2) public {
    requiredVoters = _requiredVoters;
    // give right to vote for all provided voters
    for (uint8 i = 0; i < _requiredVoters.length; i++) {
      super.giveRightToVote(_requiredVoters[i]);
    }
  }

  function voteAgainst() public {
    super.vote(0);
  }

  function voteFor() public {
    super.vote(1);
  }

  function hasEveryoneVoted() public view returns (bool) {
    bool yes = true;
    for (uint8 i = 0; i < requiredVoters.length; i++) {
      yes = yes && super.hasVoted(requiredVoters[i]);
    }

    return yes;
  }

  function isAccepted() public view returns (bool) {
    require(this.hasEveryoneVoted());
    uint8 winner = super.winningProposal();

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

