pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";
import "./GuildBank.sol";

contract Moloch {
    using SafeMath for uint256;

    uint256 public periodDuration;
    uint256 public votingPeriodLength;
    uint256 public gracePeriodLength;
    uint256 public emergencyExitWait;
    uint256 public proposalDeposit;
    uint256 public dilutionBound;
    uint256 public processingReward;
    uint256 public summoningTime;

    IERC20 public depositToken;
    GuildBank public guildBank;

    uint256 constant MAX_VOTING_PERIOD_LENGTH = 10**18;
    uint256 constant MAX_GRACE_PERIOD_LENGTH = 10**18;
    uint256 constant MAX_DILUTION_BOUND = 10**18;
    uint256 constant MAX_NUMBER_OF_SHARES = 10**18;

    event SubmitProposal(uint256 proposalIndex, address indexed delegateKey, address indexed memberAddress, address indexed applicant, uint256 tributeOffered, uint256 sharesRequested);
    event SubmitVote(uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
    event ProcessProposal(uint256 indexed proposalIndex, address indexed applicant, address indexed memberAddress, uint256 tributeOffered, uint256 sharesRequested, bool didPass);
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn);
    event CancelProposal(uint256 indexed proposalIndex, address applicantAddress);
    event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey);
    event SummonComplete(address indexed summoner, uint256 shares);

    uint256 public proposalCount = 0;
    uint256 public totalShares = 0;
    uint256 public totalSharesRequested = 0;

    enum Vote {
        Null,
        Yes,
        No
    }

    struct Member {
        address delegateKey;
        uint256 shares;
        bool exists;
        uint256 highestIndexYesVote;
    }

    struct Proposal {
        address applicant;
        address proposer;
        address sponsor;
        uint256 sharesRequested;
        uint256 tributeOffered;
        IERC20 tributeToken;
        uint256 paymentRequested;
        IERC20 paymentToken;
        uint256 startingPeriod;
        uint256 yesVotes;
        uint256 noVotes;
        bool[6] flags; // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
        string details;
        uint256 maxTotalSharesAtYesVote;
        mapping (address => Vote) votesByMember;
    }

    mapping (address => bool) public tokenWhitelist;
    IERC20[] public approvedTokens;

    mapping (address => bool) public proposedToWhitelist;
    mapping (address => bool) public proposedToKick;

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;

    mapping (uint256 => Proposal) public proposals;

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

        for (uint256 i=0; i < _approvedTokens.length; i++) {
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
        totalShares = 1;

        emit SummonComplete(summoner, 1);
    }

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
        require(tokenWhitelist[tributeToken], "tributeToken is not whitelisted");
        require(tokenWhitelist[paymentToken], "payment is not whitelisted");
        require(applicant != address(0), "applicant cannot be 0");

        require(IERC20(tributeToken).transferFrom(msg.sender, address(this), tributeOffered), "tribute token transfer failed");

        bool[6] memory flags;

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

        proposals[proposalCount] = proposal;
        proposalCount += 1;
    }

    function submitWhitelistProposal(address tokenToWhitelist, string memory details) public {
        require(tokenToWhitelist != address(0), "must provide token address");
        require(!tokenWhitelist[tokenToWhitelist], "can't already have whitelisted the token");

        bool[6] memory flags;
        flags[4] = true;

        Proposal memory proposal = Proposal({
            applicant: address(0),
            proposer: msg.sender,
            sponsor: address(0),
            sharesRequested: 0,
            tributeOffered: 0,
            tributeToken: IERC20(tokenToWhitelist),
            paymentRequested: 0,
            paymentToken: IERC20(address(0)),
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            flags: flags,
            details: details,
            maxTotalSharesAtYesVote: 0
        });

        proposals[proposalCount] = proposal;
        proposalCount += 1;
    }

    function submitGuildKickProposal(address memberToKick, string memory details) public {
        require(members[memberToKick].shares > 0, "member must have at least one share");

        bool[6] memory flags;
        flags[5] = true;

        Proposal memory proposal = Proposal({
            applicant: memberToKick,
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

        proposals[proposalCount] = proposal;
        proposalCount += 1;
    }

    function sponsorProposal(uint256 proposalId) public onlyDelegate {
        require(depositToken.transferFrom(msg.sender, address(this), proposalDeposit), "proposal deposit token transfer failed");

        // TODO changed from memory to storage by BlockRocket. Please approve
        Proposal storage proposal = proposals[proposalId];

        require(!proposal.flags[0], "proposal has already been sponsored");
        require(!proposal.flags[3], "proposal has been cancelled");

        if (proposal.flags[4]) {
            // TODO BlockRocket added message. Please approve or remove.
            require(!proposedToWhitelist[address(proposal.tributeToken)], 'already proposed to whitelist');
            proposedToWhitelist[address(proposal.tributeToken)] = true;
        } else if (proposal.flags[5]) {
            // TODO BlockRocket added message. Please approve or remove.
            require(!proposedToKick[proposal.applicant], 'already proposed to kick');
            proposedToKick[proposal.applicant] = true;
        } else {
            require(totalShares.add(totalSharesRequested).add(proposal.sharesRequested) <= MAX_NUMBER_OF_SHARES, "too many shares requested");
            totalSharesRequested = totalSharesRequested.add(proposal.sharesRequested);
        }

        uint256 startingPeriod = max(
            getCurrentPeriod(),
            proposalQueue.length == 0 ? 0 : proposals[proposalQueue[proposalQueue.length.sub(1)]].startingPeriod
        ).add(1);

        proposal.startingPeriod = startingPeriod;

        address memberAddress = memberAddressByDelegateKey[msg.sender];
        proposal.sponsor = memberAddress;

        // TODO BlockRocket added this missing flag on sponsor success. Please approve or remove.
        proposal.flags[0] = true;

        proposalQueue.push(proposalId);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "proposal does not exist");
        Proposal storage proposal = proposals[proposalQueue[proposalIndex]];

        require(uintVote < 3, "must be less than 3");
        Vote vote = Vote(uintVote);

        require(proposal.flags[0], "proposal has not been sponsored"); // TODO BlockRocket - unreachable require? Please approve or remove.
        require(getCurrentPeriod() >= proposal.startingPeriod, "voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "member has already voted");
        require(vote == Vote.Yes || vote == Vote.No, "vote must be either Yes or No");

        proposal.votesByMember[memberAddress] = vote;

        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares);

            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

            if (totalShares > proposal.maxTotalSharesAtYesVote) {
                proposal.maxTotalSharesAtYesVote = totalShares;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares);
        }

        emit SubmitVote(proposalIndex, msg.sender, memberAddress, uintVote);
    }

    function processProposal(uint256 proposalIndex) public {
        require(proposalIndex < proposalQueue.length, "proposal does not exist");
        Proposal storage proposal = proposals[proposalQueue[proposalIndex]];

        require(getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength), "proposal is not ready to be processed");
        require(proposal.flags[1] == false, "proposal has already been processed");
        require(proposalIndex == 0 || proposals[proposalQueue[proposalIndex.sub(1)]].flags[1], "previous proposal must be processed");

        proposal.flags[1] = true;
        totalSharesRequested = totalSharesRequested.sub(proposal.sharesRequested);

        bool didPass = proposal.yesVotes > proposal.noVotes;

        bool emergencyProcessing = false;
        if (getCurrentPeriod() >= proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength).add(emergencyExitWait)) {
            emergencyProcessing = true;
            didPass = false;
        }

        if (totalShares.mul(dilutionBound) < proposal.maxTotalSharesAtYesVote) {
            didPass = false;
        }

        // TODO BlockRocket changed from >= to > as zero payment test was failing passing proposal here. Please approve or revert.
        // TODO BlockRocket proposal.paymentToken != IERC20(0) due to revert when zeroAddress payment token
        if (proposal.paymentToken != IERC20(0) && proposal.paymentRequested > proposal.paymentToken.balanceOf(address(guildBank))) {
            didPass = false;
        }

        if (didPass) {

            proposal.flags[2] = true;

            if (proposal.flags[4]) {
               tokenWhitelist[address(proposal.tributeToken)] = true;
               approvedTokens.push(proposal.tributeToken);

            } else if (proposal.flags[5]) {
                _ragequit(members[proposal.applicant].shares, approvedTokens);

            } else {
                if (members[proposal.applicant].exists) {
                    members[proposal.applicant].shares = members[proposal.applicant].shares.add(proposal.sharesRequested);

                } else {
                    if (members[memberAddressByDelegateKey[proposal.applicant]].exists) {
                        address memberToOverride = memberAddressByDelegateKey[proposal.applicant];
                        memberAddressByDelegateKey[memberToOverride] = memberToOverride;
                        members[memberToOverride].delegateKey = memberToOverride;
                    }

                    members[proposal.applicant] = Member(proposal.applicant, proposal.sharesRequested, true, 0);
                    memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
                }

                totalShares = totalShares.add(proposal.sharesRequested);

                require(
                    proposal.tributeToken.transfer(address(guildBank), proposal.tributeOffered),
                    "token transfer to guild bank failed"
                );

                require(
                    guildBank.withdrawToken(proposal.paymentToken, proposal.applicant, proposal.paymentRequested),
                    "token payment to applicant failed"
                );
            }
        } else {
            if (!emergencyProcessing) {
                require(
                    proposal.tributeToken.transfer(proposal.proposer, proposal.tributeOffered),
                    "failing vote token transfer failed"
                );
            }
        }

        if (proposal.flags[4]) {
            proposedToWhitelist[address(proposal.tributeToken)] = false;
        }

        if (proposal.flags[5]) {
            proposedToKick[proposal.applicant] = false;
        }

        require(
            depositToken.transfer(msg.sender, processingReward),
            "failed to send processing reward to msg.sender"
        );

        require(
            depositToken.transfer(proposal.sponsor, proposalDeposit.sub(processingReward)),
            "failed to return proposal deposit to sponsor"
        );
    }

    function ragequit(uint256 sharesToBurn) public onlyMember {
        _ragequit(sharesToBurn, approvedTokens);
    }

