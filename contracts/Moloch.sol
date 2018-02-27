pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/token/ERC20/ERC20.sol';
import './VotingShares.sol';
import './MemberApplicationBallot.sol';
import './GuildBank.sol';

contract Moloch is Ownable {
  using SafeMath for uint256;

  struct Member {
    bool approved;
    uint256 votingShares;
    uint256 ethTributeAmount;
    // token tribute
    address tokenTributeAddress;
    uint256 tokenTributeAmount;
    address ballotAddress;
  }

  address[] public approvedMembers;
  mapping (address => Member) public members;

  VotingShares public votingShares;
  GuildBank public guildBank;

  event MemberApplied(
    address indexed memberAddress,
    uint256 votingSharesRequested,
    uint256 ethTributeAmount,
    address tokenTributeAddress,
    uint256 tokenTributeAmount,
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

  modifier onlyMember {
    require(members[msg.sender].approved);
    _;
  }

  function Moloch() public {
    votingShares = new VotingShares();
    guildBank = new GuildBank();
  }

  function getMember(address _memberAddress) public view returns (
    bool,
    uint256,
    uint256,
    address,
    uint256,
    address
  ) {
    Member memory member = members[_memberAddress];
    return (
      member.approved,
      member.votingShares,
      member.ethTributeAmount,
      member.tokenTributeAddress,
      member.tokenTributeAmount,
      member.ballotAddress
    );
  }

  // add founding member, auto approved
  function addFoundingMember(
    address _memberAddress,
    uint256 _votingShares,
    address _tokenTributeAddress,
    uint256 _tokenTributeAmount
  ) public payable onlyOwner
  {
    members[_memberAddress] = Member(
      false,
      _votingShares,
      msg.value,
      _tokenTributeAddress,
      _tokenTributeAmount,
      address(0) // no voting ballot
    );
    _addMember(_memberAddress);
  }

  function submitApplication(
    uint256 _votingSharesRequested,
    address _tokenTributeAddress,
    uint256 _tokenTributeAmount
  ) public payable 
  {
    // can't reapply if already approved
    require(!members[msg.sender].approved);

    // create ballot for voting new member in
    address ballotAddress = new MemberApplicationBallot(approvedMembers);

    members[msg.sender] = Member({ 
      approved: false,
      votingShares: _votingSharesRequested,
      ethTributeAmount: msg.value,
      tokenTributeAddress: _tokenTributeAddress,
      tokenTributeAmount: _tokenTributeAmount,
      ballotAddress: ballotAddress
    });

    MemberApplied(
      msg.sender,
      _votingSharesRequested,
      msg.value,
      _tokenTributeAddress,
      _tokenTributeAmount,
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

  function _addMember(address _prospectiveMember) internal onlyOwner {
    VotingShares votingSharesInst = VotingShares(votingShares);

    Member storage newMember = members[_prospectiveMember];
    newMember.approved = true;

    // transfer tokens and eth to guild bank
    if (newMember.tokenTributeAddress != address(0)) {
      ERC20 token = ERC20(newMember.tokenTributeAddress);
      token.transfer(address(guildBank), newMember.tokenTributeAmount);
    }

    if (newMember.ethTributeAmount > 0) {
      address(guildBank).transfer(newMember.ethTributeAmount);
    }

    // mint and transfer voting shares
    votingSharesInst.mint(_prospectiveMember, newMember.votingShares);

    approvedMembers.push(_prospectiveMember);
    MemberAccepted(_prospectiveMember);
  }

  function acceptMember(address _prospectiveMember) public onlyOwner {
    // check that vote passed
    MemberApplicationBallot ballot = MemberApplicationBallot(members[_prospectiveMember].ballotAddress);
    require(ballot.isAccepted());

    _addMember(_prospectiveMember);
  }

  function() public payable {}
}