pragma solidity ^0.4.0;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "./Voting.sol";
import "./VotingShares.sol";
import "./Moloch.sol";

contract TownHall is Ownable {
    /*****
    EVENTS
    *****/
    event ProposalCreated(
        address indexed proposer,
        uint256 votingSharesRequested,
        ProposalTypes proposalType,
        address ballotAddress
    );

    event ProposalVoteCompleted(
        address indexed proposer,
        uint256 votingSharesRequested,
        ProposalTypes proposalType,
        address ballotAddress,
        uint8 winningBallotItem
    );

    /********
    CONSTANTS
    ********/
    uint PROPOSAL_VOTE_TIME_SECONDS = 5;

    /******************
    CONTRACT REFERENCES
    ******************/
    Voting public voting;
    VotingShares public votingShares;
    Moloch public moloch;

    /******************
    PROPOSAL DEFINITION
    ******************/
    enum ProposalTypes {
        Membership,
        Project
    }

    struct Proposal {
        address proposer; // who proposed this
        address ballotAddress; // proposal voting ballot
        bytes32 ipfsHash; // information about proposal
        ProposalTypes proposalType; // type
        uint256 votingSharesRequested; // num voting shares requested
    }

    Proposal[] proposals; // proposal queue

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember() {
        require(moloch.isMemberApproved(msg.sender) == true);
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/
    function TownHall() public {

    }

    /*******************************
    SET CONTRACT REFERENCE FUNCTIONS
    *******************************/
    function setVoting(address _votingAddress) public onlyOwner {
        voting = Voting(_votingAddress);
    }

    function setVotingShares(address _votingSharesAddress) public onlyOwner {
        votingShares = VotingShares(_votingSharesAddress);
    }

    function setMoloch(address _molochAddress) public onlyOwner {
        moloch = Moloch(_molochAddress);
    }

    function createProposal(bytes32 _ipfsHash, uint256 _votingSharesRequested, ProposalTypes _proposalType) onlyApprovedMember public {
        // TODO payable?
        // create proposal with ballot
        Proposal memory proposal;
        Voting ballotAddress = new Voting(votingShares, PROPOSAL_VOTE_TIME_SECONDS, 2); // only win or lose?
        proposal.ballotAddress = ballotAddress;
        proposal.ipfsHash = _ipfsHash;
        proposal.proposalType = _proposalType;

        // append to proposal queue
        proposals.length += 1;
        proposals[proposals.length] = proposal;

        ProposalCreated(msg.sender, _votingSharesRequested, _proposalType, ballotAddress);
    }

    function voteOnCurrentProposal(uint8 _toBallotItem) onlyApprovedMember public {
        Proposal memory proposal = getCurrentProposal();
        Voting ballot = Voting(proposal.ballotAddress);
        ballot.vote(msg.sender, _toBallotItem);
    }

    function completeProposalVote() onlyApprovedMember public {
        Proposal memory proposal = getCurrentProposal();
        Voting ballot = Voting(proposal.ballotAddress);
        uint8 winningBallotItem = ballot.getWinnerProposal();

        if (winningBallotItem == 1) {
            votingShares.mint(proposal.proposer, proposal.votingSharesRequested);
        } else if (winningBallotItem == 0) {
            // proposal loses
        }
        ProposalVoteCompleted(
            proposal.proposer,
            proposal.votingSharesRequested,
            proposal.proposalType,
            proposal.ballotAddress,
            winningBallotItem
        );
    }

    function getCurrentProposal() public view returns(Proposal) {
        Proposal memory proposal = proposals[0]; // first proposal is current proposal
        return(proposal);
    }

    function getCurrentProposalDetails() public view returns(address, bytes32, ProposalTypes) {
        Proposal memory proposal = proposals[0]; // first proposal is current proposal
        return(
            proposal.ballotAddress,
            proposal.ipfsHash,
            proposal.proposalType
        );
    }
}