pragma solidity 0.5.3;

interface Moloch {
    function proposalQueue(uint proposal) external returns (  address proposer, address applicant,  uint256 sharesRequested,  uint256 startingPeriod,  uint256 yesVotes, uint256 noVotes, bool processed, bool didPass, bool aborted, string memory details, uint256 maxTotalSharesAtYesVote);
}

contract Offering {
    uint public proposalNumber;
    address public molochAddress;

    constructor (uint256 _proposalNumber, address _molochAddress) public {
        proposalNumber = _proposalNumber;
        molochAddress = _molochAddress;
    }
    
    function checkProposalStatus() public {
        // anyone can call this function
        
        // get current status from Moloch
        Moloch moloch = Moloch(molochAddress);
        bool processed;
        bool didPass;
        bool aborted;
        (,,,,,,processed, didPass, aborted,,) = moloch.proposalQueue(proposalNumber);
        
        require(processed, 'requires that proposal be either processed or aborted');
        
        // If proposal was processed, check result;
        if (didPass) {
            // Proposal passed! Sacrifice the lamb, burn the incense, give the tribute
        } else if (!didPass || aborted) {
            // Did not pass or was aborted: Save the lamb, keep the incense, take the tribute back to owner
        }
    }
}