//    function safeRagequit(uint256 sharesToBurn, IERC20[] memory tokenList) public onlyMember {
//        for (uint256 i=0; i < tokenList.length; i++) {
//            require(tokenWhitelist[address(tokenList[i])], "token must be whitelisted");
//
//            if (i > 0) {
//                require(tokenList[i] > tokenList[i-1], "tokenList must be unique and in ascending order");
//            }
//        }
//
//        _ragequit(sharesToBurn, tokenList);
//    }

    // TODO 'approvedTokens' was shadowing a gloabl var. Added _ to local var. Please approve or remove or adjust.
    function _ragequit(uint256 sharesToBurn, IERC20[] memory _approvedTokens) internal {
        uint256 initialTotalShares = totalShares;

        // FIXME this means the person being kicked must call processProposal!?
        Member storage member = members[msg.sender];

        require(member.shares >= sharesToBurn, "insufficient shares");

        require(canRagequit(member.highestIndexYesVote), "cant ragequit until highest index proposal member voted YES on is processed");

        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares, _approvedTokens),
            "withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn);
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

    function max(uint256 x, uint256 y) internal pure returns (uint256) {
        return x >= y ? x : y;
    }

    function getCurrentPeriod() public view returns (uint256) {
        return now.sub(summoningTime).div(periodDuration);
    }

    function getProposalQueueLength() public view returns (uint256) {
        return proposalQueue.length;
    }

    // TODO added by BlockRocket. Please approve or remove. Used in tests to pull flag arrays for equality.
    function getProposalFlags(uint256 proposalIndex) public view returns (bool[6] memory) {
        return proposals[proposalIndex].flags;
    }

    function canRagequit(uint256 highestIndexYesVote) public view returns (bool) {
        require(highestIndexYesVote < proposalQueue.length, "proposal does not exist");
        return proposals[proposalQueue[highestIndexYesVote]].flags[1]; // processed
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
