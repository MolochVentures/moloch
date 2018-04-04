pragma solidity ^0.4.18;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "./VotingShares.sol";

/**
    @title Membership Application Voting contract.
    @notice Creates simple voting structure for voting on membership applications.
    @dev This contract will be owned by the Moloch contract
 */
contract Voting is Ownable {
    using SafeMath for uint256;

    /***********************************
    VARIABLES SET AT CONTRACT DEPLOYMENT
    ************************************/
    uint public votingPeriodEnds;
    VotingShares votingShares;

    // VOTERSHIP REQUIREMENTS
    // require half the votes
    uint8 public fractionOfVotersRequiredNumerator = 1;
    uint8 public fractionOfVotersRequiredDenominator = 2;
    uint256 public numVotesRequired; // number of voting shares required for valid vote

    /************
    VOTE TRACKING
    ************/

    // VOTER
    struct Voter {
        bool voted; // have they voted
        uint8 vote; // vote choice as item within proposal
    }

    mapping (address => Voter) public voters;

    // BALLOT
    struct Proposal {
        uint256 voteCount;
    }

    Proposal[] public proposals;

    /// @notice Constructor sets vote parameters
    /// @param _votingSharesAddress Address of voting shares contract
    /// @param _votingPeriodLengthInSeconds How long is the voting period open
    /// @param _numberOfProposals How many proposals on the ballot
    function Voting(
        address _votingSharesAddress,
        uint256 _votingPeriodLengthInSeconds,
        uint8 _numberOfProposals
    ) 
        public 
    {
        votingShares = VotingShares(_votingSharesAddress);
        votingPeriodEnds = now + _votingPeriodLengthInSeconds * 1 seconds;
        uint256 totalVotingShares = votingShares.totalSupply();

        // numVoters * numerator / denominator, integer division
        numVotesRequired = (totalVotingShares.mul(fractionOfVotersRequiredNumerator)).div(fractionOfVotersRequiredDenominator);

        proposals.length = _numberOfProposals;
    }

    /// @notice Vote for candidate, number of voting shares = number of votes
    /// @param _voterAddress Address of person who is voting
    /// @param _toProposal Which proposal to vote on
    function vote(address _voterAddress, uint8 _toProposal) public {
        require(now < votingPeriodEnds); // vote is still open

        Voter storage voter = voters[_voterAddress];

        require(voter.voted == false);
        voter.voted = true;
        voter.vote = _toProposal;

        // votes = number of voting shares
        uint256 shares = votingShares.balanceOf(_voterAddress);
        proposals[_toProposal].voteCount += shares;
    }

    /// @notice Get voter attributes
    /// @param _voterAddress Voter address
    /// @return Voter attributes
    function getVoter(address _voterAddress) public view returns(bool, uint8) {
        Voter memory voter = voters[_voterAddress];

        return (voter.voted, voter.vote);
    }

    /// @notice Check if enough people have voted
    /// @return True if enough people have voted, false otherwise
    function haveEnoughVoted() public view returns (bool) {
        uint256 totalNumberOfVotes = 0;
        for (uint8 i = 0; i < proposals.length; i++) {
            totalNumberOfVotes += proposals[i].voteCount;
        }
        return totalNumberOfVotes > numVotesRequired;
    }

    /// @notice Check if vote duration period has elapsed
    /// @return True if vote time is complete
    function hasVoteDurationPeriodElapsed() public view returns (bool) {
        return now > votingPeriodEnds;
    }

    /// @notice Get the proposal that is currently leading the vote
    /// @dev Tie = leading proposal set to later index in the array
    /// @return uint8 of index in array
    function getLeadingProposal() public view returns (uint8) {
        uint8 winningProposal;
        uint256 winningVoteCount = 0;
        for (uint8 i = 0; i < proposals.length; i++) {
            if (proposals[i].voteCount > winningVoteCount) {
                winningVoteCount = proposals[i].voteCount;
                winningProposal = i;
            }
        }
        return winningProposal;
    }

    /// @notice Get the proposal that won, assuming the vote period is complete
    /// and enough votes have been cast
    /// @return uint8 of index in array
    function getWinnerProposal() public view returns (uint8) {
        require(hasVoteDurationPeriodElapsed());

        // if no quorom, proposal does not pass
        if (haveEnoughVoted()) {
            return getLeadingProposal();
        } else {
            // 0 = proposal loses
            return 0;
        }
    }
}

