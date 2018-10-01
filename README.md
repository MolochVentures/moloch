# Moloch

> Moloch the incomprehensible prison! Moloch the crossbone soulless jailhouse and Congress of sorrows! Moloch whose buildings are judgment! Moloch the vast stone of war! Moloch the stunned governments!

> Moloch whose mind is pure machinery! Moloch whose blood is running money! Moloch whose fingers are ten armies! Moloch whose breast is a cannibal dynamo! Moloch whose ear is a smoking tomb!

~ Allen Ginsberg, Howl

Moloch is a grant-making DAO / Guild and a radical experiment in voluntary incentive alignment to overcome the "tragedy of the commons". Our objective is to accelerate the development of public Ethereum infrastructure that many teams need but don't want to pay for on their own. By pooling our ETH and ERC20 tokens, teams building on Ethereum can collectively fund open-source work we decide is in our common interest.

This documentation will focus on the Moloch DAO system design and smart contracts. For a deeper explanation of the philosophy and purpose of this system, please read our whitepaper and the Slate Star Codex post, Meditations on Moloch, which served as inspiration.

## Design Principles

In developing the Moloch DAO, we realized that the more Solidity we wrote, the greater the likelihood that we would lose everyone's money. In order to prioritize security, we took simplicity and elegance as our primary design principles. We consiously skipped many features, and the result is what we believe to be a Minimally Viable DAO.

## Overview

Moloch is described by three smart contracts:

1. `Moloch.sol` - Responsible for managing membership & voting rights, proposal submissions, voting, and processing proposals based on the outcomes of the votes.
2. `GuildBank.sol` - Responsible for managing Guild assets.
3. `LootToken.sol` - An ERC20 mintable and burnable token with a claim on assets held by the Guild Bank.

Moloch has two classes of native assets:

1. **Voting Shares** are minted and assigned when a new member is accepted into the Guild and provide voting rights on new membership proposals. They are non-transferrable, but can be *irreversibly* redeemed on a 1-1 basis for Loot Tokens.
2. **Loot Tokens** are also minted on a 1-1 basis with Voting Shares when a new member is accepted, but are only disbursed when a member redeems their Voting Shares. Loot Tokens are freely transferrable and can at any time be consumed to collect a proportional share of all tokens held by the Guild in the Guild Bank.

Moloch operates through the submission, voting on, and processing of a series of membership proposals. To combat spam, new membership proposals can only be submitted by existing members and require a ~$5,000 ETH deposit. Applicants who wish to join must find a Guild member to champion their proposal and have that member call `submitProposal` on their behalf. The membership proposal includes the number of Voting Shares the applicant is requesting, and either the set of tokens the applicant is offering as tribute or a pledge that the applicant will complete some work that benefits the Guild.

All tokens offered as tribute are held in escrow by the `Moloch.sol` contract until the proposal vote is completed and processed. If a proposal vote passes, the applicant becomes a member, the Voting Shares requested are minted and assigned to them, and their tribute tokens are deposited into the `GuildBank.sol` contract. If a proposal vote is rejected, all tribute tokens are returned to the applicant. In either case, the $5,000 ETH deposit is returned to the member who submitted the proposal.

Proposals are voted on in the order they are submitted. The *voting period* for each proposal is 7 days. During the voting period, members can vote (only once, no redos) on a proposal by calling `submitVote`. A new proposal vote starts every day, so there can be a maximum of 7 proposals being voted on at any time (staggered by 1 day). Proposal votes are determined by simple majority, with a 50% quorum requirement.

At the end of the voting period, proposals enter into a 7 day *grace period* before the proposal is processed. During the grace period, all Guild members who voted **No** or didn't vote have the opportunity to *ragequit*, turning in their Voting Shares for Loot Tokens by calling `collectLootTokens` and withdrawing their proportional share of tokens from the Guild Bank by calling `redeemLootTokens`. Members who voted **Yes** must remain.

At the end of the grace period, proposals are processed when anyone calls `processProposal` and are either accepted or rejected based on the votes of the remaining Guild members.

#### Game Theory

By allowing Guild members to ragequit and exit at any time, Moloch protects its members from 51% attacks and from supporting proposals they vehemently oppose.

In the worst case, one or more Guild members who control >50% of the Voting Shares could submit a proposal to grant themselves a ridiculous number of new Voting Shares, thereby diluting all other members of their claims to the Guild Bank assets and effectively stealing from them. If this were to happen, everyone else would ragequit during the grace period and take their share of the Guild Bank assets with them, and the proposal would have no impact.

In the more likely case of a contentious vote, those who oppose strongly enough can leave and increase the funding burden on those who choose to stay. Let's say the Guild has 100 outstanding Voting Shares and $100M worth of tokens in the Guild Bank. If a project proposal requests 1 newly minted Voting Share (~$1M worth), the vote is split 50/50 with 100% voter turnout, and the 50 who voted **No** all ragequit and take their $50M with them, then the remaining members would be diluting themselves twice as much: 1/51 = ~2% vs. 1/101 = ~1%.

In this fashion, the ragequit mechanism also provides an interesting incentive in favor of Guild cohesion. Guild members are disincentivized from voting **Yes** on proposals that they believe will make other members ragequit. Those who do vote **Yes** on contentious proposals will be forced to additionally dilute themselves proportional to the fraction of Voting Shares that ragequit in response.

The maximum additional dilution would be 4x, in the case of a proposal vote with 50% voter turnout (the quorum minimum) and just over 25% voting **Yes** and just under 25% voting **No**, where the 25% who voted **No** and the 50% who didn't vote all ragequit.

## Data Structures

