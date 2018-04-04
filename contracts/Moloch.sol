pragma solidity ^0.4.0;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./VotingShares.sol";
import "./Voting.sol";
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

    /*****
    EVENTS
    *****/
    event TokenTributeOffered(
        address indexed memberAddress,
        address[] tokenTributeAddresses,
        uint256[] tokenTributeAmounts
    );

    event EthTributeOffered(
        address indexed memberAddress,
        uint256 ethTributeAmount
    );

    event MemberApplied(
        address indexed memberAddress,
        uint256 votingSharesRequested,
        address ballotAddress
    );

    event MemberAccepted(
        address indexed memberAddress
    );

    event VotedForMember(
        address indexed votingMember,
        address indexed votedFor,
        bool accepted
    );

    event MemberExit(
        address indexed memberAddress
    );

    /********
    CONSTANTS
    ********/
    // where should this be configured? in constructor?
    uint MEMBERSHIP_VOTE_TIME_SECONDS = 5;

    /******************
    CONTRACT REFERENCES
    ******************/
    VotingShares public votingShares; // token contract
    GuildBank public guildBank; // store guild assets
    LootToken public lootToken; // token contract
    TownHall public townHall; // token contract

    /******************
    MEMBERSHIP TRACKING
    ******************/
    struct Member {
        uint256 ethTributeAmount; // eth tribute provided
        address[] tokenTributeAddresses; // array of token tributes
        uint256[] tokenTributeAmounts; // array of token tributes
    }

    mapping (address => Member) public members; // members mapped to their address

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember {
        require(members[msg.sender].approved);
        _;
    }

    modifier onlyTownHall {
        require(address(msg.sender) == townHall);
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    /*******************************
    SET CONTRACT REFERENCE FUNCTIONS
    *******************************/
    /// @notice Set reference to the deployed VotingShares contract address
    /// @param _votingShares Address of VotingShares contract
    function setVotingShares(address _votingShares) public onlyOwner {
        votingShares = VotingShares(_votingShares);
    }

    /// @notice Set reference to the deployed LootToken contract address
    /// @param _lootToken Address of LootToken contract
    function setLootToken(address _lootToken) public onlyOwner {
        lootToken = LootToken(_lootToken);
    }

    /// @notice Set reference to the deployed GuildBank contract address
    /// @param _guildBank Address of GuildBank contract
    function setGuildBank(address _guildBank) public onlyOwner {
        guildBank = GuildBank(_guildBank);
    }

    /*******************************
    MEMBERSHIP APPLICATION FUNCTIONS
    *******************************/
    /// @notice Adds founding member without approval
    /// @param _memberAddress Address of member to be added
    /// @param _votingShares Number of voting shares to grant
    function addFoundingMember(address _memberAddress, uint256 _votingShares) public onlyOwner {
        Member storage member = members[_memberAddress];

        // require tribute
        require(member.ethTributeAmount > 0 || member.tokenTributeAddresses.length > 0);

        member.votingSharesRequested = _votingShares;
        member.ballotAddress = address(0); // no ballot bc no voting

        _addMember(_memberAddress); // internal function to actually add
    }

    /// @notice Offer tribute in ETH, is paid to contract
    function offerEthTribute() public payable {
        Member storage member = members[msg.sender];
        member.ethTributeAmount = msg.value;

        EthTributeOffered(msg.sender, msg.value);
    }

    /// @notice Offer tribute tokens
    /// @param _tokenContractAddresses Array of addresses of tokens being offered
    /// @param _tokenTributes Array of amounts of tokens being offered
    function offerTokenTribute(address[] _tokenContractAddresses, uint256[] _tokenTributes) public {
        // require equal number of addresses and amounts
        require(_tokenContractAddresses.length == _tokenTributes.length);

        Member storage member = members[msg.sender];
        member.approved = false; // should be already, but lets be safe

        for (uint8 i = 0; i < _tokenContractAddresses.length; i++) {
            require(_tokenTributes[i] > 0); // need non zero amounts
            ERC20 erc20 = ERC20(_tokenContractAddresses[i]);

            // transfer tokens to this contract as tribute
            // approval must be granted prior to this step
            require(erc20.transferFrom(msg.sender, this, _tokenTributes[i]));

            // bookkeeping
            member.tokenTributeAddresses.push(_tokenContractAddresses[i]);
            member.tokenTributeAmounts.push(_tokenTributes[i]);
        }

        TokenTributeOffered(msg.sender, _tokenContractAddresses, _tokenTributes);
    }

    /// @notice Submit application as a prospective member
    /// @param _votingSharesRequested Number of voting shares requested
    function submitApplication(uint256 _votingSharesRequested) public {
        Member storage prospectiveMember = members[msg.sender];

        // can't reapply if already approved
        require(!prospectiveMember.approved);
        // require tribute offered
        require(prospectiveMember.ethTributeAmount > 0 || prospectiveMember.tokenTributeAddresses.length > 0);

        // create ballot for voting new member in, 2 proposal vote
        address ballotAddress = new Voting(address(votingShares), MEMBERSHIP_VOTE_TIME_SECONDS, 2);

        prospectiveMember.votingSharesRequested = _votingSharesRequested;
        prospectiveMember.ballotAddress = ballotAddress;

        MemberApplied(
            msg.sender,
            _votingSharesRequested,
            ballotAddress
        );
    }

    /**************************
    MEMBERSHIP VOTING FUNCTIONS
    **************************/
    /// @notice Allows members to vote on pending membership applications
    /// @param _prospectiveMemberAddress Address of prospective member
    /// @param _iAccept Should the member be accepted?
    function voteOnMemberApplication(address _prospectiveMemberAddress, bool _iAccept) public onlyApprovedMember {
        require(!members[_prospectiveMemberAddress].approved); // cant already be approved

        Voting ballot = Voting(members[_prospectiveMemberAddress].ballotAddress);
        if (_iAccept) {
            ballot.vote(msg.sender, 1); // proposal 1 accepts
        } else {
            ballot.vote(msg.sender, 0); // proposal 0 rejects
        }

        VotedForMember(msg.sender, _prospectiveMemberAddress, _iAccept);
    }

    /// @notice Check if member vote succeeded and then add member
    /// @param _prospectiveMemberAddress Address of prospective member
    function acceptMember(address _prospectiveMemberAddress) public onlyApprovedMember {
        // check that vote passed
        Voting ballot = Voting(members[_prospectiveMemberAddress].ballotAddress);
        uint8 winningProposal = ballot.getWinnerProposal();
        require(winningProposal == 1);
        _addMember(_prospectiveMemberAddress);
    }

    /// @notice Cash out voting shares for loot tokens
    /// @dev Voting shares are burned, loot tokens are transferred
    /// from this contract to the member
    function exitMoloch() public onlyApprovedMember {
        uint256 numberOfVotingShares = votingShares.balanceOf(msg.sender);

        // TODO: wrap in require
        lootToken.transfer(msg.sender, numberOfVotingShares);
        votingShares.proxyBurn(msg.sender, numberOfVotingShares);

        delete members[msg.sender];
        MemberExit(msg.sender);
    }

    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Return member attributes
    /// @param _memberAddress Address of member
    /// @return Array of member attributes
    function getMember(address _memberAddress) public view returns (
        bool,
        uint256,
        uint256,
        address[],
        uint256[],
        address
    ) {
        Member memory member = members[_memberAddress];
        return (
            member.approved,
            member.votingSharesRequested,
            member.ethTributeAmount,
            member.tokenTributeAddresses,
            member.tokenTributeAmounts,
            member.ballotAddress
        );
    }

    function isMemberApproved(address _memberAddress) public view returns (bool) {
        Member memory member = members[_memberAddress];
        return member.approved;
    }

    /*****************
    INTERNAL FUNCTIONS
    *****************/
    /// @notice Add member to guild
    /// @param _newMemberAddress Address of member to add
    function _addMember(
        address _newMemberAddress,
        uint256 _ethTributeAmount,
        address[] _tokenTributeAddresses,
        uint256[] _tokenTributeAmounts
    ) public onlyTownHall {
        Member storage newMember = members[_newMemberAddress];
        
        newMember.ethTributeAmount = _ethTributeAmount;
        newMember.tokenTributeAddresses = _tokenTributeAddresses;
        newMember.tokenTributeAmounts = _tokenTributeAmounts;

        MemberAccepted(_newMemberAddress);
    }
}