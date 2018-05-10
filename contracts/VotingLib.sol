pragma solidity 0.4.23;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./VotingShares.sol";

library VotingLib {
    using SafeMath for uint256;

    uint8 constant QUORUM_NUMERATOR = 1;
    uint8 constant QUORUM_DENOMINATOR = 2;

    struct Voter {
        bool voted;
        uint vote;
    }

    struct Ballot { 
        uint votingEndDate;
        uint minVotesRequired;
        mapping (address => Voter) voter;
        uint[] lineItems;
        VotingShares votingShares;
    }

    function initialize(
        Ballot storage self,
        uint8 numProposals,
        uint votingPeriodLength,
        VotingShares votingShares
    ) 
        public
    {
        // self.lineItems.length = numProposals; TODO: THIS DOESN'T WORK
        for (uint8 i = 0; i < numProposals; i++) {
            self.lineItems.push(0);
        }
        self.votingEndDate = block.timestamp + votingPeriodLength;
        uint256 totalVotingShares = votingShares.totalSupply();
        self.minVotesRequired = (totalVotingShares.mul(QUORUM_NUMERATOR)).div(QUORUM_DENOMINATOR);
        self.votingShares = votingShares;
    }

    function vote(Ballot storage _ballot, uint _lineItem) public {
        require(block.timestamp < _ballot.votingEndDate, "VotingLib::vote - voting ended");
        require(_ballot.voter[msg.sender].voted == false, "VotingLib::vote - voter already voted");
        require(_lineItem < _ballot.lineItems.length, "VotingLib::vote - illegal lineItem");
        require(_ballot.votingShares.balanceOf(msg.sender) > 0, "VotingLib::vote - voter has no votes");

        _ballot.voter[msg.sender].voted = true;
        _ballot.voter[msg.sender].vote = _lineItem;
        uint numOfVotingShares = _ballot.votingShares.balanceOf(msg.sender);

        _ballot.lineItems[_lineItem] += numOfVotingShares;
    }

    function getVoter(Ballot storage _ballot) public view {
        _ballot.voter[msg.sender];
    }

    function haveEnoughVoted(Ballot storage _ballot) public view returns (bool) {
        uint totalVotes = 0;
        for (uint i = 0; i < _ballot.lineItems.length; i++) {
            totalVotes += _ballot.lineItems[i];
        }
        return totalVotes > _ballot.minVotesRequired;
    }

    function voteEnded(Ballot storage _ballot) public view returns (bool) {
        return block.timestamp > _ballot.votingEndDate;
    }

    function canVote(Ballot storage _ballot) public view returns (bool) {
        return !voteEnded(_ballot);
    }

    function getLeadingProposal(Ballot storage _ballot) public view returns (uint) {
        uint leadingProposal = 0;
        uint leadingCount = 0;
        for (uint8 i = 0; i < _ballot.lineItems.length; i++) {
            if (_ballot.lineItems[i] > leadingCount) {
                leadingCount = _ballot.lineItems[i];
                leadingProposal = i;
            }
        }
        return leadingProposal;
    }

    function getWinningProposal(Ballot storage _ballot) public view returns (uint) {
        require(block.timestamp > _ballot.votingEndDate, "VotingLib::getWinningProposal - voting not ended");
        if (haveEnoughVoted(_ballot)) {
            return getLeadingProposal(_ballot);
        } else {
            return 0; // if no quorom, default to 0
        }
    }
}