// TODO LATER
// - spam prevention
// - member ragequit whitelists
// - loot token discussion

// Goals
// - Safe Approvals (two-phase)
// - Multi-applicant proposals
// - ERC20 support
// - ERC20 rebalancing
// - Vote delegation
// - [TODO] Fund Safety (member ragequit whitelists)
// - Guild Kick
// - [TODO] Spam Protection
// - Contract Interaction
// - [TODO] Separation of Voting Power and Capital (bring back loot tokens)

// Usage Patterns To Support
// - rDAI investing (interest rate swaps)
// - provide liquidity on uniswap
// - open a CDP

// Fund Safety
// - keeper addresses that can also ragequit funds
//   - revisit moloch pool
// - whitelist of addresses that can be ragequit to
//   - must take some time to update
//     - use a constructor param
//   - if attacker has member key and member address isn't whitelisted, they have to update the whitelist first before they can ragequit to steal funds
//     - in this case, our best move is to ragequit the funds to a whitelisted address before the attacker adds their address to the whitelist
// - default is member address
// - must have at least 1 whitelist address
//   - track w/ "whitelist length"

// Spam Protection
// - non-linearly increasing proposal deposit cost for the same member to submit multiple proposals
//  - processing fee as a % of proposal deposit
//  - donation as a % of proposal deposit to the Guild Bank (or a Pool)
//  - fee % and donation % can increase non-linearly as well-
// - accepts a param as the exponential rate (X ^ num proposals sponsored)
//   - store sponsored proposals on member
//   - increment on sponsor, deduct on processProposal
//     - leave unchanged on ragequit

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
// - extremely dangerous if the proxy contract has a suicide function because then it could be replaced

// Separation of Voting Power and Capital
// - bring back Loot Tokens
// - TODO open for conversation
// - proposals specify loot tokens to mint
//   - convertSharesToLoot (shares -> loot tokens)
//   - ragequit wraps convertSharesToLoot -> redeemLootTokens
//   - redeemLootTokens (on guildbank or moloch?)

// Open Questions
// - Should we keep the 1 week voting / grace periods?
// - Should we cap # of applicants per proposal?
// - Prevent duplicate gkick proposals?

// TODO Eventually
// - create an aragon DAO
// - create a DAOStack DAO
// - EIP 1066 for standard return format
// - investigate SOLTTY - compile functions on demand
//   - https://devpost.com/software/sol-tty
//   - https://github.com/BencicAndrej/sol.tty

pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";
import "./GuildBank.sol";

