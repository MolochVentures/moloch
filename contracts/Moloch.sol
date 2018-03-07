pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/token/ERC20/ERC20.sol';
import './VotingShares.sol';
import './MemberApplicationBallot.sol';
import './GuildBank.sol';
import './LootToken.sol';

contract Moloch is Ownable {
  using SafeMath for uint256;

  uint membershipVoteTimeSeconds = 5;

  struct Member {
    bool approved;
    uint256 votingShares;

    //tributes
    uint256 ethTributeAmount;
    address[] tokenTributeAddresses; 
    uint256[] tokenTributeAmounts;

    address ballotAddress;
  }

  address[] public approvedMembers;
  mapping (address => Member) public members;

  VotingShares public votingShares;
  GuildBank public guildBank;
  LootToken public lootToken;

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

  modifier onlyMember {
    require(members[msg.sender].approved);
    _;
  }

  function setVotingShares(address _votingShares) public onlyOwner {
    votingShares = VotingShares(_votingShares);
  }

  function setLootToken(address _lootToken) public onlyOwner {
    lootToken = LootToken(_lootToken);
  }

  function setGuildBank(address _guildBank) public onlyOwner {
    guildBank = GuildBank(_guildBank);
  }

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
      member.votingShares,
      member.ethTributeAmount,
      member.tokenTributeAddresses,
      member.tokenTributeAmounts,
      member.ballotAddress
    );
  }

  // add founding member, auto approved
  function addFoundingMember(
    address _memberAddress,
    uint256 _votingShares
  ) public payable onlyOwner
  {
    Member storage member = members[_memberAddress];

    // require tribute
    require(member.ethTributeAmount > 0 || member.tokenTributeAddresses.length > 0);
    member.votingShares = _votingShares;
    member.ballotAddress = address(0);

    _addMember(_memberAddress);
  }

  function offerEthTribute() public payable {
    Member storage member = members[msg.sender];
    member.ethTributeAmount = msg.value;

    EthTributeOffered(msg.sender, msg.value);
  }

  function offerTokenTribute(address[] _tokenContractAddresses, uint256[] _tokenTributes) public {
    require(_tokenContractAddresses.length == _tokenTributes.length);

    Member storage member = members[msg.sender];
    member.approved = false; // should be already, but lets be safe

    for (uint8 i = 0; i < _tokenContractAddresses.length; i++) {
      member.tokenTributeAddresses.push(_tokenContractAddresses[i]);
      member.tokenTributeAmounts.push(_tokenTributes[i]);
    }

    TokenTributeOffered(msg.sender, _tokenContractAddresses, _tokenTributes);
  }

  function submitApplication(
    uint256 _votingSharesRequested
  ) public 
  {
    Member storage member = members[msg.sender];

    // can't reapply if already approved
    require(!member.approved);
    // require tribute offered
    require(member.ethTributeAmount > 0 || member.tokenTributeAddresses.length > 0);

    // create ballot for voting new member in
    address ballotAddress = new MemberApplicationBallot(approvedMembers, membershipVoteTimeSeconds);

    member.votingShares = _votingSharesRequested;
    member.ballotAddress = ballotAddress;

    MemberApplied(
      msg.sender,
      _votingSharesRequested,
      ballotAddress
    );
  }

  function voteOnMemberApplication(address _prospectiveMember, bool _accepted) public onlyMember {
    require(!members[_prospectiveMember].approved);

    MemberApplicationBallot ballot = MemberApplicationBallot(members[_prospectiveMember].ballotAddress);
    if (_accepted) {
      ballot.voteFor(msg.sender);
    } else {
      ballot.voteAgainst(msg.sender);
    }

    VotedForMember(msg.sender, _prospectiveMember, _accepted);
  }

  function _addMember(address _prospectiveMember) internal {
    Member storage newMember = members[_prospectiveMember];
    newMember.approved = true;

    // transfer tokens and eth to guild bank
    for (uint8 i = 0; i < newMember.tokenTributeAddresses.length; i++) {
      ERC20 token = ERC20(newMember.tokenTributeAddresses[i]);
      token.transferFrom(_prospectiveMember, address(guildBank), newMember.tokenTributeAmounts[i]);
    }

    if (newMember.ethTributeAmount > 0) {
      address(guildBank).transfer(newMember.ethTributeAmount);
    }

    // mint and transfer voting shares
    votingShares.mint(_prospectiveMember, newMember.votingShares);

    // mint loot tokens 1:1 and keep them in this contract for withdrawal
    lootToken.mint(this, newMember.votingShares);

    approvedMembers.push(_prospectiveMember);
    MemberAccepted(_prospectiveMember);
  }

  function acceptMember(address _prospectiveMember) public onlyMember {
    // TODO: dont require everyone to vote, count number of votes during a time limit, check against time limit
    // check that vote passed
    MemberApplicationBallot ballot = MemberApplicationBallot(members[_prospectiveMember].ballotAddress);
    require(ballot.isAccepted());

    _addMember(_prospectiveMember);
  }

  function exitMoloch() public onlyMember {
    Member memory member = members[msg.sender];
    require(lootToken.balanceOf(this) >= member.votingShares);

    lootToken.transfer(msg.sender, member.votingShares);
    votingShares.proxyBurn(msg.sender, member.votingShares);

    delete members[msg.sender];
    MemberExit(msg.sender);
  }

  function() public payable {}
}