#### Global Constants
```
    uint256 public periodDuration; // default = 86400 = 1 day in seconds
    uint256 public votingPeriodLength; // default = 7 periods
    uint256 public gracePeriodLength; // default = 7 periods
    uint256 public proposalDeposit; // default = $5,000 worth of ETH at contract deployment (units in Wei)

    GuildBank public guildBank; // guild bank contract reference
    LootToken public lootToken; // loot token contract reference

    uint8 constant QUORUM_NUMERATOR = 1;
    uint8 constant QUORUM_DENOMINATOR = 2;
```
#### Internal Accounting
```
    uint256 public currentPeriod = 0; // the current period number
    uint256 public pendingProposals = 0; // the # of proposals waiting to be voted on
    uint256 public totalVotingShares = 0; // total voting shares across all members
```
##### Proposals
The `Proposal` struct stores all relevant data for each proposal, and is saved in the `proposalQueue` array in the order it was submitted.
```
    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member
        uint256 votingSharesRequested; // the # of voting shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        address[] tributeTokenAddresses; // the addresses of the tokens the applicant has offered as tribute
        uint256[] tributeTokenAmounts; // the amounts of the tokens the applicant has offered as tribute
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

	Proposal[] public proposalQueue;
```

##### Members
The `Member` struct stores all relevant data for each member, and is saved in the `members` mapping by the member's address.
```
    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 votingShares; // the # of voting shares assigned to this member
        bool isActive; // always true once a member has been created
        mapping (uint256 => Vote) votesByProposal; // records a member's votes by the index of the proposal
    }

	mapping (address => Member) public members;
	mapping (address => address) public memberAddressByDelegateKey;
```
The `isActive` field is set to `true` when a member is accepted and remains `true` even if a member redeems 100% of their Voting Shares. It is used to prevent overwriting existing members with new membership proposals. This also means that

For additional security, members can optionally change their `delegateKey` (used for submitting and voting on proposals) to a different address by calling `updateDelegateKey`. The `memberAddressByDelegateKey` stores the member's address by the `delegateKey` address.

##### Votes
The Vote enum reflects the possible values of a proposal vote by a member.
```
    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }
```
##### Periods
The `Period` struct stores the start and end time for each period, and is saved in the `periods` mapping by the period number.
```
    struct Period {
        uint256 startTime; // the starting unix timestamp in seconds
        uint256 endTime; // the ending unix timestamp in seconds
    }

	mapping (uint256 => Period) public periods;
```

## Modifiers

#### onlyMember
Checks that the `msg.sender` is the address of an active member.
```
    modifier onlyMember {
        require(members[msg.sender].isActive, "Moloch::onlyMember - not a member");
        _;
    }
```

#### onlyMemberDelegate

    modifier onlyMemberDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].isActive, "Moloch::onlyMemberDelegate - not a member");
        _;
    }


## Functions

### Moloch Constructor
1. Deploys a new instance of the `LootToken.sol` contract and saves its reference.
2. Builds and saves the `GuildBank.sol` contract reference from the passed in `guildBankAddress`.
3. Saves passed in values for global constants `periodDuration`, `votingPeriodLength`, `gracePeriodLength`, and `proposalDeposit`.
4. Immediately starts the first period (period 0) at `startTime = now`.
5. Sets the `endTime` of the first period to 1 day from `now`.
6. Initializes the voting shares for the founding members.
```
    constructor(
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
        lootToken = new LootToken();
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
```


### _addFoundingMembers
For each founding member:
1. Saves the founder's voting shares.
2. Updates the `totalVotingShares`.
3. Mints `lootTokens` equal the the voting shares.
4. Keeps the `lootTokens` in the `Moloch.sol` contract.


```
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

            require(shares > 0, "Moloch::_addFoundingMembers - founding member has 0 shares");

            members[founder] = Member(shares, true);
            totalVotingShares = totalVotingShares.add(shares);
            lootToken.mint(this, shares);
        }
    }
```
### updatePeriod

In order to make sure all interactions with Moloch take place during the correct period, the `updatePeriod` function is called at the beginning of every state-updating function.

So long as the current time (`now`) is greater than the `endTime` of the current period (meaning the period is over), the `currentPeriod` is incremented by one and then the `startTime` and the `endTime` for the next `Period` are set as well.

When the `currentPeriod` is incremented, the `currentProposal` is also incremented if there are pending proposals still in the queue.
```
    function updatePeriod() public {
        while (now >= periods[currentPeriod].endTime) {
            Period memory prevPeriod = periods[currentPeriod];
            currentPeriod += 1;
            periods[currentPeriod].startTime = prevPeriod.endTime;
            periods[currentPeriod].endTime = prevPeriod.endTime.add(periodDuration);

            // increment currentProposal if there are more in the queue
            if (currentProposal < (proposalQueue.length - 1)) {
                currentProposal = currentProposal.add(1);
            }
        }
    }
```
The reason this is done using a `while` loop is just in case an entire period passes without any Moloch interactions taking place.

### submitProposal

1. Updates the period.
2. Transfers all tribute tokens to the `Moloch.sol` contract to be held in escrow until the proposal vote is completed and processed.
3. Sets the `startingPeriod` of the proposal.
4. Pushes the proposal data to the end of the `proposalQueue`.

```
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

        require(!members[applicant].isActive, "Moloch::submitProposal - applicant is already a member");
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
```
The `startingPeriod` is set based on the `currentPeriod`, and the number of pending proposals in queue before this one. The number of pending proposals is the `proposalQueue.length - currentProposal + 1`.

If the first proposal is during period 0, then it's starting period will be 0 + 0 - 0 + 1 = 1.

When `updatePeriod` is triggered next,

If the second proposal is also during period 0, then it's starting period will be 0 + 1 - 0 + 1 = 2.
