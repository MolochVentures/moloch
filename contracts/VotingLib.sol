pragma solidity 0.4.21;

import "./Ownable.sol";
import "./SafeMath.sol";
import "./VotingShares.sol";

library VotingLib {
    using SafeMath for uint256;

    struct Voter {
        bool voted;
        uint vote;
    }

    struct Proposal {
        address proposalAddress;
        uint voteCount;
    }

    struct Ballot { 
        uint votingEndDate;
        uint minVotesRequired;
        mapping (address => Voter) voter;
        mapping (uint => Proposal) proposal;
        address votingSharesAddress;
        uint proposalCount;
    }

    function submitProposal(Ballot storage _ballot, address _proposalAddress) public {
        _ballot.proposalCount += 1;
        _ballot.proposal[_ballot.proposalCount].proposalAddress = _proposalAddress;
        _ballot.proposal[_ballot.proposalCount].voteCount = 0;
    }

    function vote(Ballot storage _ballot, uint _proposal) public {
        require(block.timestamp < _ballot.votingEndDate);
        require(_ballot.voter[msg.sender].voted == false);
        require(_ballot.proposal[_proposal].proposalAddress != 0);
        _ballot.voter[msg.sender].voted = true;
        _ballot.voter[msg.sender].vote = _proposal;
        uint numOfVotingShares = VotingShares(_ballot.votingSharesAddress).balanceOf(msg.sender);
        _ballot.proposal[_proposal].voteCount += numOfVotingShares;
    }

    function getVoter(Ballot storage _ballot) public view {
        _ballot.voter[msg.sender];
    }

    function haveEnoughVoted(Ballot storage _ballot) public view returns (bool) {
        uint totalVotes = 0;
        for (uint i=0; i < _ballot.proposalCount; i++) {
            totalVotes += _ballot.proposal[i].voteCount;
        }
        return totalVotes > _ballot.minVotesRequired;
    }

    function canVote(Ballot storage _ballot) public view returns (bool) {
        return _ballot.votingEndDate > block.timestamp;
    }

    function getLeadingProposal(Ballot storage _ballot) public view returns (uint) {
        uint leadingProposal = 0;
        uint leadingCount = 0;
        for (uint i=0; i < _ballot.proposalCount; i++) {
            if (_ballot.proposal[i].voteCount > leadingCount) {
                leadingCount = _ballot.proposal[i].voteCount;
                leadingProposal = i;
            }
        }
        return i;
    }

    function getWinningProposal(Ballot storage _ballot) public view returns (uint) {
        require(block.timestamp > _ballot.votingEndDate);
        require(haveEnoughVoted(_ballot));
        return getLeadingProposal(_ballot);
    }
}