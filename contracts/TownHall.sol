pragma solidity ^0.4.0;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "./Voting.sol";
import "./VotingShares.sol";
import "./Moloch.sol";
import "./GuildBank.sol";
import "./LootToken.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract TownHall is Ownable {
    /*****
    EVENTS
    *****/
    event ProposalCreated(
        address indexed proposer,
        uint256 votingSharesRequested,
        ProposalTypes proposalType,
        uint indexInProposalQueue
    );

    event ProposalVotingStarted(
        uint indexed indexInProposalQueue
    );

    event ProposalGracePeriodStarted(
        uint indexed indexInProposalQueue
    );

    event ProposalCompleted(
        uint indexed indexInProposalQueue,
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
    VotingShares public votingShares;
    Moloch public moloch;
    GuildBank public guildBank;
    LootToken public lootToken;

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
        // COMMON PROPOSAL ATTRIBUTES
        address proposer; // who proposed this
        ProposalTypes proposalType; // type
        uint256 votingSharesRequested; // num voting shares requested

        // PROJECT SPECIFIC ATTRIBUTES
        ProspectiveProject prospectiveProject;

        // MEMBER SPECIFIC ATTRIBUTES
        ProspectiveMember prospectiveMember;

        // BOOKKEEPING
        Voting ballot; // proposal voting ballot
        ProposalPhase phase; // phase
        uint gracePeriodStartTime; // when did grace period start
    }

    Proposal[] proposals; // proposal queue
    uint currentProposalIndex = 0; // track proposals

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember() {
        require(moloch.members(msg.sender) == true);
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
    function setVotingShares(address _votingSharesAddress) public onlyOwner {
        votingShares = VotingShares(_votingSharesAddress);
    }

    function setMoloch(address _molochAddress) public onlyOwner {
        moloch = Moloch(_molochAddress);
    }

    function setGuildBank(address _guildBankAddress) public onlyOwner {
        guildBank = GuildBank(_guildBankAddress);
    }

    function setLootToken(address _lootTokenAddress) public onlyOwner {
        lootToken = LootToken(_lootTokenAddress);
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    function createMemberProposal(
        address _propospectiveMemberAddress,
        address[] _tokenTributeAddresses, 
        uint256[] _tokenTributeAmounts,
        uint256 _votingSharesRequested
    )
        onlyApprovedMember
        public
        payable
    {
        // require tribute
        require((msg.value > 0) || (_tokenTributeAddresses.length > 0));

        // TODO DO WE NEED MIN DEPOSIT HERE?

        // set up proposal
        Proposal memory membershipProposal;

        // from inputs
        membershipProposal.votingSharesRequested = _votingSharesRequested;
        membershipProposal.prospectiveMember.prospectiveMemberAddress = _propospectiveMemberAddress;
        membershipProposal.prospectiveMember.tokenTributeAddresses = _tokenTributeAddresses;
        membershipProposal.prospectiveMember.tokenTributeAmounts = _tokenTributeAmounts;

        // attributes
        membershipProposal.proposalType = ProposalTypes.Membership;
        membershipProposal.phase = ProposalPhase.Proposed;

        // collect eth tribute
        if (msg.value > 0) {
            membershipProposal.prospectiveMember.ethTributeAmount = msg.value;
        }

        // collect token tribute
        for(uint8 i = 0; i < membershipProposal.prospectiveMember.tokenTributeAddresses.length; i++) {
            require(membershipProposal.prospectiveMember.tokenTributeAmounts[i] > 0); // need non zero amounts
            ERC20 erc20 = ERC20(membershipProposal.prospectiveMember.tokenTributeAddresses[i]);

            // transfer tokens to this contract as tribute
            // approval must be granted prior to this step
            require(erc20.transferFrom(msg.sender, this, _tokenTributeAmounts[i]));
        }

        // push to end of proposal queue
        proposals.push(membershipProposal);

        ProposalCreated(msg.sender, _votingSharesRequested, ProposalTypes.Membership, proposals.length);
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
        Proposal memory projectProposal;

        // from inputs
        projectProposal.prospectiveProject.ipfsHash = _ipfsHash;
        projectProposal.prospectiveProject.deposit = msg.value;

        // attributes
        projectProposal.proposalType = ProposalTypes.Project;
        projectProposal.phase = ProposalPhase.Proposed;

        // push to end of proposal queue
        proposals.push(projectProposal);

        ProposalCreated(msg.sender, _votingSharesRequested, ProposalTypes.Project, proposals.length);
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
        Voting ballot = new Voting(votingShares, PROPOSAL_VOTE_TIME_SECONDS, 2);
        currentProposal.ballot = ballot;

        // change phase
        currentProposal.phase = ProposalPhase.Voting;
        
        ProposalVotingStarted(currentProposalIndex);
    }

    function voteOnCurrentProposal(uint8 _toBallotItem) onlyApprovedMember public {
        Proposal memory currentProposal = proposals[currentProposalIndex];
        require(currentProposal.phase == ProposalPhase.Voting);

        currentProposal.ballot.vote(msg.sender, _toBallotItem);
    }

    function transitionProposalToGracePeriod() onlyApprovedMember public {
        Proposal storage currentProposal = proposals[currentProposalIndex];
        require(currentProposal.phase == ProposalPhase.Voting);

        // require vote time completed
        require(currentProposal.ballot.hasVoteDurationPeriodElapsed());

        // transition state to grace period
        currentProposal.phase = ProposalPhase.GracePeriod;
        currentProposal.gracePeriodStartTime = now;

        ProposalGracePeriodStarted(currentProposalIndex);
    }

    function finishProposal() public onlyApprovedMember {
        Proposal storage currentProposal = proposals[currentProposalIndex];

        // require grace period elapsed
        require(currentProposal.phase == ProposalPhase.GracePeriod);
        require(now > currentProposal.gracePeriodStartTime + GRACE_PERIOD_SECONDS);

        // get winner from ballot
        uint8 winningBallotItem = currentProposal.ballot.getWinnerProposal();

        if (winningBallotItem == WINNING_PROPOSAL_INDEX) {
            if (currentProposal.proposalType == ProposalTypes.Membership) {
                // add member here
                _acceptMemberProposal(currentProposal);
            } else if (currentProposal.proposalType == ProposalTypes.Project) {
                // accept proposal
                _acceptProjectProposal(currentProposal);
            }
        } else if (winningBallotItem == LOSING_PROPOSAL_INDEX) {
            // proposal loses, burn eth
            address(0).transfer(currentProposal.prospectiveProject.deposit);
        }

        ProposalCompleted(currentProposalIndex, winningBallotItem);

        // close out and move on to next proposal
        currentProposal.phase = ProposalPhase.Done;
        currentProposalIndex++;
    }

    function addFoundingMember(address _memberAddress, uint256 _votingShares) public onlyOwner {
        // add to moloch members
        moloch.addMember(_memberAddress);

        // dilute and grant to new member
        votingShares.mint(_memberAddress, _votingShares);

        // mint loot tokens 1:1 and keep them in moloch contract for withdrawal
        lootToken.mint(address(moloch), _votingShares);
    }

    function getCurrentProposalCommonDetails() public view returns (
        address,
        ProposalTypes,
        uint256,
        Voting,
        ProposalPhase,
        uint
    ) {
        Proposal memory proposal = proposals[currentProposalIndex];
        return(
            proposal.proposer,
            proposal.proposalType,
            proposal.votingSharesRequested,
            proposal.ballot,
            proposal.phase,
            proposal.gracePeriodStartTime
        );
    }

    function getCurrentProposalProjectDetails() public view returns (bytes32, uint256) {
        Proposal memory proposal = proposals[currentProposalIndex];
        return(proposal.prospectiveProject.ipfsHash, proposal.prospectiveProject.deposit);
    }

    function getCurrentProposalMemberDetails() public view returns (
        address, 
        uint256, 
        address[], 
        uint256[], 
        address
    ) {
        Proposal memory proposal = proposals[currentProposalIndex];
        return(
            proposal.prospectiveMember.prospectiveMemberAddress,
            proposal.prospectiveMember.ethTributeAmount,
            proposal.prospectiveMember.tokenTributeAddresses,
            proposal.prospectiveMember.tokenTributeAmounts,
            proposal.prospectiveMember.ballotAddress
        );
    }

    function _acceptMemberProposal(Proposal memberProposal) internal {
        // collect tributes into bank
        // collect eth tribute
        if (memberProposal.prospectiveMember.ethTributeAmount > 0) {
            address(guildBank).transfer(memberProposal.prospectiveMember.ethTributeAmount);
        }

        // collect token tribute
        for(uint8 i = 0; i < memberProposal.prospectiveMember.tokenTributeAddresses.length; i++) {
            ERC20 erc20 = ERC20(memberProposal.prospectiveMember.tokenTributeAddresses[i]);
            require(erc20.transfer(address(guildBank), memberProposal.prospectiveMember.tokenTributeAmounts[i]));
        }

        // add to moloch members
        moloch.addMember(
            memberProposal.prospectiveMember.prospectiveMemberAddress
        );

        // dilute and grant to new member
        votingShares.mint(
            memberProposal.prospectiveMember.prospectiveMemberAddress,
            memberProposal.votingSharesRequested
        );

        // mint loot tokens 1:1 and keep them in moloch contract for withdrawal
        lootToken.mint(address(moloch), memberProposal.votingSharesRequested);
    }

    function _acceptProjectProposal(Proposal projectProposal) internal {
        // dilute
        votingShares.mint(projectProposal.proposer, projectProposal.votingSharesRequested);

        // mint loot tokens 1:1 and keep them in moloch contract for withdrawal
        lootToken.mint(address(moloch), projectProposal.votingSharesRequested);

        // transfer deposit back to proposer
        projectProposal.proposer.transfer(projectProposal.prospectiveProject.deposit);
    }
}