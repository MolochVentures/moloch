pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./VotingShares.sol";
import "./GuildBank.sol";
import "./LootToken.sol";
import "./TownHall.sol";

/**
    @title Moloch DAO contract
    @notice Overseer contract for all Moloch functions, including membership, application, voting, and exiting
    @dev Owner should be a multisig wallet
 */
contract Moloch is Ownable {
    using SafeMath for uint256;
    using TownHall for TownHall.ProposalQueue;
    using TownHall for TownHall.Members;

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
    TownHall.Members members;
    TownHall.ProposalQueue proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember {
        require(members.approved[msg.sender] == true);
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    function Moloch(
        address _votingSharesAddress,
        address _lootTokenAddress,
        address _guildBankAddress
    ) 
        public 
    {
        votingShares = VotingShares(_votingSharesAddress);
        lootToken = LootToken(_lootTokenAddress);
        guildBank = GuildBank(_guildBankAddress);
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
            _votingSharesRequested
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

    function addFoundingMember(address _memberAddress, uint256 _votingSharesToGrant) public onlyOwner {
        members.addFoundingMember(votingShares, lootToken, _memberAddress, _votingSharesToGrant);
    }

    /**************
    GUILD FUNCTIONS
    **************/
    /// @notice Cash out voting shares for loot tokens
    /// @dev Voting shares are burned, loot tokens are transferred
    /// from this contract to the member
    function exitMoloch() public onlyApprovedMember {
        uint256 numberOfVotingShares = votingShares.balanceOf(msg.sender);

        require(lootToken.transfer(msg.sender, numberOfVotingShares));
        votingShares.proxyBurn(msg.sender, numberOfVotingShares);

        members.approved[msg.sender] = false;
        emit MemberExit(msg.sender);
    }

    function getMember(address memberAddress) public view returns (bool) {
        return members.getMember(memberAddress);
    }

    function getCurrentProposalIndex() public view returns (uint) {
        return proposalQueue.getCurrentProposalIndex();
    }

    function getCurrentProposalCommonDetails() 
        public 
        view 
        returns (
            address,
            TownHall.ProposalTypes,
            uint256,
            TownHall.ProposalPhase,
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