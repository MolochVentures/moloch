pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/token/ERC20/ERC20.sol';
import './VotingShares.sol';
import './MemberApplicationBallot.sol';

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
  address public votingShares;

  event MemberApplication(
    address indexed _memberAddress,
    uint256 _votingSharesRequested,
    uint256 _ethTributeAmount,
    address _tokenTributeAddress,
    uint256 _tokenTributeAmount,
    address _ballotAddress
  );

  modifier onlyMember {
    require(members[msg.sender].approved);
    _;
  }

  function Moloch(address _votingShares) {
    votingShares = _votingShares;
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

    MemberApplication(
      msg.sender,
      _votingSharesRequested,
      msg.value,
      _tokenTributeAddress,
      _tokenTributeAmount,
      ballotAddress
    );
  }

  function voteOnMemberApplication(address member, bool accepted) {
    require(!members[member].approved);

    MemberApplicationBallot ballot = MemberApplicationBallot(members[member].ballotAddress);
    if (accepted) {
      ballot.voteFor();
    } else {
      ballot.voteAgainst();
    }
  }
}