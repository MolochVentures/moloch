// Pool.sol
// - mints a pool share when someone donates tokens
// - syncs with Moloch proposal queue to mint shares for grantees
// - allows shareholders to withdraw tokens at any time

pragma solidity 0.5.3;

import "./Moloch.sol";
import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";

contract MolochPool {
    using SafeMath for uint256;

    uint256 public active = false;
    uint256 public totalPoolShares = 0; // the total shares outstanding of the pool
    uint256 public currentProposalIndex = 0; // the moloch proposal index that this pool has been synced to

    Moloch public moloch; // moloch contract reference
    IERC20 public approvedToken; // approved token contract reference (copied from moloch contract)

    bool locked; // prevent re-entrancy

    // the amount of shares each pool shareholder has
    mapping (address => uint256) poolShares;

    modifier active {
        require(totalPoolShares > 0);
    }

    modifier noReentrancy() {
        require(!locked, "Reentrant call.");
        locked = true;
        _;
        locked = false;
    }

    // copy of the Moloch Proposal struct
    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 sharesRequested; // the # of shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        bool didPass; // true only if the proposal passed
        bool aborted; // true only if applicant calls "abort" fn before end of voting period
        uint256 tokenTribute; // amount of tokens offered as tribute
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    constructor(address _moloch) public {
        moloch = Moloch(_moloch);
        approvedToken = IERC20(moloch.approvedToken());
    }

    function activate(uint256 initialTokens, uint256 initialPoolShares) noReentrancy {
        require(totalPoolShares == 0);

        require(approvedToken.transferFrom(msg.sender, address(this), initialTokens));
        _mintSharesForAddress(initialPoolShares, msg.sender);
    }

    // updates Pool state based on Moloch proposal queue
    // - we only want to mint shares for grants, which are 0 tribute
    // - mints pool shares to applicants based on sharesRequested / maxTotalSharesAtYesVote
    // - use maxTotalSharesAtYesVote because:
    //   - cant read shares at the time of proposal processing (womp womp)
    //   - should be close enough if grant shares are small relative to total shares, which they should be
    //   - protects pool contributors if many Moloch members ragequit before the proposal is processed by reducing follow on funding
    //   - e.g. if 50% of Moloch shares ragequit after someone voted yes, the grant proposal would get 50% less follow-on from the pool
    function sync(uint256 toIndex) active noReentrancy {
        require(toIndex <= moloch.getProposalQueueLength());

        for (uint256 i = currentProposalIndex; i < toIndex; i++) {
            Proposal memory proposal = moloch.proposalQueue(currentProposalIndex);

            if (proposal.processed && proposal.didPass && !proposal.aborted && proposal.sharesRequested > 0) {
                // passing grant proposal, mint pool shares proportionally on behalf of the applicant
                if (proposal.tokenTribute == 0) {
                    uint256 poolSharesToMint = totalPoolShares.mul(proposal.sharesRequested).div(proposal.maxTotalSharesAtYesVote);
                    _mintSharesForAddress(poolSharesToMint, proposal.applicant);
                }

                currentMolochSharesMinted = currentMolochSharesMinted.add(proposal.sharesRequested);
            }
        }

        currentProposalIndex = toIndex;
    }

    // add tokens to the pool, mint new shares proportionally
    function deposit(uint256 tokenAmount) active noReentrancy {

        uint256 sharesToMint = totalPoolShares.mul(tokenAmount).div(approvedToken.balanceOf(address(this)));

        require(approvedToken.transferFrom(msg.sender, address(this), tokenAmount));

        _mintSharesForAddress(poolSharesToMint, msg.sender);
    }

    // burn shares to proportionally withdraw tokens in pool
    function withdraw(uint256 sharesToBurn) active noReentrancy {
        require(poolShares(msg.sender) >= sharesToBurn);

        uint256 tokensToWithdraw = approvedToken.balanceOf(address(this)).mul(sharesToBurn).div(totalPoolShares);

        totalPoolShares = totalPoolShares.sub(sharesToBurn);
        poolShares[msg.sender] = poolShares[msg.sender].sub(sharesToBurn);

        require(approvedToken.transfer(msg.sender, tokensToWithdraw));
    }

    function _mintSharesForAddress(uint256 sharesToMint, address recipient) internal {
        totalPoolShares = totalPoolShares.add(sharesToMint);
        poolShares[recipient] = poolShares[recipient].add(sharesToMint);
    }
}
