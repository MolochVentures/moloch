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

contract Offering is Ownable {
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
            // Proposal passed! Sacrifice the lamb, burn the incense, give the tribute
        }
        
        if (!didPass || aborted) {
            // Did not pass or was aborted: Save the lamb, keep the incense, take the tribute back to owner
        }
        
        
    }
    
    
    

 
}
