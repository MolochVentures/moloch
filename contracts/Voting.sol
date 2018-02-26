pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';

contract Voting is Ownable {

  struct Voter {
    uint weight;
    bool voted;
    uint8 vote;
    address delegate;
  }
  struct Proposal {
    uint voteCount;
  }

  address chairperson;
  mapping(address => Voter) public voters;
  Proposal[] proposals;

  event Vote(uint8 toProposal, address voter, uint weight);

  /// Create a new ballot with $(_numProposals) different proposals.
  function Voting(uint8 _numProposals) public {
    chairperson = msg.sender;
    voters[chairperson].weight = 1;
    proposals.length = _numProposals;
  }

  function getVoter(address _voter) public view returns(uint, bool, uint8, address) {
    Voter memory voter = voters[_voter];
    return (voter.weight, voter.voted, voter.vote, voter.delegate);
  }

  /// Give $(toVoter) the right to vote on this ballot.
  /// May only be called by $(chairperson).
  function giveRightToVote(address toVoter) public {
    require(msg.sender == chairperson && !voters[toVoter].voted);

    voters[toVoter].weight = 1;
  }

  /// Delegate your vote to the voter $(to).
  function delegate(address to) public {
    Voter storage sender = voters[msg.sender]; // assigns reference

    require(!sender.voted);

    while (voters[to].delegate != address(0) && voters[to].delegate != msg.sender) {
      to = voters[to].delegate;
    }

    require(to != msg.sender);

    sender.voted = true;
    sender.delegate = to;
    Voter storage delegateTo = voters[to];

    if (delegateTo.voted) {
      proposals[delegateTo.vote].voteCount += sender.weight;
    } else {
      delegateTo.weight += sender.weight;
    }
  }

  /// Give a single vote to proposal $(toProposal).
  function vote(uint8 toProposal) public {
    Voter storage sender = voters[msg.sender];
    require(!sender.voted && toProposal < proposals.length);
    
    sender.voted = true;
    sender.vote = toProposal;
    proposals[toProposal].voteCount += sender.weight;
    
    Vote(toProposal, msg.sender, sender.weight);
  }

  function proxyVote(address voter, uint8 toProposal) public onlyOwner {
    Voter storage sender = voters[voter];
    require(!sender.voted && toProposal < proposals.length);
    
    sender.voted = true;
    sender.vote = toProposal;
    proposals[toProposal].voteCount += sender.weight;
    
    Vote(toProposal, voter, sender.weight);
  }

  function hasVoted(address _voter) public view returns (bool) {
    return voters[_voter].voted;
  }

  function winningProposal() public constant returns (uint8 _winningProposal) {
    uint256 winningVoteCount = 0;
    for (uint8 prop = 0; prop < proposals.length; prop++) {
      if (proposals[prop].voteCount > winningVoteCount) {
          winningVoteCount = proposals[prop].voteCount;
          _winningProposal = prop;
      }
    }
    // what about tie
  }
}