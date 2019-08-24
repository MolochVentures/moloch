// Goals
// - Safe Approvals (two-phase)
// - Multi-applicant proposals
// - ERC20 support
// - ERC20 rebalancing
// - Vote delegation
// - Fund Safety
// - Guild Kick
// - Spam Protection
// - Contract Interaction
// - Separation of Voting Power and Capital

// Usage Patterns
// - rDAI investing (interest rate swaps)
// - provide liquidity on uniswap
// - open a CDP

// Safe Approvals (two-phase)
// - function stageProposal
//   - can be called by anyone
//   - escrows funds
//   - specifies shares / proposal details
// - function submitProposal
//   - members only
// - function abortProposal
//   - any applicant of the proposal

// Multi-applicant proposals
// - stageProposal takes address[], shares[]
//   - allow multi-token tribute per member?

// ERC20 Support
// - ERC20 whitelist + safeRedeem
// - proposal field for "whitelistToken"
//   - check that tribute / shares are 0
//   - check that applicant is address(0)
//   - check that ERC20 is not already whitelisted
// - whitelist mapping
// - appovedTokens becomes array
//   - loop over it for ragequit
// - question -> where should approvedToken / whitelist live?
//   - Moloch? GuildBank? Both?
//   - Can GuildBank read from the approvedToken array?
//     - If yes, keep it on Moloch
//     - If no, keep a copy on the GuildBank and keep them synchronized
// - single token tribute / payment per proposal

// ERC20 Rebalancing
// - Proposals to send and receive individual tokens

// Vote Delegation
// - updateDelegates(address[] delegates, uint[] votes)
//   - How to prevent double voting?
//     1. prevent updating delegate if delegate has already voted on a proposal in the voting period, force wait until grace period
//     2. track member whose delegated votes are being used, make sure total votes for a proposal does not exceed member shares
//      - tricky because we need to loop over all members that have delegated to an address when it votes, might require loop
//     3. enforce 1 week (= to voting period) cooldown period for re-assigning shares
//      - tricky because it becomes an attack vector
//   - How to prevent circular delegation?
//     - loop through delegation target, either we find a circle, run out of gas, or find the terminus
//       - if we run out of gas or find a circle, error / fail
//       - otherwise OK

// Fund Safety
// - keeper addresses that can also ragequit funds
// - whitelist of addresses that can be ragequit to
// - force contract wallets?

// Guild Kick
// - proposal to burn shares for a member address
//   1. member address automatically receives tokens
//   2. to help with lost keys, we can also send the funds to an address besides the member address
//     1. obvious attack vector
//     2. might be redundant with authorized addresses to ragequit
//   3. burn shares but don’t give $
//     1. essentially forces member to ragequit to protect their $

// Spam Protection
// - non-linearly increasing proposal deposit cost for the same member to submit multiple proposals
//  - processing fee as a % of proposal deposit
//  - donation as a % of proposal deposit to the Guild Bank (or a Pool)
//  - fee % and donation % can increase non-linearly as well-

// Contract Interaction
// - need a proxy function
//   - take contract address, payload
//   - https://github.com/uport-project/uport-identity/blob/develop/contracts/Proxy.sol
//   - https://github.com/gnosis/safe-contracts/blob/master/contracts/GnosisSafe.sol
//   - stefan says these functions are sufficient
//     - how do we approve the proposal contract to call Moloch functions?
//       - add the contract as an agent before the proxy call
//       - remove the contract as an agent after the proxy call
//       - keeping this atomic is important to prevent replay attacks
//     - which functions does the proposal contract need to call?
//       - withdraw multiple ERC20 by address from the guild bank
//       - can it do multi-applicant x multi-token?
//         - if the applicants escrow funds on the proposal contract directly instead of Moloch
//         - then all that would happen is the contract would transfer all their funds to the guild bank
//         - proposal contract would need to read from proposal pass/fail status and only send funds if passing, otherwise return
//       - scenario -> exchange tokens on uniswap
//         1. proxy contract calls withdraw tokens on Moloch to withdraw from guild bank -> moloch -> proxy
//         2. proxy contract calls exchange on uniswap (params ensure minimum slippage or tx fails)
//         3. if success -> send swapped tokens back to guild bank
//         4. if failure -> send original tokens back to the guild bank
//         - note -> failure cases need to be carefully coded to prevent error or theft

