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
    uint256 public emergencyExitWait; // default = 35 periods (7 days)
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
    uint256 public summoningTime; // needed to determine the current period

    IERC20 public depositToken; // deposit token contract reference; default = wETH
    GuildBank public guildBank; // guild bank contract reference

    // HARD-CODED LIMITS
    // These numbers are quite arbitrary; they are small enough to avoid overflows when doing calculations
    // with periods or shares, yet big enough to not limit reasonable use cases.
    uint256 constant MAX_VOTING_PERIOD_LENGTH = 10**18; // maximum length of voting period
    uint256 constant MAX_GRACE_PERIOD_LENGTH = 10**18; // maximum length of grace period
    uint256 constant MAX_DILUTION_BOUND = 10**18; // maximum dilution bound
    uint256 constant MAX_NUMBER_OF_SHARES_AND_LOOT = 10**18; // maximum number of shares that can be minted

    // ***************
    // EVENTS
    // ***************
    event SubmitProposal(uint256 proposalIndex, address indexed delegateKey, address indexed memberAddress, address indexed applicant, uint256 tributeOffered, uint256 sharesRequested);
    event SubmitVote(uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
    event ProcessProposal(uint256 indexed proposalIndex, address indexed applicant, address indexed memberAddress, uint256 tributeOffered, uint256 sharesRequested, bool didPass);
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn, uint256 lootToBurn);
    event CancelProposal(uint256 indexed proposalIndex, address applicantAddress);
    event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey);
    event SummonComplete(address indexed summoner, uint256 shares);

    // *******************
    // INTERNAL ACCOUNTING
    // *******************
    uint256 public proposalCount = 0; // total proposals submitted
    uint256 public totalSharesAndLoot = 0; // total shares across all members
    uint256 public totalSharesAndLootRequested = 0; // total shares that have been requested in unprocessed proposals

    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of voting shares assigned to this member
        uint256 loot; // the loot amount available to this member (combined with shares on ragequit)
        bool exists; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES
    }

    struct Proposal {
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals (doubles as guild kick target for gkick proposals)
        address proposer; // the account that submitted the proposal (can be non-member)
        address sponsor; // the member that sponsored the proposal (moving it into the queue)
        uint256 sharesRequested; // the # of shares the applicant is requesting
        uint256 lootRequested; // the amount of loot the applicant is requesting
        uint256 tributeOffered; // amount of tokens offered as tribute
        IERC20 tributeToken; // tribute token contract reference
        uint256 paymentRequested; // amount of tokens requested as payment
        IERC20 paymentToken; // payment token contract reference
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool[6] flags; // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        mapping(address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping(address => bool) public tokenWhitelist;
    IERC20[] public approvedTokens;

    mapping(address => bool) public proposedToWhitelist;
    mapping(address => bool) public proposedToKick;

    mapping(address => Member) public members;
    mapping(address => address) public memberAddressByDelegateKey;

    mapping(uint256 => Proposal) public proposals;

    uint256[] public proposalQueue;

    modifier onlyMember {
        require(members[msg.sender].shares > 0, "not a member");
        _;
    }

    modifier onlyDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].shares > 0, "not a delegate");
        _;
    }

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
        require(summoner != address(0), "summoner cannot be 0");
        require(_periodDuration > 0, "_periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "_votingPeriodLength cannot be 0");
        require(_votingPeriodLength <= MAX_VOTING_PERIOD_LENGTH, "_votingPeriodLength exceeds limit");
        require(_gracePeriodLength <= MAX_GRACE_PERIOD_LENGTH, "_gracePeriodLength exceeds limit");
        require(_emergencyExitWait > 0, "_emergencyExitWait cannot be 0");
        require(_dilutionBound > 0, "_dilutionBound cannot be 0");
        require(_dilutionBound <= MAX_DILUTION_BOUND, "_dilutionBound exceeds limit");
        require(_approvedTokens.length > 0, "need at least one approved token");
        require(_proposalDeposit >= _processingReward, "_proposalDeposit cannot be smaller than _processingReward");

        depositToken = IERC20(_approvedTokens[0]);

        for (uint256 i = 0; i < _approvedTokens.length; i++) {
            require(_approvedTokens[i] != address(0), "_approvedToken cannot be 0");
            require(!tokenWhitelist[_approvedTokens[i]], "duplicate approved token");
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
        totalSharesAndLoot = 1;

        emit SummonComplete(summoner, 1);
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    function submitProposal(
        address applicant,
        uint256 sharesRequested,
        uint256 lootRequested,
        uint256 tributeOffered,
        address tributeToken,
        uint256 paymentRequested,
        address paymentToken,
        string memory details
    )
    public
    {
        require(tokenWhitelist[tributeToken], "tributeToken is not whitelisted");
        require(tokenWhitelist[paymentToken], "payment is not whitelisted");
        require(applicant != address(0), "applicant cannot be 0");

        // collect tribute from applicant and store it in the Moloch until the proposal is processed
        require(IERC20(tributeToken).transferFrom(msg.sender, address(this), tributeOffered), "tribute token transfer failed");

        bool[6] memory flags;

        _submitProposal(applicant, sharesRequested, tributeOffered, tributeToken, paymentRequested, paymentToken, details, flags);
    }

    function submitWhitelistProposal(address tokenToWhitelist, string memory details) public {
        require(tokenToWhitelist != address(0), "must provide token address");
        require(!tokenWhitelist[tokenToWhitelist], "can't already have whitelisted the token");

        bool[6] memory flags;
        flags[4] = true;

        _submitProposal(address(0), 0, 0, tokenToWhitelist, 0, address(0), details, flags);
    }

    function submitGuildKickProposal(address memberToKick, string memory details) public {
        require(members[memberToKick].shares > 0, "member must have at least one share");

        bool[6] memory flags;
        flags[5] = true;

        _submitProposal(memberToKick, 0, 0, address(0), 0, address(0), details, flags);
    }

    function _submitProposal(
        address applicant,
        uint256 sharesRequested,
        uint256 tributeOffered,
        address tributeToken,
        uint256 paymentRequested,
        address paymentToken,
        string memory details,
        bool[6] memory flags
    ) internal {
        Proposal memory proposal = Proposal({
            applicant : applicant,
            proposer : msg.sender,
            sponsor : address(0),
            sharesRequested : sharesRequested,
            tributeOffered : tributeOffered,
            tributeToken : IERC20(tributeToken),
            paymentRequested : paymentRequested,
            paymentToken : IERC20(paymentToken),
            startingPeriod : 0,
            yesVotes : 0,
            noVotes : 0,
            flags : flags,
            details : details,
            maxTotalSharesAtYesVote : 0
        });

        proposals[proposalCount] = proposal;
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        emit SubmitProposal(proposalCount, msg.sender, memberAddress, applicant, tributeOffered, tributeToken, sharesRequested, paymentRequested, paymentToken);
        proposalCount += 1;
    }

    function sponsorProposal(uint256 proposalId) public onlyDelegate {
        // collect proposal deposit from sponsor and store it in the Moloch until the proposal is processed
        require(depositToken.transferFrom(msg.sender, address(this), proposalDeposit), "proposal deposit token transfer failed");

        Proposal storage proposal = proposals[proposalId];

        require(proposal.proposer != address(0), 'proposal must have been proposed');

        require(!proposal.flags[0], "proposal has already been sponsored");
        require(!proposal.flags[3], "proposal has been cancelled");

        if (proposal.flags[4]) {
            require(!proposedToWhitelist[address(proposal.tributeToken)], 'already proposed to whitelist');
            proposedToWhitelist[address(proposal.tributeToken)] = true;
        } else if (proposal.flags[5]) {
            require(!proposedToKick[proposal.applicant], 'already proposed to kick');
            proposedToKick[proposal.applicant] = true;
        } else {
            // Make sure we won't run into overflows when doing calculations with shares.
            // Note that totalSharesAndLoot + totalSharesAndLootRequested + sharesRequested is an upper bound
            // on the number of shares that can exist until this proposal has been processed.
            require(totalSharesAndLoot.add(totalSharesAndLootRequested).add(proposal.sharesRequested).add(proposal.lootRequested) <= MAX_NUMBER_OF_SHARES_AND_LOOT, "too many shares requested");
            totalSharesAndLootRequested = totalSharesAndLootRequested.add(proposal.sharesRequested);
        }

        // compute startingPeriod for proposal
        uint256 startingPeriod = max(
            getCurrentPeriod(),
            proposalQueue.length == 0 ? 0 : proposals[proposalQueue[proposalQueue.length.sub(1)]].startingPeriod
        ).add(1);

        proposal.startingPeriod = startingPeriod;

        address memberAddress = memberAddressByDelegateKey[msg.sender];
        proposal.sponsor = memberAddress;

        proposal.flags[0] = true;

        // append proposal to the queue
        proposalQueue.push(proposalId);
        emit SponsorProposal(msg.sender, memberAddress, proposalId, proposalQueue.length.sub(1), startingPeriod);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "proposal does not exist");
        Proposal storage proposal = proposals[proposalQueue[proposalIndex]];

        require(uintVote < 3, "must be less than 3");
        Vote vote = Vote(uintVote);

        require(getCurrentPeriod() >= proposal.startingPeriod, "voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "member has already voted");
        require(vote == Vote.Yes || vote == Vote.No, "vote must be either Yes or No");

        proposal.votesByMember[memberAddress] = vote;

        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares);

            // set highest index (latest) yes vote - must be processed for member to ragequit
            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

            // set maximum of total shares encountered at a yes vote - used to bound dilution for yes voters
            if (totalSharesAndLoot > proposal.maxTotalSharesAtYesVote) {
                proposal.maxTotalSharesAtYesVote = totalSharesAndLoot;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares);
        }

        emit SubmitVote(proposalIndex, msg.sender, memberAddress, uintVote);
    }

    function processProposal(uint256 proposalIndex) public {
        _validateProposalForProcessing(proposalIndex);

        uint256 proposalId = proposalQueue[proposalIndex];
        Proposal storage proposal = proposals[proposalId];

        require(!proposal.flags[4] && !proposal.flags[5], "must be a standard proposal");

        proposal.flags[1] = true;
        totalSharesAndLootRequested = totalSharesAndLootRequested.sub(proposal.sharesRequested.add(proposal.lootRequested));

        (bool didPass, bool emergencyProcessing) = _didPass(proposalIndex);

        if (proposal.paymentToken != IERC20(0) && proposal.paymentRequested > proposal.paymentToken.balanceOf(address(guildBank))) {
            didPass = false;
        }

        // PROPOSAL PASSED
        if (didPass) {
            proposal.flags[2] = true;

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

            require(
                proposal.tributeToken.transfer(address(guildBank), proposal.tributeOffered),
                "token transfer to guild bank failed"
            );

            require(
                guildBank.withdrawToken(proposal.paymentToken, proposal.applicant, proposal.paymentRequested),
                "token payment to applicant failed"
            );


        // PROPOSAL FAILED
        } else {
            // return all tokens to the applicant (skip if emergency processing)
            if (!emergencyProcessing) {
                require(
                    proposal.tributeToken.transfer(proposal.proposer, proposal.tributeOffered),
                    "failing vote token transfer failed"
                );
            }
        }

        _returnDeposit(proposal.sponsor);

        emit ProcessProposal(proposalIndex, proposalId, didPass);
    }

    function processWhitelistProposal(uint256 proposalIndex) public {
        _validateProposalForProcessing(proposalIndex);

        uint256 proposalId = proposalQueue[proposalIndex];
        Proposal storage proposal = proposals[proposalId];

        require(proposal.flags[4], "must be a whitelist proposal");

        proposal.flags[1] = true;
        totalSharesRequested = totalSharesRequested.sub(proposal.sharesRequested);

        (bool didPass, bool _) = _didPass(proposalIndex);

        if (didPass) {
            proposal.flags[2] = true;

            tokenWhitelist[address(proposal.tributeToken)] = true;
            approvedTokens.push(proposal.tributeToken);
        }

        proposedToWhitelist[address(proposal.tributeToken)] = false;

        _returnDeposit(proposal.sponsor);

        emit ProcessProposal(proposalIndex, proposalId, didPass);
    }

    function processGuildKickProposal(uint256 proposalIndex) public {
        _validateProposalForProcessing(proposalIndex);

        uint256 proposalId = proposalQueue[proposalIndex];
        Proposal storage proposal = proposals[proposalId];

        require(proposal.flags[5], "must be a guild kick proposal");

        proposal.flags[1] = true;
        totalSharesRequested = totalSharesRequested.sub(proposal.sharesRequested);

        (bool didPass, bool _) = _didPass(proposalIndex);

        if (didPass) {
            proposal.flags[2] = true;

            _ragequit(proposal.applicant, members[proposal.applicant].shares, approvedTokens);
        }

        proposedToKick[proposal.applicant] = false;

        _returnDeposit(proposal.sponsor);

        emit ProcessProposal(proposalIndex, proposalId, didPass);
    }

    function _didPass(uint256 proposalIndex) internal view returns (bool didPass, bool emergencyProcessing) {
        Proposal memory proposal = proposals[proposalQueue[proposalIndex]];

        didPass = proposal.yesVotes > proposal.noVotes;

        // Make the proposal fail (and skip returning tribute) if emergencyExitWait is exceeded
        emergencyProcessing = false;
        if (getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength).add(emergencyExitWait)) {
            emergencyProcessing = true;
            didPass = false;
        }

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares.mul(dilutionBound) < proposal.maxTotalSharesAtYesVote) {
            didPass = false;
        }

        return (didPass, emergencyProcessing);
    }

    function _validateProposalForProcessing(uint256 proposalIndex) internal view {
        require(proposalIndex < proposalQueue.length, "proposal does not exist");
        Proposal memory proposal = proposals[proposalQueue[proposalIndex]];

        require(getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength), "proposal is not ready to be processed");
        require(proposal.flags[1] == false, "proposal has already been processed");
        require(proposalIndex == 0 || proposals[proposalQueue[proposalIndex.sub(1)]].flags[1], "previous proposal must be processed");
    }

    function _returnDeposit(address sponsor) internal {
        require(
            depositToken.transfer(msg.sender, processingReward),
            "failed to send processing reward to msg.sender"
        );

        require(
            depositToken.transfer(sponsor, proposalDeposit.sub(processingReward)),
            "failed to return proposal deposit to sponsor"
        );
    }

    function ragequit(uint256 sharesToBurn, uint256 lootToBurn) public onlyMember {
        _ragequit(sharesToBurn, lootToBurn, approvedTokens);
    }

    function safeRagequit(uint256 sharesToBurn, uint256 lootToBurn, IERC20[] memory tokenList) public onlyMember {
        // all tokens in tokenList must be in the tokenWhitelist
        for (uint256 i=0; i < tokenList.length; i++) {
            require(tokenWhitelist[address(tokenList[i])], "token must be whitelisted");

            if (i > 0) {
                require(tokenList[i] > tokenList[i - 1], "token list must be unique and in ascending order");
            }
        }

        _ragequit(sharesToBurn, lootToBurn, tokenList);
    }

    function _ragequit(uint256 sharesToBurn, uint256 lootToBurn, IERC20[] memory approvedTokens) internal {
        uint256 initialTotalSharesAndLoot = totalSharesAndLoot;

        Member storage member = members[memberAddress];

        require(member.shares >= sharesToBurn, "insufficient shares");
        require(member.loot >= lootToBurn, "insufficient loot");

        require(canRagequit(member.highestIndexYesVote), "cant ragequit until highest index proposal member voted YES on is processed");

        uint256 sharesAndLootToBurn = sharesToBurn.add(lootToBurn);

        // burn shares and loot
        member.shares = member.shares.sub(sharesToBurn);
        member.loot = member.loot.sub(lootToBurn);
        totalSharesAndLoot = totalSharesAndLoot.sub(sharesAndLootToBurn);


        // instruct guildBank to transfer fair share of tokens to the ragequitter
        require(
            guildBank.withdraw(memberAddress, sharesToBurn, initialTotalShares, _approvedTokens),
            "withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn, lootToBurn);
    }

    function cancelProposal(uint256 proposalId) public {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.flags[0], "proposal has already been sponsored");
        require(msg.sender == proposal.proposer, "only the proposer can cancel");

        proposal.flags[3] = true;

        require(
            proposal.tributeToken.transfer(proposal.proposer, proposal.tributeOffered),
            "failed to return tribute to proposer"
        );

        emit CancelProposal(proposalId, msg.sender);
    }

    function updateDelegateKey(address newDelegateKey) public onlyMember {
        require(newDelegateKey != address(0), "newDelegateKey cannot be 0");

        // skip checks if member is setting the delegate key to their member address
        if (newDelegateKey != msg.sender) {
            require(!members[newDelegateKey].exists, "cant overwrite existing members");
            require(!members[memberAddressByDelegateKey[newDelegateKey]].exists, "cant overwrite existing delegate keys");
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

    function getProposalFlags(uint256 proposalIndex) public view returns (bool[6] memory) {
        return proposals[proposalIndex].flags;
    }

    // can only ragequit if the latest proposal you voted YES on has been processed
    function canRagequit(uint256 highestIndexYesVote) public view returns (bool) {
        require(highestIndexYesVote < proposalQueue.length, "proposal does not exist");
        return proposals[proposalQueue[highestIndexYesVote]].flags[1];
    }

    function hasVotingPeriodExpired(uint256 startingPeriod) public view returns (bool) {
        return getCurrentPeriod() >= startingPeriod.add(votingPeriodLength);
    }

    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        require(members[memberAddress].exists, "member doesn't exist");
        require(proposalIndex < proposalQueue.length, "proposal doesn't exist");
        return proposals[proposalQueue[proposalIndex]].votesByMember[memberAddress];
    }
}
