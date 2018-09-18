pragma solidity 0.4.24;

import "./oz/Ownable.sol";
import "./oz/SafeMath.sol";
import "./oz/ERC20.sol";
import "./VotingShares.sol";
import "./GuildBank.sol";
import "./LootToken.sol";
import "./TownHallLib.sol";

/**
    @title Moloch DAO contract
    @notice Overseer contract for all Moloch functions, including membership, application, voting, and exiting
    @dev Owner should be a multisig wallet
 */
contract Moloch is Ownable {
    using SafeMath for uint256;

    /*****
    EVENTS
    *****/
    event MemberAccepted(
        address indexed memberAddress
    );

    event MemberExit(
        address indexed memberAddress
    );

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
        uint winningBallotItem
    );

    /******************
    CONTRACT REFERENCES
    ******************/
    VotingShares public votingShares; // token contract
    GuildBank public guildBank; // store guild assets
    LootToken public lootToken; // token contract

    /******************
    MEMBERSHIP TRACKING
    ******************/
    TownHallLib.Members members;
    // TownHallLib.ProposalQueue proposalQueue; (get rid of libraries)

    struct Member {
        bool approved;
        address[] tokenTributeAddresses;
        uint256[] tokenTributeAmounts;
        uint256 ethAmount;
        bool hasWithdrawn;
    }

    /******************
    PROPOSAL DEFINITION
    ******************/
    enum ProposalTypes {
        Membership,
        Project
    }

    enum ProposalPhase {
        Done,
        Proposed,
        Voting,
        GracePeriod
    }

    struct ProspectiveMember {
        address prospectiveMemberAddress;
        uint256 ethTributeAmount; // eth tribute
        address[] tokenTributeAddresses; // array of token tributes
        uint256[] tokenTributeAmounts; // array of token tributes
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

        // VOTING
        uint votingEndTimeSeconds;
        uint minVotesRequired;
        mapping (address => Member) voters;
        uint[2] lineItemVotes; // array that holds num votes (i.e. voting shares) for each line item option (0 - no, 1 - yes)

        // PROJECT SPECIFIC ATTRIBUTES
        ProspectiveProject prospectiveProject;

        // MEMBER SPECIFIC ATTRIBUTES
        ProspectiveMember prospectiveMember;

        // BOOKKEEPING
        ProposalPhase phase;
        VotingLib.Ballot ballot; // proposal voting ballot
        uint gracePeriodStartTime; // when did grace period start
    }

    Proposal[] proposalQueue;
    uint256 currentProposalIndex;

    /******************
    CONFIG PARAMETERS
    ******************/
    uint PROPOSAL_VOTE_TIME_SECONDS;
    uint GRACE_PERIOD_SECONDS;
    uint PROPOSAL_CREATION_DEPOSIT_WEI;
    uint8 constant QUORUM_NUMERATOR = 1;
    uint8 constant QUORUM_DENOMINATOR = 2;

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember {
        require(members[msg.sender].approved == true, "Moloch::onlyApprovedMember - not a member");
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    constructor(
        address votingSharesAddress,
        address lootTokenAddress,
        address guildBankAddress,
        address[] foundingMemberAddresses,
        uint[] votingSharesToGrant, // corresponds with foundingMembersArray
        uint _PROPOSAL_VOTE_TIME_SECONDS,
        uint _GRACE_PERIOD_SECONDS,
        uint _PROPOSAL_CREATION_DEPOSIT_WEI
    )
        public
    {
        require(
            _PROPOSAL_VOTE_TIME_SECONDS > 0,
            "Moloch::consutructor - All config parameters are required and must be greater than zero."
        );
        require(_GRACE_PERIOD_SECONDS > 0);
        require(_PROPOSAL_CREATION_DEPOSIT_WEI > 0);

        votingShares = VotingShares(votingSharesAddress);
        lootToken = LootToken(lootTokenAddress);
        guildBank = GuildBank(guildBankAddress);

        PROPOSAL_VOTE_TIME_SECONDS = _PROPOSAL_VOTE_TIME_SECONDS;
        GRACE_PERIOD_SECONDS = _GRACE_PERIOD_SECONDS;
        PROPOSAL_CREATION_DEPOSIT_WEI = _PROPOSAL_CREATION_DEPOSIT_WEI;

        _addFoundingMembers(foundingMemberAddresses, votingSharesToGrant);
    }

    function _addFoundingMembers(
        address[] membersArray,
        uint[] sharesArray
    )
        internal
    {
        require(membersArray.length == sharesArray.length, "Moloch::_addFoundingMembers - Provided arrays should match up.");
        for (uint i = 0; i < membersArray.length; i++) {

            address founder = membersArray[i];
            uint founderShares = sharesArray[i];

            members[founder].approved = true;
            votingShares.mint(founder, founderShares);
            lootToken.mint(guildBank, founderShares);

            emit MemberAccepted(founder);
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    function createMemberProposal(
        address propospectiveMemberAddress,
        address[] tokenTributeAddresses,
        uint256[] tokenTributeAmounts,
        uint256 votingSharesRequested
    )
        public
        payable
        onlyApprovedMember
    {
        // require tribute
        require(
            (msg.value > 0) || (tokenTributeAddresses.length > 0),
            "Moloch::createMemberProposal - minimum tribute not met"
        );

        // set up proposal
        Proposal memory membershipProposal;

        // from inputs
        membershipProposal.votingSharesRequested = votingSharesRequested;
        membershipProposal.prospectiveMember.prospectiveMemberAddress = propospectiveMemberAddress;
        membershipProposal.prospectiveMember.tokenTributeAddresses = tokenTributeAddresses;
        membershipProposal.prospectiveMember.tokenTributeAmounts = tokenTributeAmounts;

        // attributes
        membershipProposal.proposer = msg.sender;
        membershipProposal.proposalType = ProposalTypes.Membership;
        membershipProposal.phase = ProposalPhase.Proposed;

        // transfer tribute to guild bank
        membershipProposal.prospectiveMember.ethTributeAmount = msg.value;
        guildBank.transfer(msg.value);

        // collect token tribute
        for(uint8 i = 0; i < tokenTributeAddresses.length; i++) {
            address tokenAddress = tokenTributeAddresses[i];
            require(
                tokenTributeAmounts[i] > 0,
                "Moloch::createMemberProposal - minimum token tribute no met"
            ); // need non zero amounts
            // transfer tokens to GuildBank contract as tribute
            // approval must be granted prior to this step
            require(
                guildBank.offerTokens(propospectiveMemberAddress, tokenAddress, tokenTributeAmounts[i]),
                "Moloch::createMemberProposal - Token offering did not complete successfully.");
        }

        // push to end of proposal queue
        proposalQueue.push(membershipProposal);

        emit ProposalCreated(
            msg.sender,
            votingSharesRequested,
            ProposalTypes.Membership,
            proposalQueue.length - 1 // last array item index
        );
    }

    function createProjectProposal(
        bytes32 ipfsHash,
        uint256 votingSharesRequested
    )
        public
        payable
        onlyApprovedMember
    {
        // require min deposit
        require(
            msg.value == PROPOSAL_CREATION_DEPOSIT_WEI,
            "Moloch::createProjectProposal - ETH deposit no met"
        );

        // set up proposal
        Proposal memory projectProposal;

        // from inputs
        projectProposal.votingSharesRequested = votingSharesRequested;
        projectProposal.prospectiveProject.ipfsHash = ipfsHash;
        projectProposal.prospectiveProject.deposit = msg.value;

        // attributes
        projectProposal.proposer = msg.sender;
        projectProposal.proposalType = ProposalTypes.Project;
        projectProposal.phase = ProposalPhase.Proposed;

        // push to end of proposal queue
        proposalQueue.push(projectProposal);

        emit ProposalCreated(msg.sender, votingSharesRequested, ProposalTypes.Project, proposalQueue.length);
    }

    function startProposalVote() public {
        Proposal storage currentProposal = proposalQueue[currentProposalIndex];
        require(
            currentProposal.phase == ProposalPhase.Proposed,
            "TownHallLib::startProposalVote - current proposal not done"
        ); // past voting and grace period

        // create ballot
        currentProposal.votingEndTimeSeconds = block.timestamp + PROPOSAL_VOTE_TIME_SECONDS;
        // lock in voting quorum now, based on total supply of voting shares
        uint256 totalVotingShares = votingShares.totalSupply();
        currentProposal.minVotesRequired = (totalVotingShares.mul(QUORUM_NUMERATOR)).div(QUORUM_DENOMINATOR);

        // change phase
        proposalQueue.phase = ProposalPhase.Voting;

        emit ProposalVotingStarted(currentProposalIndex);
    }

    function voteOnCurrentProposal(uint8 lineItem) public {
        Proposal storage currentProposal = proposalQueue[currentProposalIndex];

        require(!voteEnded(currentProposal), "VotingLib::vote - voting ended");
        require(currentProposal.voters[msg.sender].voted == false, "VotingLib::vote - voter already voted");
        require(lineItem < currentProposal.lineItemVotes.length, "VotingLib::vote - illegal lineItem");

        // TODO: I dont think we need this, if there's 0 votes it wouldn't do anything
        require(votingShares.balanceOf(msg.sender) > 0, "VotingLib::vote - voter has no votes");

        currentProposal.voters[msg.sender].voted = true;
        currentProposal.voters[msg.sender].vote = lineItem;
        uint numOfVotingShares = votingShares.balanceOf(msg.sender);

        currentProposal.lineItemVotes[lineItem] += numOfVotingShares;
    }

    function transitionProposalToGracePeriod() public {
        Proposal storage currentProposal = proposalQueue.proposals[proposalQueue.currentProposalIndex];
        require(
            currentProposal.phase == ProposalPhase.Voting,
            "TownHallLib::transitionProposalToGracePeriod - curent proposal not in voting phase"
        );

        // require vote time completed
        require(voteEnded(currentProposal), "Moloch::transitionProposalToGracePeriod - vote period not ended");

        // transition state to grace period
        currentProposal.phase = ProposalPhase.GracePeriod;
        currentProposal.gracePeriodStartTime = now;

        emit ProposalGracePeriodStarted(currentProposalIndex);
    }

    function finishProposal() public {
        Proposal storage currentProposal = proposalQueue[currentProposalIndex];

        // require grace period elapsed
        require(
            currentProposal.phase == ProposalPhase.GracePeriod,
            "TownHallLib::finishProposal - curent proposal not in grace phase"
        );
        require(
            now > currentProposal.gracePeriodStartTime + GRACE_PERIOD_SECONDS,
            "TownHallLib::finishProposal - grace phase not complete"
        );

        // get winner from ballot
        uint winningBallotItem = getWinningProposal(currentProposal);

        if (winningBallotItem == WINNING_PROPOSAL_INDEX) {
            if (currentProposal.proposalType == ProposalTypes.Membership) {
                // add member here
                _acceptMemberProposal(members, votingShares, lootToken, currentProposal);
            } else if (currentProposal.proposalType == ProposalTypes.Project) {
                // accept proposal
                _acceptProjectProposal(votingShares, lootToken, currentProposal);
            }
        } else if (winningBallotItem == LOSING_PROPOSAL_INDEX) {
            // proposal loses, transfer eth back to proposer
            if (currentProposal.proposalType == ProposalTypes.Project) {
                currentProposal.proposer.transfer(currentProposal.prospectiveProject.deposit);
            }
        }

        emit ProposalCompleted(currentProposalIndex, winningBallotItem);

        // close out and move on to next proposal
        proposalQueue.phase = ProposalPhase.Done;
        proposalQueue.currentProposalIndex++;
    }

    /***************
    BALLOT FUNCTIONS
    ***************/
    function voteEnded(Proposal memory proposal) public view returns (bool) {
        return block.timestamp > proposal.votingEndTimeSeconds;
    }

    /**************
    GUILD FUNCTIONS
    **************/
    /// @notice Cash out voting shares for loot tokens
    /// @dev Voting shares are burned, loot tokens are transferred
    /// from this contract to the member
    function exitMoloch() public onlyApprovedMember {
        require(members.approved[msg.sender] == true);
        require(members.hasWithdrawn[msg.sender] == false);
        require(proposalQueue.isVotingWinner());

        members[msg.sender].hasWithdrawn = true;
        members[msg.sender].approved = false;

        uint256 numberOfVotingShares = votingShares.balanceOf(msg.sender);
        require(lootToken.transfer(msg.sender, numberOfVotingShares), "Moloch:exitMoloch - failed to transfer lootToken");

        votingShares.proxyBurn(msg.sender, numberOfVotingShares);

        guildBank.convertLootTokensToLoot(msg.sender, members.tokenTributeAddresses[msg.sender]);

        emit MemberExit(msg.sender);
    }

    function withdraw() public {
        require(members.approved[msg.sender] == false);
        require(members.hasWithdrawn[msg.sender] == false);
        members.hasWithdrawn[msg.sender] = true;
        guildBank.withdraw(
            msg.sender,
            members.tokenTributeAddresses[msg.sender],
            members.tokenTributeAmounts[msg.sender],
            members.ethAmount[msg.sender]
        );
    }

    function getMember(address memberAddress) public view returns (bool) {
        return members.getMember(memberAddress);
    }

    function getVotingShares(address memberAddress) public view returns (uint) {
        return votingShares.balanceOf(memberAddress);
    }

    function getCurrentProposalIndex() public view returns (uint) {
        return proposalQueue.getCurrentProposalIndex();
    }

    function getProposalCommonDetails(uint index)
        public
        view
        returns (
            address,
            TownHallLib.ProposalTypes,
            uint256,
            TownHallLib.ProposalPhase,
            uint
        )
    {
        return proposalQueue.getProposalCommonDetails(index);
    }

    function getProposalMemberDetails(uint index)
        public
        view
        returns (
            address,
            uint256,
            address[],
            uint256[]
        )
    {
        return proposalQueue.getProposalMemberDetails(index);
    }

    function getProposalBallot(uint index)
        public
        view
        returns (
            uint,
            uint,
            uint
        )
    {
        return proposalQueue.getProposalBallot(index);
    }

    /*****************
    INTERNAL FUNCTIONS
    *****************/

    // TRANSFER TRIBUTES TO GUILD BANK
    /*
    function _collectTributes(
        uint256 _ethTributeAmount,
        address[] _tokenTributeAddresses,
        uint256[] _tokenTributeAmounts
    )
        internal
    {
        // collect eth tribute
        if (_ethTributeAmount > 0) {
            address(guildBank).transfer(_ethTributeAmount);
        }

        // collect token tribute
        for (uint8 i = 0; i < _tokenTributeAddresses.length; i++) {
            ERC20 erc20 = ERC20(_tokenTributeAddresses[i]);
            require(erc20.approve(address(guildBank), _tokenTributeAmounts[i]), "TownHallLib::_collectTributes - could not collect token tribute");
        }
    }
    */

    // DILUTE GUILD AND GRANT VOTING SHARES (MINT LOOT TOKENS)
    function _grantVotingShares(
        address to,
        uint256 numVotingShares
    )
        internal
    {
        // dilute and grant
        votingShares.mint(to, numVotingShares);

        // mint loot tokens 1:1 and keep them in moloch contract for exit
        lootToken.mint(address(this), numVotingShares);
    }

    // ACCEPT MEMBER
    function _acceptMemberProposal(Proposal memberProposal)
        internal
    {
        // add to moloch members
        address newMemberAddress = memberProposal.prospectiveMember.prospectiveMemberAddress;
        members.approved[newMemberAddress] = true;

        // grant shares to new member
        _grantVotingShares(
            votingShares,
            lootToken,
            newMemberAddress,
            memberProposal.votingSharesRequested
        );
    }

    // ACCEPT PROJECT
    function _acceptProjectProposal(
        Proposal projectProposal
    )
        internal
    {
        // grant shares to proposer
        _grantVotingShares(
            votingShares,
            lootToken,
            projectProposal.proposer,
            projectProposal.votingSharesRequested
        );

        // transfer deposit back to proposer
        projectProposal.proposer.transfer(projectProposal.prospectiveProject.deposit);
    }
}