// Separation of Voting Power and Capital
// - bring back Loot Tokens

function forward(address destination, uint value, bytes data) public onlyOwner {
    require(executeCall(destination, value, data));
    Forwarded(destination, value, data);
}

// copied from GnosisSafe
// https://github.com/gnosis/gnosis-safe-contracts/blob/master/contracts/GnosisSafe.sol
function executeCall(address to, uint256 value, bytes data) internal returns (bool success) {
    assembly {
        success := call(gas, to, value, add(data, 0x20), mload(data), 0, 0)
    }
}

// Open Questions
// - Should we keep the 1 week voting / grace periods?

// TODO
// - create an aragon DAO
// - create a DAOStack DAO

pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";
import "./GuildBank.sol";

contract Moloch {
    using SafeMath for uint256;

    /***************
    GLOBAL CONSTANTS
    ***************/
    uint256 public periodDuration; // default = 17280 = 4.8 hours in seconds (5 periods per day)
    uint256 public votingPeriodLength; // default = 35 periods (7 days)
    uint256 public gracePeriodLength; // default = 35 periods (7 days)
    uint256 public abortWindow; // default = 5 periods (1 day)
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
    uint256 public summoningTime; // needed to determine the current period

    GuildBank public guildBank; // guild bank contract reference

    // HARD-CODED LIMITS
    // These numbers are quite arbitrary; they are small enough to avoid overflows when doing calculations
    // with periods or shares, yet big enough to not limit reasonable use cases.
    uint256 constant MAX_VOTING_PERIOD_LENGTH = 10**18; // maximum length of voting period
    uint256 constant MAX_GRACE_PERIOD_LENGTH = 10**18; // maximum length of grace period
    uint256 constant MAX_DILUTION_BOUND = 10**18; // maximum dilution bound
    uint256 constant MAX_NUMBER_OF_SHARES = 10**18; // maximum number of shares that can be minted

    /***************
    EVENTS
    ***************/
    event SubmitProposal(uint256 proposalIndex, address indexed delegateKey, address indexed memberAddress, address indexed applicant, uint256 tokenTribute, uint256 sharesRequested);
    event SubmitVote(uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
    event ProcessProposal(uint256 indexed proposalIndex, address indexed applicant, address indexed memberAddress, uint256 tokenTribute, uint256 sharesRequested, bool didPass);
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn);
    event Abort(uint256 indexed proposalIndex, address applicantAddress);
    event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey);
    event SummonComplete(address indexed summoner, uint256 shares);

    /******************
    INTERNAL ACCOUNTING
    ******************/
    uint256 public proposalCount = 0; // total proposals submitted
    uint256 public totalShares = 0; // total shares across all members
    uint256 public totalSharesRequested = 0; // total shares that have been requested in unprocessed proposals

    address authorizedProxy = address(0); // used to authorize proxy contracts to execute functions

    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of shares assigned to this member
        bool exists; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES
    }

    struct Proposal {
        address proposer; // the member who submitted the proposal
        address[] applicants; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256[] sharesRequested; // the # of shares the applicant is requesting
        uint256[] tokenTributes; // amount of tokens offered as tribute
        address tributeToken; // token being offered as tribute
        uint256[] paymentsRequested; // the payments requested for each applicant
        address paymentToken; // token to send payment in
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool sponsored; // true only if the proposal has been submitted by a member
        bool processed; // true only if the proposal has been processed
        bool didPass; // true only if the proposal passed
        bool aborted; // true only if applicant calls "abort" fn before end of voting period
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping (address => bool) public tokenWhitelist;
    IERC20[] approvedTokens;

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;

    // proposals by ID
    mapping (uint => Proposal) public proposals;

    // TODO have this be an array of proposalIds to prevent duplicate storage
    Proposal[] public proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyMember {
        require(members[msg.sender].shares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    modifier onlyDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].shares > 0, "Moloch::onlyDelegate - not a delegate");
        _;
    }

    /********
    FUNCTIONS
    ********/

    constructor(
        address summoner,
        address _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _abortWindow,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward
    ) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");
        require(_votingPeriodLength <= MAX_VOTING_PERIOD_LENGTH, "Moloch::constructor - _votingPeriodLength exceeds limit");
        require(_gracePeriodLength <= MAX_GRACE_PERIOD_LENGTH, "Moloch::constructor - _gracePeriodLength exceeds limit");
        require(_abortWindow > 0, "Moloch::constructor - _abortWindow cannot be 0");
        require(_abortWindow <= _votingPeriodLength, "Moloch::constructor - _abortWindow must be smaller than or equal to _votingPeriodLength");
        require(_dilutionBound > 0, "Moloch::constructor - _dilutionBound cannot be 0");
        require(_dilutionBound <= MAX_DILUTION_BOUND, "Moloch::constructor - _dilutionBound exceeds limit");
        require(_proposalDeposit >= _processingReward, "Moloch::constructor - _proposalDeposit cannot be smaller than _processingReward");

        for (var i=0; i < _approvedTokens.length; i++) {
            require(_approvedToken != address(0), "Moloch::constructor - _approvedToken cannot be 0");
            require(!tokenWhitelist[_approvedTokens[i]], "Moloch::constructor - duplicate approved token");
            tokenWhitelist[_approvedTokens[i]] = true;
            approvedTokens.push(IERC20(_approvedTokens[i]));
        }

        guildBank = new GuildBank(_approvedToken);

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        abortWindow = _abortWindow;
        proposalDeposit = _proposalDeposit;
        dilutionBound = _dilutionBound;
        processingReward = _processingReward;

        summoningTime = now;

        members[summoner] = Member(summoner, 1, true, 0);
        memberAddressByDelegateKey[summoner] = summoner;
        totalShares = 1;

        emit SummonComplete(summoner, 1);
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/

    function submitProposal(
        address[] applicants,
        uint256[] sharesRequested,
        uint256[] tokenTributes,
        address tributeToken,
        uint256[] paymentsRequested,
        address paymentToken,
        string memory details
    )
        public
    {
        require(applicant != address(0), "Moloch::submitProposal - applicant cannot be 0");

        require(applicants.length == sharesRequested.length);
        require(applicants.length == tokenTributes.length);
        require(applicants.length == paymentsRequested.length);

        require(tokenWhitelist[tributeToken]);

        for (var j=0; j < applicants.length; j++) {
            // collect tribute from applicant and store it in the Moloch until the proposal is processed
            require(approvedToken.transferFrom(applicants[j], address(this), tokenTributes[j]), "Moloch::submitProposal - tribute token transfer failed");
        }

        // create proposal ...
        Proposal memory proposal = Proposal({
            proposer: address(0),
            applicants: applicants,
            sharesRequested: sharesRequested,
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            sponsored: false,
            processed: false,
            didPass: false,
            aborted: false,
            tokenTributes: tokenTributes,
            details: details,
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter
    }

    function sponsorProposal(
        uint256 proposalId
    )
        public
        onlyDelegate
    {
        address memberAddress = memberAddressByDelegateKey[msg.sender];

        // collect proposal deposit from proposer and store it in the Moloch until the proposal is processed
        require(approvedToken.transferFrom(msg.sender, address(this), proposalDeposit), "Moloch::submitProposal - proposal deposit token transfer failed");

        Proposal memory proposal = proposals[proposalId];

        uint256 memory proposalSharesRequested = 0;
        for (var i=0; i < proposal.sharesRequested.length; i++) {
            proposalSharesRequested = proposalSharesRequested + proposal.sharesRequested[i];
        }

        // Make sure we won't run into overflows when doing calculations with shares.
        // Note that totalShares + totalSharesRequested + sharesRequested is an upper bound
        // on the number of shares that can exist until this proposal has been processed.
        require(totalShares.add(totalSharesRequested).add(proposalSharesRequested) <= MAX_NUMBER_OF_SHARES, "Moloch::submitProposal - too many shares requested");

        totalSharesRequested = totalSharesRequested.add(proposalSharesRequested);


        require(!proposal.sponsored, "Moloch::sponsorProposal - proposal has already been sponsored");

        // compute startingPeriod for proposal
        uint256 startingPeriod = max(
            getCurrentPeriod(),
            proposalQueue.length == 0 ? 0 : proposalQueue[proposalQueue.length.sub(1)].startingPeriod
        ).add(1);

        proposal.startingPeriod = startingPeriod;
        proposal.proposer = msg.sender;

        // ... and append it to the queue
        proposalQueue.push(proposal);

        uint256 proposalIndex = proposalQueue.length.sub(1);
        // TODO emit SponsorProposal(proposalIndex, msg.sender, memberAddress, applicant, tokenTribute, sharesRequested);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "Moloch::submitVote - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        require(uintVote < 3, "Moloch::submitVote - uintVote must be less than 3");
        Vote vote = Vote(uintVote);

        require(getCurrentPeriod() >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        require(!proposal.aborted, "Moloch::submitVote - proposal has been aborted");

        // store vote
        proposal.votesByMember[memberAddress] = vote;

        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares);

            // set highest index (latest) yes vote - must be processed for member to ragequit
            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

            // set maximum of total shares encountered at a yes vote - used to bound dilution for yes voters
            if (totalShares > proposal.maxTotalSharesAtYesVote) {
                proposal.maxTotalSharesAtYesVote = totalShares;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares);
        }

        emit SubmitVote(proposalIndex, msg.sender, memberAddress, uintVote);
    }

    // TODO
    // - proposalQueue to track ids of proposals, then lookup by mapping
    function processProposal(uint256 proposalIndex) public {
        require(proposalIndex < proposalQueue.length, "Moloch::processProposal - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        require(getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");
        require(proposalIndex == 0 || proposalQueue[proposalIndex.sub(1)].processed, "Moloch::processProposal - previous proposal must be processed");

        // TODO probably better to save total shares requested for a proposal to avoid needing to compute via loops multiple times
        uint256 memory proposalSharesRequested = 0;
        for (var i=0; i < proposal.sharesRequested.length; i++) {
            proposalSharesRequested = proposalSharesRequested + proposal.sharesRequested[i];
        }

        proposal.processed = true;
        totalSharesRequested = totalSharesRequested.sub(proposal.proposalSharesRequested);

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares.mul(dilutionBound) < proposal.maxTotalSharesAtYesVote) {
            didPass = false;
        }

        // PROPOSAL PASSED
        if (didPass && !proposal.aborted) {

            proposal.didPass = true;

            for (var j=0; j < proposal.applicants.length; j++) {
                // if the applicant is already a member, add to their existing shares
                if (members[proposal.applicants[j]].exists) {
                    members[proposal.applicants[j]].shares = members[proposal.applicants[j]].shares.add(proposal.sharesRequested[j]);

                // the applicant is a new member, create a new record for them
                } else {
                    // if the applicant address is already taken by a member's delegateKey, reset it to their member address
                    if (members[memberAddressByDelegateKey[proposal.applicants[j]]].exists) {
                        address memberToOverride = memberAddressByDelegateKey[proposal.applicants[j]];
                        memberAddressByDelegateKey[memberToOverride] = memberToOverride;
                        members[memberToOverride].delegateKey = memberToOverride;
                    }

                    // use applicant address as delegateKey by default
                    members[proposal.applicants[j]] = Member(proposal.applicants[j], proposal.sharesRequested[j], true, 0);
                    memberAddressByDelegateKey[proposal.applicants[j]] = proposal.applicants[j];
                }

                // TODO technically this doesn't have to be looped over because it could be aggregated and sent once
                // transfer tokens to guild bank
                require(
                    approvedToken.transfer(address(guildBank), proposal.tokenTributes[j]),
                    "Moloch::processProposal - token transfer to guild bank failed"
                );
            }

            // mint new shares
            totalShares = totalShares.add(proposalSharesRequested);


        // PROPOSAL FAILED OR ABORTED
        } else {

            for (var k=0; k < proposal.applicants.length; k++) {
                // return all tokens to the applicants
                require(
                    approvedToken.transfer(proposal.applicants[k], proposal.tokenTributes[k]),
                    "Moloch::processProposal - failing vote token transfer failed"
                );
            }
        }

        // send msg.sender the processingReward
        require(
            approvedToken.transfer(msg.sender, processingReward),
            "Moloch::processProposal - failed to send processing reward to msg.sender"
        );

        // return deposit to proposer (subtract processing reward)
        require(
            approvedToken.transfer(proposal.proposer, proposalDeposit.sub(processingReward)),
            "Moloch::processProposal - failed to return proposal deposit to proposer"
        );

        emit ProcessProposal(
            proposalIndex,
            proposal.applicants,
            proposal.proposer,
            proposal.tokenTributes,
            proposal.sharesRequested,
            didPass
        );
    }

    function ragequit(uint256 sharesToBurn) public onlyMember {
        uint256 initialTotalShares = totalShares;

        Member storage member = members[msg.sender];

        require(member.shares >= sharesToBurn, "Moloch::ragequit - insufficient shares");

        require(canRagequit(member.highestIndexYesVote), "Moloch::ragequit - cant ragequit until highest index proposal member voted YES on is processed");

        // burn shares
        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        // instruct guildBank to transfer fair share of tokens to the ragequitter
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn);
    }

    function withdrawTokens(address tokenAddress, uint256 amount) public {
        //
    }


    // TODO
    // - convert to use id not index
    // - need to convert the whole damn contract...
    // - allow aborting propsosals EITHER in queue but in abortWindow OR not-yet-sponsored proposals
    function abort(uint256 proposalIndex) public {
        require(proposalIndex < proposalQueue.length, "Moloch::abort - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        require(msg.sender == proposal.applicant, "Moloch::abort - msg.sender must be applicant");
        require(getCurrentPeriod() < proposal.startingPeriod.add(abortWindow), "Moloch::abort - abort window must not have passed");
        require(!proposal.aborted, "Moloch::abort - proposal must not have already been aborted");

        uint256 tokensToAbort = proposal.tokenTribute;
        proposal.tokenTribute = 0;
        proposal.aborted = true;

        for (var i=0; i < proposal.applicants.length; i++) {
            // return all tokens to the applicant
            require(
                approvedToken.transfer(proposal.applicant, tokensToAbort),
                "Moloch::processProposal - failed to return tribute to applicant"
            );
        }

        emit Abort(proposalIndex, msg.sender);
    }

    function updateDelegateKey(address newDelegateKey) public onlyMember {
        require(newDelegateKey != address(0), "Moloch::updateDelegateKey - newDelegateKey cannot be 0");

        // skip checks if member is setting the delegate key to their member address
        if (newDelegateKey != msg.sender) {
            require(!members[newDelegateKey].exists, "Moloch::updateDelegateKey - cant overwrite existing members");
            require(!members[memberAddressByDelegateKey[newDelegateKey]].exists, "Moloch::updateDelegateKey - cant overwrite existing delegate keys");
        }

        Member storage member = members[msg.sender];
        memberAddressByDelegateKey[member.delegateKey] = address(0);
        memberAddressByDelegateKey[newDelegateKey] = msg.sender;
        member.delegateKey = newDelegateKey;

        emit UpdateDelegateKey(msg.sender, newDelegateKey);
    }

    /***************
    GETTER FUNCTIONS
    ***************/

    function max(uint256 x, uint256 y) internal pure returns (uint256) {
        return x >= y ? x : y;
    }

    function getCurrentPeriod() public view returns (uint256) {
        return now.sub(summoningTime).div(periodDuration);
    }

    function getProposalQueueLength() public view returns (uint256) {
        return proposalQueue.length;
    }

    // can only ragequit if the latest proposal you voted YES on has been processed
    function canRagequit(uint256 highestIndexYesVote) public view returns (bool) {
        require(highestIndexYesVote < proposalQueue.length, "Moloch::canRagequit - proposal does not exist");
        return proposalQueue[highestIndexYesVote].processed;
    }

    function hasVotingPeriodExpired(uint256 startingPeriod) public view returns (bool) {
        return getCurrentPeriod() >= startingPeriod.add(votingPeriodLength);
    }

    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        require(members[memberAddress].exists, "Moloch::getMemberProposalVote - member doesn't exist");
        require(proposalIndex < proposalQueue.length, "Moloch::getMemberProposalVote - proposal doesn't exist");
        return proposalQueue[proposalIndex].votesByMember[memberAddress];
    }
}
