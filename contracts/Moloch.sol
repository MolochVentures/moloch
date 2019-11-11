pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";
import "./GuildBank.sol";

contract Moloch {
    using SafeMath for uint256;

    // ****************
    // GLOBAL CONSTANTS
    // ****************
    uint256 public periodDuration; // default = 17280 = 4.8 hours in seconds (5 periods per day)
    uint256 public votingPeriodLength; // default = 35 periods (7 days)
    uint256 public gracePeriodLength; // default = 35 periods (7 days)
    uint256 public emergencyExitWait; // default = 35 periods (7 days) - if proposal has not been processed after this time, its logic will be skipped
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
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

    // ***************
    // EVENTS
    // ***************
    event SubmitProposal(uint256 proposalIndex, address indexed delegateKey, address indexed memberAddress, address indexed applicant, uint256 tributeOffered, uint256 sharesRequested);
    event SubmitVote(uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
    event ProcessProposal(uint256 indexed proposalIndex, address indexed applicant, address indexed memberAddress, uint256 tributeOffered, uint256 sharesRequested, bool didPass);
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn);
    event CancelProposal(uint256 indexed proposalIndex, address applicantAddress);
    event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey);
    event SummonComplete(address indexed summoner, uint256 shares);

    // *******************
    // INTERNAL ACCOUNTING
    // *******************
    uint256 public proposalCount = 0; // total proposals submitted
    uint256 public totalShares = 0; // total shares across all members
    uint256 public totalSharesRequested = 0; // total shares that have been requested in unprocessed proposals

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
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        address proposer; // whoever submitted the proposal (can be non-member)
        address sponsor; // the member who sponsored the proposal
        uint256 sharesRequested; // the # of shares the applicant is requesting
        uint256 tributeOffered; // amount of tokens offered as tribute
        IERC20 tributeToken; // token being offered as tribute
        uint256 paymentRequested; // the payments requested for each applicant
        IERC20 paymentToken; // token to send payment in
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool[6] flags; // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
        // 0. sponsored - true only if the proposal has been submitted by a member
        // 1. processed - true only if the proposal has been processed
        // 2. didPass - true only if the proposal passed
        // 3. cancelled - true only if the proposer called cancelProposal before a member sponsored the proposal
        // 4. whitelist - true only if this is a whitelist proposal, NOTE - tributeToken is target of whitelist
        // 5. guildkick - true only if this is a guild kick proposal, NOTE - applicant is target of guild kick
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping (address => bool) public tokenWhitelist;
    IERC20[] public approvedTokens;

    mapping (address => bool) public proposedToWhitelist; // true if a token has been proposed to the whitelist (to avoid duplicate whitelist proposals)
    mapping (address => bool) public proposedToKick; // true if a member has been proposed to be kicked (to avoid duplicate guild kick proposals)

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;

    // proposals by ID
    mapping (uint256 => Proposal) public proposals;

    // the queue of proposals (only store a reference by the proposal id)
    uint256[] public proposalQueue;

    // *********
    // MODIFIERS
    // *********
    modifier onlyMember {
        require(members[msg.sender].shares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    modifier onlyDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].shares > 0, "Moloch::onlyDelegate - not a delegate");
        _;
    }

    // *********
    // FUNCTIONS
    // *********
    constructor(
        address summoner,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _emergencyExitWait,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward
    ) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");
        require(_votingPeriodLength <= MAX_VOTING_PERIOD_LENGTH, "Moloch::constructor - _votingPeriodLength exceeds limit");
        require(_gracePeriodLength <= MAX_GRACE_PERIOD_LENGTH, "Moloch::constructor - _gracePeriodLength exceeds limit");
        require(_emergencyExitWait > 0, "Moloch::constructor - _emergencyExitWait cannot be 0");
        require(_dilutionBound > 0, "Moloch::constructor - _dilutionBound cannot be 0");
        require(_dilutionBound <= MAX_DILUTION_BOUND, "Moloch::constructor - _dilutionBound exceeds limit");
        require(_approvedTokens.length > 0, "Moloch::constructor - need at least one approved token");
        require(_proposalDeposit >= _processingReward, "Moloch::constructor - _proposalDeposit cannot be smaller than _processingReward");

        // first approved token is the deposit token
        depositToken = IERC20(_approvedTokens[0]);

        for (uint256 i=0; i < _approvedTokens.length; i++) {
            require(_approvedTokens[i] != address(0), "Moloch::constructor - _approvedToken cannot be 0");
            require(!tokenWhitelist[_approvedTokens[i]], "Moloch::constructor - duplicate approved token");
            tokenWhitelist[_approvedTokens[i]] = true;
            approvedTokens.push(IERC20(_approvedTokens[i]));
        }

        guildBank = new GuildBank();

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
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

    // ******************
    // PROPOSAL FUNCTIONS
    // ******************

    function submitProposal(
        address applicant,
        uint256 sharesRequested,
        uint256 tributeOffered,
        address tributeToken,
        uint256 paymentRequested,
        address paymentToken,
        string memory details
    )
        public
    {
        require(tokenWhitelist[tributeToken], "Moloch::submitProposal - tributeToken is not whitelisted");
        require(tokenWhitelist[paymentToken], "Moloch::submitProposal - payment is not whitelisted");
        require(applicant != address(0), "Moloch::submitProposal - applicant cannot be 0");

        // collect tribute from applicant and store it in the Moloch until the proposal is processed
        require(IERC20(tributeToken).transferFrom(msg.sender, address(this), tributeOffered), "Moloch::submitProposal - tribute token transfer failed");

        bool[6] memory flags;

        // create proposal...
        Proposal memory proposal = Proposal({
            applicant: applicant,
            proposer: msg.sender,
            sponsor: address(0),
            sharesRequested: sharesRequested,
            tributeOffered: tributeOffered,
            tributeToken: IERC20(tributeToken),
            paymentRequested: paymentRequested,
            paymentToken: IERC20(paymentToken),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            flags: flags,
            details: details,
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter

        // uint256 proposalIndex = proposalQueue.length.sub(1);
        // TODO emit SubmitProposal(proposalIndex, msg.sender, memberAddress, applicant, tributeOffered, sharesRequested);
    }

    function submitWhitelistProposal(address tokenToWhitelist, string memory details) public {
        require(tokenToWhitelist != address(0), "Moloch::submitWhitelistProposal - must provide token address");
        require(!tokenWhitelist[tokenToWhitelist], "Moloch::submitWhitelistProposal - can't already have whitelisted the token");

        bool[6] memory flags;
        flags[4] = true; // whitelist proposal = true

        // create proposal ...
        Proposal memory proposal = Proposal({
            applicant: address(0),
            proposer: msg.sender,
            sponsor: address(0),
            sharesRequested: 0,
            tributeOffered: 0,
            tributeToken: IERC20(tokenToWhitelist), // tributeToken = tokenToWhitelist
            paymentRequested: 0,
            paymentToken: IERC20(address(0)),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            flags: flags,
            details: details,
            maxTotalSharesAtYesVote: 0
        });


        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter

        // uint256 proposalIndex = proposalQueue.length.sub(1);
        // TODO emit SubmitProposal(proposalIndex, msg.sender, memberAddress, applicant, tributeOffered, sharesRequested);
    }

    function submitGuildKickProposal(address memberToKick, string memory details) public {
        require(members[memberToKick].shares > 0, "Moloch::submitGuildKickProposal - member must have at least one share");

        bool[6] memory flags;
        flags[5] = true; // guild kick proposal = true

        // create proposal ...
        Proposal memory proposal = Proposal({
            applicant: memberToKick, // applicant = memberToKick
            proposer: msg.sender,
            sponsor: address(0),
            sharesRequested: 0,
            tributeOffered: 0,
            tributeToken: IERC20(address(0)),
            paymentRequested: 0,
            paymentToken: IERC20(address(0)),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            flags: flags,
            details: details,
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal; // save proposal by its id
        proposalCount += 1; // increment proposal counter

        // uint256 proposalIndex = proposalQueue.length.sub(1);
        // TODO emit SubmitProposal(proposalIndex, msg.sender, memberAddress, applicant, tributeOffered, sharesRequested);
    }

    function sponsorProposal(uint256 proposalId) public onlyDelegate {
        // collect proposal deposit from proposer and store it in the Moloch until the proposal is processed
        require(depositToken.transferFrom(msg.sender, address(this), proposalDeposit), "Moloch::submitProposal - proposal deposit token transfer failed");

        Proposal memory proposal = proposals[proposalId];

        require(!proposal.flags[0], "Moloch::sponsorProposal - proposal has already been sponsored");
        require(!proposal.flags[3], "Moloch::sponsorProposal - proposal has been cancelled");

        // token whitelist proposal
        if (proposal.flags[4]) {
            require(!proposedToWhitelist[address(proposal.tributeToken)]); // already an active proposal to whitelist this token
            proposedToWhitelist[address(proposal.tributeToken)] = true;

        // gkick proposal
        } else if (proposal.flags[5]) {
            require(!proposedToKick[proposal.applicant]); // already an active proposal to kick this member
            proposedToKick[proposal.applicant] = true;

        // standard proposal
        } else {
            // Make sure we won't run into overflows when doing calculations with shares.
            // Note that totalShares + totalSharesRequested + sharesRequested is an upper bound
            // on the number of shares that can exist until this proposal has been processed.
            require(totalShares.add(totalSharesRequested).add(proposal.sharesRequested) <= MAX_NUMBER_OF_SHARES, "Moloch::submitProposal - too many shares requested");
            totalSharesRequested = totalSharesRequested.add(proposal.sharesRequested);
        }

        // compute startingPeriod for proposal
        uint256 startingPeriod = max(
            getCurrentPeriod(),
            proposalQueue.length == 0 ? 0 : proposals[proposalQueue[proposalQueue.length.sub(1)]].startingPeriod
        ).add(1);

        proposal.startingPeriod = startingPeriod;

        address memberAddress = memberAddressByDelegateKey[msg.sender];
        proposal.sponsor = memberAddress;

        // ... and append it to the queue by its id
        proposalQueue.push(proposalId);

        // uint256 proposalIndex = proposalQueue.length.sub(1);
        // emit SponsorProposal(proposalId, proposalIndex, msg.sender, memberAddress, applicant, tributeOffered, sharesRequested);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "Moloch::submitVote - proposal does not exist");
        Proposal storage proposal = proposals[proposalQueue[proposalIndex]];

        require(uintVote < 3, "Moloch::submitVote - uintVote must be less than 3");
        Vote vote = Vote(uintVote);

        require(proposal.flags[0], "Moloch::submitVote - proposal has not been sponsored");
        require(getCurrentPeriod() >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");

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

    function processProposal(uint256 proposalIndex) public {
        require(proposalIndex < proposalQueue.length, "Moloch::processProposal - proposal does not exist");
        Proposal storage proposal = proposals[proposalQueue[proposalIndex]];

        require(getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.flags[1] == false, "Moloch::processProposal - proposal has already been processed");
        require(proposalIndex == 0 || proposals[proposalQueue[proposalIndex.sub(1)]].flags[1], "Moloch::processProposal - previous proposal must be processed");

        proposal.flags[1] = true;
        totalSharesRequested = totalSharesRequested.sub(proposal.sharesRequested);

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // If emergencyExitWait has passed from when this proposal *should* have been able to be processed, skip all effects
        bool emergencyProcessing = false;
        if (getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength).add(emergencyExitWait)) {
            emergencyProcessing = true;
            didPass = false;
        }

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares.mul(dilutionBound) < proposal.maxTotalSharesAtYesVote) {
            didPass = false;
        }

        // Make sure there is enough tokens for payments, or auto-fail
        if (proposal.paymentRequested >= proposal.paymentToken.balanceOf(address(guildBank))) {
            didPass = false;
        }

        // PROPOSAL PASSED
        if (didPass) {

            proposal.flags[2] = true; // didPass = true

            // whitelist proposal passed, add token to whitelist
            if (proposal.flags[4]) {
               tokenWhitelist[address(proposal.tributeToken)] = true;
               approvedTokens.push(proposal.tributeToken);

            // guild kick proposal passed, ragequit 100% of the member's shares
            // NOTE - if any approvedToken is broken gkicks will fail and get stuck here (until emergency processing)
            } else if (proposal.flags[5]) {
                _ragequit(members[proposal.applicant].shares, approvedTokens);

            // standard proposal passed, collect tribute, send payment, mint shares
            } else {
                // if the applicant is already a member, add to their existing shares
                if (members[proposal.applicant].exists) {
                    members[proposal.applicant].shares = members[proposal.applicant].shares.add(proposal.sharesRequested);

                // the applicant is a new member, create a new record for them
                } else {
                    // if the applicant address is already taken by a member's delegateKey, reset it to their member address
                    if (members[memberAddressByDelegateKey[proposal.applicant]].exists) {
                        address memberToOverride = memberAddressByDelegateKey[proposal.applicant];
                        memberAddressByDelegateKey[memberToOverride] = memberToOverride;
                        members[memberToOverride].delegateKey = memberToOverride;
                    }

                    // use applicant address as delegateKey by default
                    members[proposal.applicant] = Member(proposal.applicant, proposal.sharesRequested, true, 0);
                    memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
                }

                // mint new shares
                totalShares = totalShares.add(proposal.sharesRequested);

                // transfer tribute tokens to guild bank
                require(
                    proposal.tributeToken.transfer(address(guildBank), proposal.tributeOffered),
                    "Moloch::processProposal - token transfer to guild bank failed"
                );

                // transfer payment tokens to applicant
                require(
                    guildBank.withdrawToken(proposal.paymentToken, proposal.applicant, proposal.paymentRequested),
                    "Moloch::processProposal - token payment to applicant failed"
                );
            }

        // PROPOSAL FAILED
        } else {
            // Don't return applicant tokens if we are in emergency processing - likely the tokens are broken
            if (!emergencyProcessing) {
                // return all tokens to the proposer
                require(
                    proposal.tributeToken.transfer(proposal.proposer, proposal.tributeOffered),
                    "Moloch::processProposal - failing vote token transfer failed"
                );
            }
        }

        // if token whitelist proposal, remove token from tokens proposed to whitelist
        if (proposal.flags[4]) {
            proposedToWhitelist[address(proposal.tributeToken)] = false;
        }

        // if guild kick proposal, remove member from list of members proposed to be kicked
        if (proposal.flags[5]) {
            proposedToKick[proposal.applicant] = false;
        }

        // send msg.sender the processingReward
        require(
            depositToken.transfer(msg.sender, processingReward),
            "Moloch::processProposal - failed to send processing reward to msg.sender"
        );

        // return deposit to sponsor (subtract processing reward)
        require(
            depositToken.transfer(proposal.sponsor, proposalDeposit.sub(processingReward)),
            "Moloch::processProposal - failed to return proposal deposit to sponsor"
        );

        // TODO emit ProcessProposal()
    }

    function ragequit(uint256 sharesToBurn) public onlyMember {
        _ragequit(sharesToBurn, approvedTokens);
    }

    function safeRagequit(uint256 sharesToBurn, IERC20[] memory tokenList) public onlyMember {
        // all tokens in tokenList must be in the tokenWhitelist
        for (uint256 i=0; i < tokenList.length; i++) {
            require(tokenWhitelist[address(tokenList[i])], "Moloch::safeRequit - token must be whitelisted");

            // check token uniqueness - for every token address after the first, enforce ascending lexical order
            if (i > 0) {
                require(tokenList[i] > tokenList[i-1], "Moloch::safeRagequit - tokenList must be unique and in ascending order");
            }
        }

        _ragequit(sharesToBurn, tokenList);
    }

    function _ragequit(uint256 sharesToBurn, IERC20[] memory approvedTokens) internal {
        uint256 initialTotalShares = totalShares;

        Member storage member = members[msg.sender];

        require(member.shares >= sharesToBurn, "Moloch::ragequit - insufficient shares");

        require(canRagequit(member.highestIndexYesVote), "Moloch::ragequit - cant ragequit until highest index proposal member voted YES on is processed");

        // burn shares
        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        // instruct guildBank to transfer fair share of tokens to the ragequitter
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares, approvedTokens),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn);
    }

    function cancelProposal(uint256 proposalId) public {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.flags[0], "Moloch::cancelProposal - proposal has already been sponsored");
        require(msg.sender == proposal.proposer, "Moloch::cancelProposal - only the proposer can cancel");

        proposal.flags[3] = true; // cancelled

        require(
            proposal.tributeToken.transfer(proposal.proposer, proposal.tributeOffered),
            "Moloch::processProposal - failed to return tribute to proposer"
        );

        emit CancelProposal(proposalId, msg.sender);
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

    // ****************
    // GETTER FUNCTIONS
    // ****************

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
        return proposals[proposalQueue[highestIndexYesVote]].flags[1]; // processed
    }

    function hasVotingPeriodExpired(uint256 startingPeriod) public view returns (bool) {
        return getCurrentPeriod() >= startingPeriod.add(votingPeriodLength);
    }

    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        require(members[memberAddress].exists, "Moloch::getMemberProposalVote - member doesn't exist");
        require(proposalIndex < proposalQueue.length, "Moloch::getMemberProposalVote - proposal doesn't exist");
        return proposals[proposalQueue[proposalIndex]].votesByMember[memberAddress];
    }
}
