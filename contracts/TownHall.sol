pragma solidity ^0.4.0;

import 'zeppelin-solidity/contracts/ownership/Ownable.sol';

contract TownHall is Ownable {
    struct Proposal {
        address ballotAddress;
        bytes32 ipfsHash;
    }

    mapping (address => Proposal) public proposals;

    function createProposal(bytes32 ipfsHash, address proposerAddress);
}