pragma solidity 0.4.23;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
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
    using TownHallLib for TownHallLib.ProposalQueue;
    using TownHallLib for TownHallLib.Members;

    /*****
    EVENTS
    *****/
    event MemberAccepted(
        address indexed memberAddress
    );

    event MemberExit(
        address indexed memberAddress
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
    TownHallLib.ProposalQueue proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember {
        require(members.approved[msg.sender] == true, "Moloch::onlyApprovedMember - not a member");
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    constructor(
        address _votingSharesAddress,
        address _lootTokenAddress,
        address _guildBankAddress,
        address[] _membersArray,
        uint[] _sharesArray
    ) 
        public 
    {
        votingShares = VotingShares(_votingSharesAddress);
        lootToken = LootToken(_lootTokenAddress);
        guildBank = GuildBank(_guildBankAddress);

        require(_membersArray.length == _sharesArray.length);

        for (uint i = 0; i < _membersArray.length; i++) {

            address founder = _membersArray[i];
            uint founderShares =  _sharesArray[i];

            members.approved[founder] = true;
            votingShares.mint(msg.sender, founder, founderShares);
            lootToken.mint(msg.sender, guildBank, founderShares);

            emit MemberAccepted(founder);
        }
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
        public
        payable
        onlyApprovedMember // TODO: ONLY MEMBERS?
    {
        proposalQueue.createMemberProposal(
            _propospectiveMemberAddress,
            msg.value,
            _tokenTributeAddresses, 
            _tokenTributeAmounts,
            _votingSharesRequested,
            guildBank
        );
    }

    function createProjectProposal(
        bytes32 _ipfsHash,
        uint256 _votingSharesRequested
    )
        public
        payable
        onlyApprovedMember
    {
        proposalQueue.createProjectProposal(
            msg.value,
            _ipfsHash,
            _votingSharesRequested
        );
    }

    function startProposalVote() public onlyApprovedMember {
        proposalQueue.startProposalVote(votingShares);
    }

    function voteOnCurrentProposal(uint8 _toBallotItem) public onlyApprovedMember {
        proposalQueue.voteOnCurrentProposal(_toBallotItem);
    }

    function transitionProposalToGracePeriod() public onlyApprovedMember {
        proposalQueue.transitionProposalToGracePeriod();
    }

    function finishProposal() public onlyApprovedMember {
        proposalQueue.finishProposal(members, guildBank, votingShares, lootToken);
    }

    /**************
    GUILD FUNCTIONS
    **************/
    /// @notice Cash out voting shares for loot tokens
    /// @dev Voting shares are burned, loot tokens are transferred
    /// from this contract to the member
    function exitMoloch() public onlyApprovedMember {
        uint256 numberOfVotingShares = votingShares.balanceOf(msg.sender);

        require(lootToken.transfer(msg.sender, numberOfVotingShares), "Moloch:exitMoloch - failed to transfer lootToken");
        votingShares.proxyBurn(msg.sender, numberOfVotingShares);

        members.approved[msg.sender] = false;
        guildBank.convertLootTokensToLoot(msg.sender);

        emit MemberExit(msg.sender);
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

    function getCurrentProposalCommonDetails() 
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
        return proposalQueue.getCurrentProposalCommonDetails();
    }

    function getCurrentProposalBallot()
        public
        view
        returns (
            uint,
            uint,
            uint
        )
    {
        return proposalQueue.getCurrentProposalBallot();
    }
}