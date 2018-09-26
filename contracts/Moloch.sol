pragma solidity 0.4.24;

import "./oz/SafeMath.sol";
import "./oz/ERC20.sol";
import "./GuildBank.sol";
import "./LootToken.sol";

contract Moloch {
    using SafeMath for uint256;

    uint256 public periodDuration; // default = 86400 = 1 day in seconds
    uint256 public votingPeriodLength; // default = 7 periods
    uint256 public gracePeriodLength; // default = 7 periods
    uint256 public proposalDeposit; // default = $5,000 worth of ETH (units in Wei)

    enum Vote {
        Null,
        Yes,
        No
    }

    struct Member {
        uint256 votingShares;
        mapping (uint256 => Vote) votesByProposal;
    }

    struct Proposal {
        address proposer;
        address applicant;
        uint256 votingSharesRequested;
        uint256 startingPeriod;
        uint256 yesVotes;
        uint256 noVotes;
        address[] tributeTokenAddresses;
        uint256[] tributeTokenAmounts;
        bool processed;
        mapping (address => Vote) votesByMember;
    }

    struct Period {
        uint256 startTime; // the starting unix timestamp in seconds
        uint256 endTime; // the ending unix timestamp in seconds
    }

    mapping (address => Member) public members;
    mapping(uint256 => Period) public periods;
    Proposal[] public proposalQueue;

    uint256 public currentPeriod = 0;
    uint256 public currentProposal = 0;
    uint256 public totalVotingShares = 0;

    GuildBank public guildBank; // guild bank contract reference
    LootToken public lootToken; // loot token contract reference

    uint8 constant QUORUM_NUMERATOR = 1;
    uint8 constant QUORUM_DENOMINATOR = 2;

    /********
    MODIFIERS
    ********/
    modifier onlyMember {
        require(members[msg.sender].votingShares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    /***************
    PUBLIC FUNCTIONS
    ***************/

    constructor(
        address lootTokenAddress,
        address guildBankAddress,
        address[] foundersAddresses,
        uint256[] foundersVotingShares,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint _proposalDeposit
    )
        public
    {
        lootToken = LootToken(lootTokenAddress);
        guildBank = GuildBank(guildBankAddress);

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        proposalDeposit = _proposalDeposit;

        uint256 startTime = now;
        periods[currentPeriod].startTime = startTime;
        periods[currentPeriod].endTime = startTime.add(periodDuration);

        _addFoundingMembers(foundersAddresses, foundersVotingShares);
    }

    function _addFoundingMembers(
        address[] membersArray,
        uint256[] sharesArray
    )
        internal
    {
        require(membersArray.length == sharesArray.length, "Moloch::_addFoundingMembers - Provided arrays should match up.");
        for (uint i = 0; i < membersArray.length; i++) {
            address founder = membersArray[i];
            uint256 shares = sharesArray[i];
            // TODO perhaps check that shares > 0

            members[founder] = Member(shares);
            totalVotingShares = totalVotingShares.add(shares);
            lootToken.mint(this, shares);
        }
    }

    function updatePeriod() public {
        while (now >= periods[currentPeriod].endTime) {
            Period memory prevPeriod = periods[currentPeriod];
            currentPeriod += 1;
            periods[currentPeriod].startTime = prevPeriod.endTime;
            periods[currentPeriod].endTime = prevPeriod.endTime.add(periodDuration);
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/

    function submitProposal(
        address applicant,
        address[] tributeTokenAddresses,
        uint256[] tributeTokenAmounts,
        uint256 votingSharesRequested
    )
        public
        payable
        onlyMember
    {
        updatePeriod();

        // TODO think about members that have fully exited
        require(members[applicant].votingShares == 0, "Moloch::submitProposal - applicant is already a member");
        require(msg.value == proposalDeposit, "Moloch::submitProposal - insufficient proposalDeposit");

        for (uint256 i = 0; i < tributeTokenAddresses.length; i++) {
            ERC20 token = ERC20(tributeTokenAddresses[i]);
            uint256 amount = tributeTokenAmounts[i];
            require(amount > 0, "Moloch::submitProposal - token tribute amount is 0");
            require(token.transferFrom(applicant, this, amount), "Moloch::submitProposal - tribute token transfer failed");
        }

        uint256 startingPeriod = currentPeriod + proposalQueue.length - currentProposal + 1;

        Proposal memory proposal = Proposal(msg.sender, applicant, votingSharesRequested, startingPeriod, 0, 0, tributeTokenAddresses, tributeTokenAmounts, false);

        proposalQueue.push(proposal);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyMember {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        Vote vote = Vote(uintVote);
        require(proposal.startingPeriod > 0, "Moloch::submitVote - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) < votingPeriodLength, "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[msg.sender] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        proposal.votesByMember[msg.sender] = vote;

        Member storage member = members[msg.sender];
        member.votesByProposal[proposalIndex] = vote;

        if (vote == Vote.Yes) {
            proposal.yesVotes.add(member.votingShares);
        } else if (vote == Vote.No) {
            proposal.noVotes.add(member.votingShares);
        }
    }

    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        require(proposal.startingPeriod > 0, "Moloch::processProposal - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");

        proposal.processed = true;
        uint256 i = 0;

        if (proposal.yesVotes.add(proposal.noVotes) >= (totalVotingShares.mul(QUORUM_NUMERATOR)).div(QUORUM_DENOMINATOR) && proposal.yesVotes > proposal.noVotes) {
            // mint new voting shares
            members[proposal.applicant] = Member(proposal.votingSharesRequested);
            totalVotingShares = totalVotingShares.add(proposal.votingSharesRequested);
            lootToken.mint(this, proposal.votingSharesRequested);

            // deposit all tribute tokens to guild bank
            for (i; i < proposal.tributeTokenAddresses.length; i++) {
                require(guildBank.depositTributeTokens(this, proposal.tributeTokenAddresses[i], proposal.tributeTokenAmounts[i]));
            }
        } else {
            // return all tokens
            for (i; i < proposal.tributeTokenAddresses.length; i++) {
                ERC20 token = ERC20(proposal.tributeTokenAddresses[i]);
                require(token.transfer(proposal.applicant, proposal.tributeTokenAmounts[i]));
            }
        }

        proposal.proposer.transfer(proposalDeposit);
    }

    function collectLootTokens(address treasury, uint256 lootAmount) public onlyMember {
        updatePeriod();

        Member storage member = members[msg.sender];

        require(member.votingShares >= lootAmount, "Moloch::collectLoot - insufficient voting shares");

        member.votingShares = member.votingShares.sub(lootAmount);
        totalVotingShares = totalVotingShares.sub(lootAmount);

        require(lootToken.transfer(treasury, lootAmount), "Moloch::collectLoot - loot token transfer failure");

        uint256 oldestActiveProposal = (currentProposal.sub(votingPeriodLength)).sub(gracePeriodLength);
        for (uint256 i = currentProposal; i > oldestActiveProposal; i--) {
            if (isActiveProposal(i)) {
                Proposal storage proposal = proposalQueue[i];
                Vote vote = member.votesByProposal[i];
                if (vote == Vote.Null) {
                    // member didn't vote on this proposal, skip to the next one
                    continue;
                }

                // member did vote, revert their votes
                if (vote == Vote.Yes) {
                    proposal.yesVotes = proposal.yesVotes.sub(lootAmount);
                } else if (vote == Vote.No) {
                    proposal.noVotes = proposal.noVotes.sub(lootAmount);
                }

                // if the member is collecting 100% of their loot, erase these vote completely
                if (lootAmount == member.votingShares) {
                    proposal.votesByMember[msg.sender] = Vote.Null;
                    member.votesByProposal[i] = Vote.Null;
                }
            } else {
                // reached inactive proposal, exit the loop
                break;
            }
        }
    }

    // returns true if proposal is either in voting or grace period
    function isActiveProposal(uint256 proposalIndex) internal returns (bool) {
        return (currentPeriod.sub(proposalQueue[proposalIndex].startingPeriod) < votingPeriodLength.add(gracePeriodLength));
    }
}