contract MolochVentures {
    using SafeMath for uint256;

    /***************
    GLOBAL CONSTANTS
    ***************/
    uint256 public periodDuration; // default = 17280 = 4.8 hours in seconds (5 periods per day)
    uint256 public votingPeriodLength; // default = 35 periods (7 days)
    uint256 public gracePeriodLength; // default = 35 periods (7 days)
    uint256 public abortWindow; // default = 5 periods (1 day)
    uint256 public emergencyExitWait; // default = 35 periods (7 days) - if proposal has not been processed after this time, its logic will be skipped
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
    uint256 public maxDelegates; // default = 100 - the maximum # of delegates per member

    uint256 public summoningTime; // needed to determine the current period

    IERC20 public depositToken; // reference to the deposit token
    GuildBank public guildBank; // guild bank contract reference

    // HARD-CODED LIMITS
    // These numbers are quite arbitrary; they are small enough to avoid overflows when doing calculations
    // with periods or shares, yet big enough to not limit reasonable use cases.
    uint256 constant MAX_VOTING_PERIOD_LENGTH = 10**18; // maximum length of voting period
    uint256 constant MAX_GRACE_PERIOD_LENGTH = 10**18; // maximum length of grace period
    uint256 constant MAX_DILUTION_BOUND = 10**18; // maximum dilution bound
    uint256 constant MAX_NUMBER_OF_SHARES = 10**18; // maximum number of shares that can be minted

    uint256 public constant UINT_MAX = 2**256 - 1;

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

    // Linked list item for proposal votes by member
    // NOTE - uses proposal index instead of id to enforce order without needing additional lookup by ID
    struct LinkedVote {
        uint256 proposalIndex;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 prevProposalIndex;
    }

    struct Member {
        uint256 shares; // the # of shares assigned to this member
        bool exists; // always true once a member has been created
        address[] delegateKeys; // delegates responsible for submitting proposals and voting - defaults to member address unless updated
        mapping (address => uint256) delegatedVotes; // votes assigned to each delegate
        mapping (uint256 => LinkedVote) linkedVotes; // yes and no votes per proposal, stored as a linked list
    }

    struct Proposal {
        uint256 index; // the index of the proposal in the proposalQueue (used to reference the prev proposal in queue)
        address proposer; // the member who submitted the proposal
        address[] applicants; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256[] sharesRequested; // the # of shares the applicant is requesting
        uint256[] tokenTributes; // amount of tokens offered as tribute
        address tributeToken; // token being offered as tribute
        uint256[] paymentsRequested; // the payments requested for each applicant
        address paymentToken; // token to send payment in
        address proxyAddress; // address of proxy contract to interact with
        bytes proxyPayload; // payload to send to proxy contract
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool sponsored; // true only if the proposal has been submitted by a member
        bool processed; // true only if the proposal has been processed
        bool didPass; // true only if the proposal passed
        bool aborted; // true only if applicant calls "abort" fn before end of voting period
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        address tokenToWhitelist; // the address of the token to add to the whitelist
        address memberToKick; // the address of the member to guild kick
        mapping (address => Vote) votesByDelegate; // the votes on this proposal by each delegate
    }

    mapping (address => IERC20) public tokenWhitelist;
    IERC20[] approvedTokens;

    mapping (address => bool) public proposedToWhitelist; // true if a token has been proposed to the whitelist (to avoid duplicate whitelist proposals)

    mapping (address => Member) public members;

    // proposals by ID
    mapping (uint256 => Proposal) public proposals;

    // the queue of proposals (only store a reference by the proposal id)
    uint256[] public proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyMember {
        require(members[msg.sender].shares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    modifier onlyAuthorizedProxy {
        require(msg.sender == authorizedProxy); // must be called by authorizedProxy
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
        uint256 _emergencyExitWait,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward,
        uint256 _maxDelegates
    ) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");
        require(_votingPeriodLength <= MAX_VOTING_PERIOD_LENGTH, "Moloch::constructor - _votingPeriodLength exceeds limit");
        require(_gracePeriodLength <= MAX_GRACE_PERIOD_LENGTH, "Moloch::constructor - _gracePeriodLength exceeds limit");
        require(_abortWindow > 0, "Moloch::constructor - _abortWindow cannot be 0");
        require(_abortWindow <= _votingPeriodLength, "Moloch::constructor - _abortWindow must be smaller than or equal to _votingPeriodLength");
        require(_emergencyExitWait > 0, "Moloch::constructor - _emergencyExitWait cannot be 0");
        require(_dilutionBound > 0, "Moloch::constructor - _dilutionBound cannot be 0");
        require(_dilutionBound <= MAX_DILUTION_BOUND, "Moloch::constructor - _dilutionBound exceeds limit");
        require(_proposalDeposit >= _processingReward, "Moloch::constructor - _proposalDeposit cannot be smaller than _processingReward");
        require(_approvedTokens.length > 0); // at least 1 approved token
        require(_maxDelegates > 0); // at least 1 delegate per member

        // first approved token is the deposit token
        depositToken = IERC20(_approvedTokens[0]);

        for (var i=0; i < _approvedTokens.length; i++) {
            require(_approvedToken != address(0), "Moloch::constructor - _approvedToken cannot be 0");
            require(!tokenWhitelist[_approvedTokens[i]], "Moloch::constructor - duplicate approved token");
            tokenWhitelist[_approvedTokens[i]] = IERC20(_approvedTokens[i]);
            approvedTokens.push(IERC20(_approvedTokens[i]));
        }

        guildBank = new GuildBank(address(this));

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        abortWindow = _abortWindow;
        emergencyExitWait = _emergencyExitWait;
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
        address proxyAddress,
        bytes proxyPayload,
        string memory details
    )
        public
    {
        require(applicant != address(0), "Moloch::submitProposal - applicant cannot be 0");

        require(applicants.length == sharesRequested.length);
        require(applicants.length == tokenTributes.length);
        require(applicants.length == paymentsRequested.length);

        // TODO make sure this works
        require(tokenWhitelist[tributeToken]);
        require(tokenWhitelist[paymentToken]);

        // create proposal ...
        Proposal memory proposal = Proposal({
            index: 0,
            proposer: address(0),
            applicants: applicants,
            sharesRequested: sharesRequested,
            tokenTributes: tokenTributes,
            tributeToken: tributeToken,
            paymentsRequested; paymentsRequested,
            paymentToken: paymentToken,
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            sponsored: false,
            processed: false,
            didPass: false,
            aborted: false,
            details: details,
            tokenToWhitelist: address(0),
            memberToKick: address(0),
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter
    }

    function submitWhitelistProposal(address tokenToWhitelist) public {
        require(tokenToWhitelist != address(0), "Moloch::submitProposal - applicant cannot be 0");
        require(!tokenWhitelist[tokenToWhitelist]); // can't already have whitelisted the token

        // create proposal ...
        Proposal memory proposal = Proposal({
            index: 0,
            proposer: address(0),
            applicants: new address[](0),
            sharesRequested: new uint256[](0),
            tokenTributes: new uint256[](0),
            tributeToken: address(0),
            paymentsRequested; new uint256[](0),
            paymentToken: address(0),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            sponsored: false,
            processed: false,
            didPass: false,
            aborted: false,
            details: details,
            tokenToWhitelist: tokenToWhitelist,
            memberToKick: address(0),
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter
    }

    function submitGuildKickProposal(address memberToKick) public {
        require(memberToKick != address(0), "Moloch::submitProposal - applicant cannot be 0");

        // create proposal ...
        Proposal memory proposal = Proposal({
            index: 0,
            proposer: address(0),
            applicants: new address[](0),
            sharesRequested: new uint256[](0),
            tokenTributes: new uint256[](0),
            tributeToken: address(0),
            paymentsRequested; new uint256[](0),
            paymentToken: address(0),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            sponsored: false,
            processed: false,
            didPass: false,
            aborted: false,
            details: details,
            tokenToWhitelist: address(0),
            memberToKick: memberToKick,
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter
    }

    // TODO include memberAddress we are sponsoring on behalf of
    // - only need 1 member for this to work
    function sponsorProposal(
        uint256 proposalId,
        address memberAddress
    )
        public
    {
        require(members[memberAddress].delegatedVotes[msg.sender] > 0); // some member must have delegated at least 1 vote to this address in order to sponsor

        // collect proposal deposit from proposer and store it in the Moloch until the proposal is processed
        require(depositToken.transferFrom(msg.sender, address(this), proposalDeposit), "Moloch::submitProposal - proposal deposit token transfer failed");

        Proposal memory proposal = proposals[proposalId];

        require(!proposal.sponsored, "Moloch::sponsorProposal - proposal has already been sponsored");
        require(!proposal.aborted); // proposal has been aborted

        // token whitelist proposal
        if (proposal.tokenToWhitelist != address(0)) {
            require(!proposedToWhitelist[proposal.tokenToWhitelist]); // already an active proposal to whitelist this token
            proposedToWhitelist[proposal.tokenToWhitelist] = true;

        // gkick proposal
        } else if (proposal.memberToKick != address(0)) {
           // TODO - prevent duplicate gkick proposals like we do for token whitelist?
           // - otherwise we don't really need to do anything here...
        }

        // standard proposal
        } else {
            for (var j=0; j < proposal.applicants.length; j++) {
                // collect tribute from applicant and store it in the Moloch until the proposal is processed
                require(IERC20(proposal.tributeToken).transferFrom(proposal.applicants[j], address(this), proposal.tokenTributes[j]), "Moloch::submitProposal - tribute token transfer failed");
            }

            uint256 memory proposalSharesRequested = 0;
            for (var i=0; i < proposal.sharesRequested.length; i++) {
                proposalSharesRequested = proposalSharesRequested + proposal.sharesRequested[i];
            }

            // Make sure we won't run into overflows when doing calculations with shares.
            // Note that totalShares + totalSharesRequested + sharesRequested is an upper bound
            // on the number of shares that can exist until this proposal has been processed.
            require(totalShares.add(totalSharesRequested).add(proposalSharesRequested) <= MAX_NUMBER_OF_SHARES, "Moloch::submitProposal - too many shares requested");

            totalSharesRequested = totalSharesRequested.add(proposalSharesRequested);
        }

        // compute startingPeriod for proposal
        uint256 startingPeriod = max(
            getCurrentPeriod(),
            proposalQueue.length == 0 ? 0 : proposals[proposalQueue[proposalQueue.length.sub(1)]].startingPeriod
        ).add(1);

        proposal.startingPeriod = startingPeriod;
        proposal.proposer = msg.sender;
        proposal.index = proposalQueue.length;

        // ... and append it to the queue by its id
        proposalQueue.push(proposalId);

        uint256 proposalIndex = proposalQueue.length.sub(1);
        // emit SponsorProposal(proposalId, proposalIndex, msg.sender, memberAddress, applicant, tokenTribute, sharesRequested);
    }

    // nextProposalVotesIndices[] is either UINT_MAX or the next highest proposal index that the member has voted on
    // - it will either point to the proposal currently being voted on (if the member has already voted on this proposal with a diff delegate)
    // - OR it will point to proposal index below the proposal currently being voted on (if the member has NOT already voted on this proposal)
    function submitVote(uint256 proposalId, uint8 uintVote, address[] votingMembers, uint256[] nextProposalVotesIndices) public {
        require(votingMembers.length > 0); // have to be voting for at least 1 member
        require(votingMembers.length = nextProposalVotes.length);

        Proposal storage proposal = proposals[proposalId];

        require(uintVote < 3, "Moloch::submitVote - uintVote must be less than 3");
        Vote vote = Vote(uintVote);

        require(proposal.sponsored); // proposal has not been sponsored
        require(getCurrentPeriod() >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByDelegate[msg.sender] == Vote.Null, "Moloch::submitVote - delegate has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        require(!proposal.aborted, "Moloch::submitVote - proposal has been aborted");

        // TODO edge case - what happens if a member updates delegates after already using 100% of their votes for a proposal, then a new delegate votes on their behalf?
        // - need a way for delegates to filter out members whose voting power for a proposal has been exhausted before calling submitVote
        // - this adds some offchain data processing complexity
        // TODO edge case - I (delegate) have several members who delegate to me, and then vote on a bunch of proposals out of order
        // - need to track offchain (and update) the nextProposalVotesIndices in between each call to submitVote

        uint256 totalVotes = 0;
        for (var i=0; i < votingMembers.length; i++) {
            Member storage member = members[votingMembers[i]];
            uint256 delegatedVotes = member.delegatedVotes[msg.sender];
            require(delegatedVotes > 0); // member has not delegated any votes to this delegate

            uint256 nextProposalVoteIndex = nextProposalVotesIndices[i];

            // check whether the member can vote on this proposal
            // - lookup votes by the nextProposalVotes
            // - needs to resolve to either the index of this proposal or lower
            LinkedVote storage linkedVote = member.linkedVotes[nextProposalVoteIndex];
            require(linkedVote.proposalIndex <= proposalIndex);

            // TODO refactor the code below to combine
            // member has voted on this proposal already, add to their votes
            if (linkedVote.proposalIndex == proposalIndex) {
                require(linkedVote.yesVotes.add(linkedVote.noVotes).add(delegatedVotes) <= member.shares); // votes per proposal can't exceed shares

                if (vote == Vote.Yes) {
                    linkedVote.yesVotes = linkedVote.yesVotes.add(delegatedVotes);
                } else if (vote == Vote.No) {
                    linkedVote.noVotes = linkedVote.noVotes.add(delegatedVotes);
                }

            // member has not voted on this proposal yet, insert it into the linked list of proposal votes
            } else {
                if (vote == Vote.Yes) {
                    member.linkedVotes[nextProposalVoteIndex] = LinkedVote(proposalIndex, delegatedVotes, 0, linkedVote.proposalIndex);
                } else if (vote == Vote.No) {
                    member.linkedVotes[nextProposalVoteIndex] = LinkedVote(proposalIndex, 0, delegatedVotes, linkedVote.proposalIndex);
                }

                // point the current proposal index to the linkedVote (which is a lower-index proposal than the current one)
                member.linkedVotes[proposalIndex] = linkedVote;
            }

            proposal.votesByDelegate[msg.sender] = vote;
            totalVotes = totalVotes.add(delegatedVotes);
        }

        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(totalVotes);

            // set maximum of total shares encountered at a yes vote - used to bound dilution for yes voters
            if (totalShares > proposal.maxTotalSharesAtYesVote) {
                proposal.maxTotalSharesAtYesVote = totalShares;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(totalVotes);
        }

        // emit SubmitVote(proposalIndex, msg.sender, memberAddress, uintVote);
    }

    function processProposal(uint256 proposalId) public {
        Proposal storage proposal = proposals[proposalId];

        require(getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");
        require(proposal.index == 0 || proposals[proposalQueue[proposal.index.sub(1)]].processed, "Moloch::processProposal - previous proposal must be processed");

        proposal.processed = true; // will prevent re-entry of this function from the proxy call

        // TODO probably better to save total shares requested for a proposal to avoid needing to compute via loops multiple times
        uint256 memory proposalSharesRequested = 0;
        for (var i=0; i < proposal.sharesRequested.length; i++) {
            proposalSharesRequested = proposalSharesRequested + proposal.sharesRequested[i];
        }

        totalSharesRequested = totalSharesRequested.sub(proposal.proposalSharesRequested);

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // If emergencyExitWait has passed from when this proposal *should* have been able to be processed, skip all effects
        bool emergencyProcessing = false;
        if (getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength).add(emergencyExitWait) {
            emergencyProcessing = true;
            didPass = false;
        }

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares.mul(dilutionBound) < proposal.maxTotalSharesAtYesVote) {
            didPass = false;
        }

        // TODO - Possibly compute and store at submission?
        uint256 totalPaymentRequested = 0;
        for (var x=0; x < paymentsRequested.length; x++) {
            totalPaymentsRequested = totalPaymentsRequested + paymentsRequested[x];
        }

        // Make sure there is enough tokens for payments, or auto-fail
        if (IERC20(proposal.paymentToken).balanceOf(address(guildBank)) >= totalPaymentsRequested) {
            didPass = false;
        }

        // Note - We execute the proxy transaction here so that if it fails we can make the proposal fail
        // - if we are in emergency processing this will be skipped (didPass -> false)
        if (didPass && !proposal.aborted) {
            authorizedProxy = proposal.proxyAddress;
            // TODO
            // - very important that the proxy contract is audited to ensure that it returns true if it succeeds
            // - otherwise it could withdraw tokens and still receive tribute tokens back
            if (!executeCall(proposal.proxyAddress, proposal.proxyPayload)) {
                didPass = false
            }
            authorizedProxy = address(0);
        }

        // PROPOSAL PASSED
        if (didPass && !proposal.aborted) {

            proposal.didPass = true;

            // whitelist proposal passed, add token to whitelist
            if (proposal.tokenToWhitelist != address(0)) {
               tokenWhitelist[tokenToWhitelist] = IERC20(tokenToWhitelist);
               approvedTokens.push(IERC20(tokenToWhitelist));

            // ragequit 100% of the member's shares
            else if (proposal.memberToKick != address(0)) {
                // what happens if a token is broken?
                // - this proposal will get stuck until emergency processing
                // - everyone will probably be ragequitting anyways, so the gkick doesn't matter
                _ragequit(members[proposal.memberToKick].shares, new address[](0), new uint256[](0), approvedTokens);
            }

            // standard proposal passed, collect tribute, send payments, mint shares
            } else {

                for (var j=0; j < proposal.applicants.length; j++) {
                    address applicant = proposal.applicants[j];
                    uint256 sharesRequested = proposal.sharesRequested[j];
                    // if the applicant is already a member, add to their existing shares
                    if (members[applicant].exists) {
                        Member storage member = members[applicant];
                        member.shares = member.shares.add(sharesRequested);

                        address primaryDelegate = member.delegateKeys[0];

                        // assign new shares as voting power to the first delegate key for this member
                        member.delegatedVotes[primaryDelegate] = member.delegatedVotes[primaryDelegate].add(sharesRequested);

                    // the applicant is a new member, create a new record for them
                    } else {
                        // create a new member record - default use member address as the only delegate
                        members[applicant] = Member(shares, true);
                        members[applicant].delegateKeys.push(applicant);
                        members[applicant].delegatedVotes[applicant] = sharesRequested;

                        // Create a circular 2-item linked list for proposals votes for this member
                        // 0 (HEAD) -> UINT_MAX
                        // UINT_MAX (TAIL) -> 0
                        members[applicant].linkedVotes[0] = LinkedVote(UINT_MAX, 0, 0, 0);
                        members[applicant].linkedVotes[UINT_MAX] = LinkedVote(0, 0, 0, UINT_MAX);
                    }

                    // TODO technically this doesn't have to be looped over because it could be aggregated and sent once
                    // transfer tokens to guild bank
                    require(
                        IERC20(proposal.tributeToken).transfer(address(guildBank), proposal.tokenTributes[j]),
                        "Moloch::processProposal - token transfer to guild bank failed"
                    );

                    require(
                        guildBank.withdrawToken(proposal.paymentToken, applicant, proposal.paymentsRequested[j]),
                        "Moloch::processProposal - token payment to applicant failed"
                    );
                }

                // mint new shares
                totalShares = totalShares.add(proposalSharesRequested);
            }

        // PROPOSAL FAILED OR ABORTED
        } else {
            // Don't return applicant tokens if we are in emergency processing - likely the tokens are broken
            if (!emergencyProcessing) {
                for (var k=0; k < proposal.applicants.length; k++) {
                    // return all tokens to the applicants
                    require(
                        proposal.tributeToken.transfer(proposal.applicants[k], proposal.tokenTributes[k]),
                        "Moloch::processProposal - failing vote token transfer failed"
                    );
                }
            }
        }

        // if token whitelist proposal, remove token from tokens proposed to whitelist
        if (proposal.tokenToWhitelist != address(0)) {
            proposedToWhitelist[proposal.tokenToWhitelist] = false;
        }

        // send msg.sender the processingReward
        require(
            depositToken.transfer(msg.sender, processingReward),
            "Moloch::processProposal - failed to send processing reward to msg.sender"
        );

        // return deposit to proposer (subtract processing reward)
        require(
            depositToken.transfer(proposal.proposer, proposalDeposit.sub(processingReward)),
            "Moloch::processProposal - failed to return proposal deposit to proposer"
        );

        /* TODO
        emit ProcessProposal(
            proposalIndex,
            proposal.applicants,
            proposal.proposer,
            proposal.tokenTributes,
            proposal.sharesRequested,
            didPass
        );*/
    }

    function ragequit(uint256 sharesToBurn, address[] newDelegateKeys, uint256[] newVotes) public onlyMember {
        _ragequit(sharesToBurn, newDelegateKeys, newVotes, approvedTokens);

        // emit Ragequit(msg.sender, sharesToBurn);
    }

    function safeRagequit(uint256 sharesToBurn, address[] newDelegateKeys, uint256[] newVotes, address[] tokenList) public onlyMember {
        // all tokens in tokenList must be in the tokenWhitelist
        for (var i=0; i < tokenList.length; i++) {
            require(tokenWhitelist[tokenList[i]]);
        }

        _ragequit(sharesToBurn, newDelegateKeys, newVotes, tokenList);

        // TODO emit SafeRagequit(msg.sender, sharesToBurn, tokenList);
    }

    function _ragequit(uint256 sharesToBurn, address[] newDelegateKeys, uint256[] newVotes, address[] approvedTokens) internal {
        uint256 initialTotalShares = totalShares;

        Member storage member = members[msg.sender];

        // This will start with the highest index proposal vote and loop backwards until it finds a processed proposal or completes the loop
        LinkedVote currentProposalVote = member.linkedVotes[UINT_MAX];
        uint256 proposalIndexPointer = currentProposalVote.proposalIndex;

        uint256 encumberedShares = 0;

        while(!proposals[proposalQueue[proposalIndexPointer]].processed && proposalIndexPointer != UINT_MAX) {
            if (currentProposalVote.yesVotes > encumberedShares) {
                encumberedShares = currentProposalVote.yesVotes;
            }
            currentProposalVote = member.linkedVotes[currentProposalVote.prevProposalIndex];
            proposalIndexPointer = currentProposalVote.proposalIndex;
        }

        require(sharesToBurn <= member.shares.sub(encumberedShares)); // can only ragequit unencumbered shares

        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        // this will make sure votes assigned to the new delegates match the new shares
        updateDelegates(newDelegateKeys, newVotes);

        // instruct guildBank to transfer fair share of tokens to the ragequitter
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares, approvedTokens),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );
    }

    function proxyWithdrawTokens(address tokenAddress, address receiver, uint256 amount) public onlyAuthorizedProxy {
        require(guildBank.withdrawToken(tokenAddress, receiver, amount));
    }

    function abort(uint256 proposalId) public {
        Proposal storage proposal = proposals[proposalId];

        bool isApplicant = false;
        for (var i=0; i < proposal.applicants.length; i++) {
            if (msg.sender == proposal.applicants[i]) {
                isApplicant = true;
                break;
            }
        }

        require(isApplicant, "Moloch::abort - msg.sender must be one of the applicants");
        require(!proposal.aborted, "Moloch::abort - proposal must not have already been aborted");

        proposal.aborted = true;

        // If sponsored, return all applicant funds
        if (proposal.sponsored) {
            require(getCurrentPeriod() < proposal.startingPeriod.add(abortWindow), "Moloch::abort - abort window must not have passed");

            for (var i=0; i < proposal.applicants.length; i++) {
                uint256 tokensToAbort = proposal.tokenTributes[i];
                proposals.tokenTributes[i] = 0; // prevents double-paying out the applicant when this proposal is processed

                // return all tokens to the applicant
                require(
                    IERC20(proposal.tributeToken).transfer(proposal.applicants[i], tokensToAbort),
                    "Moloch::processProposal - failed to return tribute to applicant"
                );
            }
        }

        // emit Abort(proposalIndex, msg.sender);
    }

    function updateDelegates(address[] newDelegateKeys, uint256[] newVotes) public onlyMember {
        require(newDelegateKeys.length <= maxDelegates); // too many delegates
        require(newDelegateKeys.length == newVotes.length);

        Member storage member = members[msg.sender];

        // remove votes for existing delegates
        for (var i=0; i < member.delegateKeys; i++) {
            member.delegatedVotes[member.delegateKeys[i]] = 0;
        }

        uint256 votesAssigned = 0;

        for (var i=0; i < newDelegateKeys.length; i++) {
            require(member.delegatedVotes[newDelegateKeys[i]] == 0); // prevent duplicate vote assignments
            member.delegatedVotes[newDelegateKeys[i]] = newVotes[i];
            votesAssigned = votesAssigned.add(newVotes[i]);
        }

        member.delegateKeys = newDelegateKeys;

        require(votesAssigned == member.shares); // must assign 100% of your votes to delegates
    }

    // https://github.com/gnosis/gnosis-safe-contracts/blob/master/contracts/GnosisSafe.sol
    function executeCall(address to, bytes data) internal returns (bool success) {
        assembly {
            success := call(gas, to, 0, add(data, 0x20), mload(data), 0, 0)
        }
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

    function hasVotingPeriodExpired(uint256 startingPeriod) public view returns (bool) {
        return getCurrentPeriod() >= startingPeriod.add(votingPeriodLength);
    }

    // TODO does this require ABI Encoder v2?
    // - does it make sense to use this elsewhere in the contract?
    function getProposalByIndex(uint256 proposalIndex) public view returns (Proposal) {
        return proposals[proposalQueue[proposalIndex]];
    }
}
