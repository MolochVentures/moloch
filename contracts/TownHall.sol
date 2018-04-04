pragma solidity ^0.4.0;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "./Voting.sol";
import "./VotingShares.sol";
import "./Moloch.sol";
import "./GuildBank.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";

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
    uint constant PROPOSAL_VOTE_TIME_SECONDS = 5;
    uint constant GRACE_PERIOD_SECONDS = 5;
    uint constant MIN_PROPOSAL_CREATION_DEPOSIT = 10 ether;
    uint constant LOSING_PROPOSAL_INDEX = 0;
    uint constant WINNING_PROPOSAL_INDEX = 1;

    /******************
    CONTRACT REFERENCES
    ******************/
    Voting public voting;
    VotingShares public votingShares;
    Moloch public moloch;
    GuildBank public guildBank;

    /******************
    PROPOSAL DEFINITION
    ******************/
    enum ProposalTypes {
        Membership,
        Project
    }

    enum ProposalPhase {
        Proposed,
        Voting,
        GracePeriod,
        Done
    }

    struct ProspectiveMember {
        address prospectiveMemberAddress; 
        uint256 ethTributeAmount; // eth tribute
        address[] tokenTributeAddresses; // array of token tributes
        uint256[] tokenTributeAmounts; // array of token tributes
        address ballotAddress; // ballot for voting on membership
    }

    struct ProspectiveProject {
        bytes32 ipfsHash; // information about proposal
        uint256 deposit; // deposit given
    }

    struct Proposal {
        // COMMON ATTRIBUTES
        address proposer; // who proposed this
        address ballotAddress; // proposal voting ballot
        ProposalTypes proposalType; // type
        uint256 votingSharesRequested; // num voting shares requested
        ProposalPhase phase; // phase
        uint gracePeriodStartTime; // when did grace period start

        // PROJECT SPECIFIC ATTRIBUTES
        ProspectiveProject prospectiveProject;

        // MEMBER SPECIFIC ATTRIBUTES
        ProspectiveMember prospectiveMember;
    }

    Proposal[] proposals; // proposal queue
    uint currentProposalIndex = 0; // track proposals

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

    function setGuildBank(address _guildBankAddress) public onlyOwner {
        guildBank = GuildBank(_guildBankAddress);
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    function createMemberProposal(
        address _propospectiveMemberAddress,
        address[] _tokenContractTributeAddresses, 
        uint256[] _tokenTributeAmounts,
        uint256 _votingSharesRequested
    )
        onlyApprovedMember
        public
        payable
    {
        // require tribute
        require(msg.value > 0 || _tokenContractTributeAddresses.length > 0);

        // set up proposal
        Proposal memory membershipProposal;

        // from inputs
        membershipProposal.votingSharesRequested = _votingSharesRequested;
        membershipProposal.prospectiveMember.tokenTributeAddresses = _tokenContractAddresses;
        membershipProposal.prospectiveMember.tokenTributeAmounts = _tokenTributeAmounts;

        // attributes
        membershipProposal.proposalType = ProposalTypes.Membership;
        proposal.phase = ProposalPhase.Proposed;

        // collect eth tribute
        if (msg.value > 0) {
            membershipProposal.prospectiveMember.ethTributeAmount = msg.value;
        }

        // collect token tribute
        for(uint8 i = 0; i < _tokenContractTributeAddresses.length; i++) {
            require(_tokenTributeAmounts[i] > 0); // need non zero amounts
            ERC20 erc20 = ERC20(_tokenContractTributeAddresses[i]);

            // transfer tokens to this contract as tribute
            // approval must be granted prior to this step
            require(erc20.transferFrom(msg.sender, this, _tokenTributeAmounts[i]));
        }

        // push to end of proposal queue
        proposals.push(proposal);

        ProposalCreated(msg.sender, _votingSharesRequested, _proposalType, ballotAddress);
    }

    function createProjectProposal(
        bytes32 _ipfsHash,
        uint256 _votingSharesRequested
    ) 
        onlyApprovedMember 
        public
        payable
    {
        // require min deposit
        require(msg.value == MIN_PROPOSAL_CREATION_DEPOSIT);

        // set up proposal
        Proposal memory proposal;

        // from inputs
        proposal.prospectiveProject.ipfsHash = _ipfsHash;
        proposal.prospectiveProject.deposit = msg.value;

        // attributes
        proposal.proposalType = ProposalTypes.Project;
        proposal.phase = ProposalPhase.Proposed;

        // push to end of proposal queue
        proposals.push(proposal);

        ProposalCreated(msg.sender, _votingSharesRequested, _proposalType, ballotAddress);
    }

    function startProposalVote() onlyApprovedMember public {
        // make sure previous proposal vote is completed
        if (currentProposalIndex > 0) {
            // take care of initial case
            Proposal memory lastProposal = proposals[currentProposalIndex - 1];
            require(lastProposal.phase == ProposalPhase.Done); // past voting and grace period
        }

        Proposal storage currentProposal = proposals[currentProposalIndex];

        // create ballot
        Voting ballotAddress = new Voting(votingShares, PROPOSAL_VOTE_TIME_SECONDS, 2);
        currentProposal.ballotAddress = ballotAddress;

        // change phase
        currentProposal.phase = ProposalPhase.Voting;
    }

    function voteOnCurrentProposal(uint8 _toBallotItem) onlyApprovedMember public {
        Proposal memory currentProposal = getCurrentProposal();
        require(currentProposal.phase == ProposalPhase.Voting);

        Voting ballot = Voting(currentProposal.ballotAddress);
        ballot.vote(msg.sender, _toBallotItem);
    }

    function transitionProposalToGracePeriod() onlyApprovedMember public {
        Proposal storage currentProposal = getCurrentProposal();
        require(currentProposal.phase == ProposalPhase.Voting);

        // get winner from ballot
        Voting ballot = Voting(currentProposal.ballotAddress);
        uint8 winningBallotItem = ballot.getWinnerProposal();

        if (winningBallotItem == WINNING_PROPOSAL_INDEX) {
            // transfer deposit back to proposer
            currentProposal.proposer.transfer(currentProposal.deposit);

        } else if (winningBallotItem == LOSING_PROPOSAL_INDEX) {
            // proposal loses, burn eth
            address(0).transfer(currentProposal.deposit);

            // TODO do we need grace period in this case?
        }

        // transition state to grace period
        currentProposal.phase = ProposalPhase.GracePeriod;
        currentProposal.gracePeriodStartTime = now;

        ProposalVoteCompleted(
            proposal.proposer,
            proposal.votingSharesRequested,
            proposal.proposalType,
            proposal.ballotAddress,
            winningBallotItem
        );
    }

    function finishProposal() public onlyApprovedMember {
        Proposal storage currentProposal = proposals[currentProposalIndex];

        // require grace period elapsed
        require(currentProposal.phase == ProposalPhase.GracePeriod);
        require(now > currentProposal.gracePeriodStartTime + GRACE_PERIOD_SECONDS);

        // get winner from ballot
        Voting ballot = Voting(currentProposal.ballotAddress);
        uint8 winningBallotItem = ballot.getWinnerProposal();

        if (winningBallotItem == WINNING_PROPOSAL_INDEX) {
            if (currentProposal.proposalType == ProposalTypes.Membership) {
                // add member here
                // collect tributes into bank
                // collect eth tribute
                if (currentProposal.prospectiveMember.ethTributeAmount > 0) {
                    address(guildBank).transfer(currentProposal.prospectiveMember.ethTributeAmount, msg.value);
                }

                // collect token tribute
                for(uint8 i = 0; i < _tokenContractTributeAddresses.length; i++) {
                    require(_tokenTributeAmounts[i] > 0); // need non zero amounts
                    ERC20 erc20 = ERC20(currentProposal.prospectiveMember.tokenContractTributeAddresses[i]);

                    require(erc20.transfer(address(guildBank), this, currentProposal.prospectiveMember.tokenTributeAmounts[i]));
                }

                // add to moloch members
                moloch.addMember(
                    currentProposal.prospectiveMember.prospectiveMemberAddress,
                    currentProposal.prospectiveMember.ethTributeAmount,
                    currentProposal.prospectiveMember.tokenTributeAddresses, 
                    currentProposal.prospectiveMember.tokenTributeAmounts
                );
            } else if (currentProposal.proposalType == ProposalTypes.Project) {
                // dilute
                votingShares.mint(currentProposal.proposer, currentProposal.votingSharesRequested);

                // mint loot tokens 1:1 and keep them in moloch contract for withdrawal
                lootToken.mint(address(moloch), currentProposal.votingSharesRequested);
            }
        }

        // close out and move on to next proposal
        currentProposal.phase = ProposalPhase.Done;
        currentProposalIndex++;
    }

    function getCurrentProposal() public view returns(Proposal) {
        Proposal memory proposal = proposals[proposals.length]; // last proposal is current proposal
        return(proposal);
    }

    function getCurrentProposalDetails() public view returns(address, bytes32, ProposalTypes) {
        Proposal memory proposal = getCurrentProposal();
        return(
            proposal.ballotAddress,
            proposal.ipfsHash,
            proposal.proposalType
        );
    }
}