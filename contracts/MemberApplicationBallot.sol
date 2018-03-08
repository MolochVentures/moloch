pragma solidity ^0.4.18;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';

/**
    @title Membership Application Voting contract.
    @notice Creates simple voting structure for voting on membership applications.
    @dev This contract will be owned by the Moloch contract
 */
contract MemberApplicationBallot is Ownable {
    using SafeMath for uint256;

    /***********************************
    VARIABLES SET AT CONTRACT DEPLOYMENT
    ************************************/
    uint public voteCompletionTime;

    // VOTERSHIP REQUIREMENTS
    // require half the votes
    uint8 public fractionOfVotersRequiredNumerator = 1;
    uint8 public fractionOfVotersRequiredDenominator = 2;
    uint256 public numVotesRequired;

    // TODO: should we store candidate's address here

    /************
    VOTE TRACKING
    ************/

    // VOTER
    struct Voter {
        uint weight;
        bool voted;
        uint8 vote;
    }

    mapping (address => Voter) public voters;

    // BALLOT
    struct Proposal {
        uint256 voteCount;
    }

    Proposal[2] public ballot; // two proposals: 0 = against, 1 = for

    /// @notice Constructor sets vote parameters
    /// @param _totalNumberOfVoters Number of people who can vote
    function MemberApplicationBallot(
        uint256 _totalNumberOfVoters,
        uint256 _voteDurationInSeconds
    ) 
        public 
    {
        voteCompletionTime = now + _voteDurationInSeconds * 1 seconds;

        // numVoters * numerator / denominator, integer division
        numVotesRequired = (_totalNumberOfVoters.mul(fractionOfVotersRequiredNumerator)).div(fractionOfVotersRequiredDenominator);
    }

    /// @notice Gives user the right to vote
    /// @param _toVoterAddress Voter who should be given the right to vote
    function giveRightToVote(address _toVoterAddress) public onlyOwner {
        Voter storage voter = voters[_toVoterAddress];
        require(!voter.voted);

        // TODO: weighted by tokens
        voter.weight = 1;
    }

    /// @notice Vote for candidate
    /// @param _voterAddress Address of person who is voting
    /// @param _voteFor Boolean to vote in favor of candidate
    function vote(address _voterAddress, bool _voteFor) public {
        Voter storage voter = voters[_voterAddress];

        require(voter.voted = false);
        voter.voted = true;

        if (_voteFor) {
            ballot[1].voteCount += voter.weight;
        } else {
            ballot[0].voteCount += voter.weight;
        }
    }

    /// @notice Get voter attributes
    /// @param _voterAddress Voter address
    /// @return Voter attributes
    function getVoter(address _voterAddress) public view returns(uint, bool, uint8) {
        Voter memory voter = voters[_voterAddress];

        return (voter.weight, voter.voted, voter.vote);
    }

    /// @notice Check if enough people have voted
    /// @return True if enough people have voted, false otherwise
    function haveEnoughVoted() public view returns (bool) {
        uint256 totalVotes = ballot[0].voteCount + ballot[1].voteCount;
        return totalVotes > numVotesRequired;
    }

    /// @notice Check if vote duration period has elapsed
    /// @return True if vote time is complete
    function hasVoteDurationPeriodElapsed() public view returns (bool) {
        return now > voteCompletionTime;
    }

    /// @notice Check if candidate is accepted
    /// @dev Tie = not accepted
    /// @return True if candidate is accepted, false otherwise
    function isCandidateAccepted() public view returns (bool) {
        require(haveEnoughVoted());
        require(hasVoteDurationPeriodElapsed());

        uint256 votesFor = ballot[1].voteCount;
        uint256 votesAgainst = ballot[0].voteCount;
    
        if (votesFor > votesAgainst) {
            return true;
        } else {
            return false;
        }
    }
}

