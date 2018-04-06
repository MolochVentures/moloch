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
    TownHall public townHall; // token contract

    /******************
    MEMBERSHIP TRACKING
    ******************/
    mapping (address => bool) public members; // members mapped to their address

    /********
    MODIFIERS
    ********/
    modifier onlyApprovedMember {
        require(members[msg.sender] == true);
        _;
    }

    modifier onlyTownHall {
        require(address(msg.sender) == address(townHall));
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    /*******************************
    SET CONTRACT REFERENCE FUNCTIONS
    *******************************/
    /// @notice Set reference to the deployed TownHall contract address
    /// @param _townHallAddress Address of TownHall contract
    function setTownHall(address _townHallAddress) public onlyOwner {
        townHall = TownHall(_townHallAddress);
    }

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

        members[msg.sender] = false;
        MemberExit(msg.sender);
    }

    /*****************
    INTERNAL FUNCTIONS
    *****************/
    /// @notice Add member to guild, only TownHall contract can do this
    /// @param _newMemberAddress Address of member to add
    function addMember(address _newMemberAddress) public onlyTownHall {
        members[_newMemberAddress] = true;
        MemberAccepted(_newMemberAddress);
    }
}