pragma solidity ^0.4.18;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import './VotingShares.sol';

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
    uint public voteCompletionTime;
    VotingShares votingShares;

    // VOTERSHIP REQUIREMENTS
    // require half the votes
    uint8 public fractionOfVotersRequiredNumerator = 1;
    uint8 public fractionOfVotersRequiredDenominator = 2;
    uint256 public numVotesRequired;

    /************
    VOTE TRACKING
    ************/

    // VOTER
    struct Voter {
        bool allowedToVote;
        bool voted;
        uint8 vote;
    }

    mapping (address => Voter) public voters;
    uint256 numberOfVoted = 0;

    // BALLOT
    struct Proposal {
        uint256 voteCount;
    }

    Proposal[] public proposals; // two proposals: 0 = against, 1 = for

    /// @notice Constructor sets vote parameters
    /// @param _totalNumberOfVoters Number of people who can vote
    /// @param _voteDurationInSeconds How long does vote have to last at minimum
    /// @param _numberOfProposals How many proposals on the ballot
    function Voting(
        uint256 _totalNumberOfVoters,
        uint256 _voteDurationInSeconds,
        uint8 _numberOfProposals
    ) 
        public 
    {
        voteCompletionTime = now + _voteDurationInSeconds * 1 seconds;

        // numVoters * numerator / denominator, integer division
        numVotesRequired = (_totalNumberOfVoters.mul(fractionOfVotersRequiredNumerator)).div(fractionOfVotersRequiredDenominator);

        proposals.length = _numberOfProposals;
    }

    /// @notice Gives user the right to vote
    /// @param _toVoterAddress Voter who should be given the right to vote
    function giveRightToVote(address _toVoterAddress) public onlyOwner {
        Voter storage voter = voters[_toVoterAddress];
        require(!voter.voted);

        voter.allowedToVote = true;
    }

    /// @notice Vote for candidate, number of voting shares = number of votes
    /// @param _voterAddress Address of person who is voting
    /// @param _toProposal Which proposal to vote on
    function vote(address _voterAddress, uint8 _toProposal) public {
        Voter storage voter = voters[_voterAddress];

        require(voter.voted = false);
        voter.voted = true;

        // votes = number of voting shares
        uint256 shares = votingShares.balanceOf(_voterAddress);
        proposals[_toProposal].voteCount += shares;
        numberOfVoted++;
    }

    /// @notice Get voter attributes
    /// @param _voterAddress Voter address
    /// @return Voter attributes
    function getVoter(address _voterAddress) public view returns(bool, bool, uint8) {
        Voter memory voter = voters[_voterAddress];

        return (voter.allowedToVote, voter.voted, voter.vote);
    }

    /// @notice Check if enough people have voted
    /// @return True if enough people have voted, false otherwise
    function haveEnoughVoted() public view returns (bool) {
        return numberOfVoted > numVotesRequired;
    }

    /// @notice Check if vote duration period has elapsed
    /// @return True if vote time is complete
    function hasVoteDurationPeriodElapsed() public view returns (bool) {
        return now > voteCompletionTime;
    }

    /// @notice Check if candidate is accepted
    /// @dev Tie = not accepted
    /// @return True if candidate is accepted, false otherwise
    function getWinningProposal() public view returns (uint8) {
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

    function endOfVoteWinner() public view returns (uint8) {
        require(haveEnoughVoted());
        require(hasVoteDurationPeriodElapsed());
        return getWinningProposal();
    }
}

