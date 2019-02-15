pragma solidity 0.5.3;

import "./oz/Ownable.sol";

interface Moloch {
    function proposalQueue(uint proposal) external returns ( 
        address proposer,
        address applicant, 
        uint256 sharesRequested, 
        uint256 startingPeriod, 
        uint256 yesVotes,
        uint256 noVotes,
        bool processed,
        bool didPass,
        bool aborted,
        string memory details,
        uint256 maxTotalSharesAtYesVote
    );
}

contract Proposal is Ownable {
    uint public proposalNumber;
    address molochAddress = 0x1234567890123456789012345678901234567890;

    function setProposalNumber(uint256 _ProposalNumber) public onlyOwner {
        // only owner can call this
        require(proposalNumber == 0, 'can only be set once!');
        proposalNumber = _ProposalNumber;
    }
    
    function checkProposalStatus() public {
        // anyone can call this
        
        require(proposalNumber > 0, 'proposal number not set yet!');
        Moloch moloch = Moloch(molochAddress);
        
        // get data from proposal
        bool processed;
        bool didPass;
        bool aborted;
        (,,,,,,processed, didPass, aborted,,) = moloch.proposalQueue(proposalNumber);
        
        require(processed, 'requires that proposal be either processed or aborted');
        
        // If proposal was processed, check result;
        if (didPass) {
            // Proposal passed! Do whatever stuff you promised: send ether, send tokens, transfer a NFT, sire a kitty, etc
        }
        
        if (!didPass || aborted) {
            // Did not pass or was aborted: Cancel whatever you wanted, send money back to owner, get the kitten home, etc 
        }
        
        
    }
    
    
    

 
}
