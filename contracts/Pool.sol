// Pool.sol
// - mints a pool share when someone donates tokens
// - syncs with Moloch proposal queue to mint shares for grantees
// - allows donors to withdraw tokens at any time

pragma solidity 0.5.3;

import "./Moloch.sol";
import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";

contract MolochPool {
    using SafeMath for uint256;

    uint256 public totalPoolShares = 0; // the total shares outstanding of the pool
    uint256 public currentProposalIndex = 0; // the moloch proposal index that this pool has been synced to

    Moloch public moloch; // moloch contract reference
    IERC20 public approvedToken; // approved token contract reference (copied from moloch contract)

    bool locked; // prevent re-entrancy

    struct Donor {
        uint256 shares;
        mapping (address => bool) keepers;
    }

    // the amount of shares each pool shareholder has
    mapping (address => Donor) public donors;

    modifier active {
        require(totalPoolShares > 0);
        _;
    }

    modifier noReentrancy() {
        require(!locked, "Reentrant call.");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _moloch) public {
        moloch = Moloch(_moloch);
        approvedToken = IERC20(moloch.approvedToken());
    }

    function activate(uint256 initialTokens, uint256 initialPoolShares) public noReentrancy {
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
    function sync(uint256 toIndex) public active noReentrancy {
        require(toIndex <= moloch.getProposalQueueLength());

        // declare proposal params
        address applicant;
        uint256 sharesRequested;
        bool processed;
        bool didPass;
        bool aborted;
        uint256 tokenTribute;
        uint256 maxTotalSharesAtYesVote;

        for (uint256 i = currentProposalIndex; i < toIndex; i++) {

            (, applicant, sharesRequested, , , , processed, didPass, aborted, tokenTribute, , maxTotalSharesAtYesVote) = moloch.proposalQueue(currentProposalIndex);

            if (processed && didPass && !aborted && sharesRequested > 0) {
                // passing grant proposal, mint pool shares proportionally on behalf of the applicant
                if (tokenTribute == 0) {
                    uint256 donorsToMint = totalPoolShares.mul(sharesRequested).div(maxTotalSharesAtYesVote);
                    _mintSharesForAddress(donorsToMint, applicant);
                }
            }
        }

        currentProposalIndex = toIndex;
    }

    // add tokens to the pool, mint new shares proportionally
    function deposit(uint256 tokenAmount) public active noReentrancy {

        uint256 sharesToMint = totalPoolShares.mul(tokenAmount).div(approvedToken.balanceOf(address(this)));

        require(approvedToken.transferFrom(msg.sender, address(this), tokenAmount));

        _mintSharesForAddress(sharesToMint, msg.sender);
    }

    // burn shares to proportionally withdraw tokens in pool
    function withdraw(uint256 sharesToBurn) public active noReentrancy {
        _withdraw(msg.sender, sharesToBurn);
    }

    // keeper burns shares to withdraw on behalf of the donor
    function keeperWithdraw(uint256 sharesToBurn, address recipient) public active noReentrancy {
        require(donors[recipient].keepers[msg.sender]);

        _withdraw(recipient, sharesToBurn);
    }

    function addKeepers(address[] calldata newKeepers) external active noReentrancy {
        Donor storage donor = donors[msg.sender];

        for (uint256 i = 0; i < newKeepers.length; i++) {
            donor.keepers[newKeepers[i]] = true;
        }
    }

    function removeKeepers(address[] calldata keepersToRemove) external active noReentrancy {
        Donor storage donor = donors[msg.sender];

        for (uint256 i = 0; i < keepersToRemove.length; i++) {
            donor.keepers[keepersToRemove[i]] = false;
        }
    }

    function _mintSharesForAddress(uint256 sharesToMint, address recipient) internal {
        totalPoolShares = totalPoolShares.add(sharesToMint);
        donors[recipient].shares = donors[recipient].shares.add(sharesToMint);
    }

    function _withdraw(address recipient, uint256 sharesToBurn) internal {
        Donor storage donor = donors[recipient];

        require(donor.shares >= sharesToBurn);

        uint256 tokensToWithdraw = approvedToken.balanceOf(address(this)).mul(sharesToBurn).div(totalPoolShares);

        totalPoolShares = totalPoolShares.sub(sharesToBurn);
        donor.shares = donor.shares.sub(sharesToBurn);

        require(approvedToken.transfer(recipient, tokensToWithdraw));
    }

}
