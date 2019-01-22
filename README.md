# Moloch

> Moloch the incomprehensible prison! Moloch the crossbone soulless jailhouse and Congress of sorrows! Moloch whose buildings are judgment! Moloch the vast stone of war! Moloch the stunned governments!

> Moloch whose mind is pure machinery! Moloch whose blood is running money! Moloch whose fingers are ten armies! Moloch whose breast is a cannibal dynamo! Moloch whose ear is a smoking tomb!

~ Allen Ginsberg, Howl

Moloch is a grant-making DAO / Guild and a radical experiment in voluntary incentive alignment to overcome the "tragedy of the commons". Our objective is to accelerate the development of public Ethereum infrastructure that many teams need but don't want to pay for on their own. By pooling our ETH and ERC20 tokens, teams building on Ethereum can collectively fund open-source work we decide is in our common interest.

This documentation will focus on the Moloch DAO system design and smart contracts. For a deeper explanation of the philosophy behind Moloch, please read the Slate Star Codex post, [Meditations on Moloch](http://slatestarcodex.com/2014/07/30/meditations-on-moloch/), which served as inspiration.

## Design Principles

In developing the Moloch DAO, we realized that the more Solidity we wrote, the greater the likelihood that we would lose everyone's money. In order to prioritize security, we took simplicity and elegance as our primary design principles. We consciously skipped many features, and the result is what we believe to be a Minimally Viable DAO.

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

# Moloch.sol

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
The `isActive` field is set to `true` when a member is accepted and remains `true` even if a member redeems 100% of their Voting Shares. It is used to prevent overwriting existing members with new membership proposals.

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
Checks that the `msg.sender` is the address of a member with at least 1 voting share.
```
    modifier onlyMember {
        require(members[msg.sender].votingShares > 0, "Moloch::onlyMember - not a member");
        _;
    }
```
Applied only to `collectLootTokens` and `updateDelegateKey`.

#### onlyMemberDelegate
Checks that the `msg.sender` is the `delegateKey` of a member with at least 1 voting share.
```
    modifier onlyMemberDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].votingShares > 0, "Moloch::onlyMemberDelegate - not a member");
        _;
    }
```
Applied only to `submitProposal` and `submitVote`.

## Functions

### Moloch Constructor
1. Deploys a new instance of the `LootToken.sol` contract and saves its reference.
2. Builds and saves the `GuildBank.sol` contract reference from the passed in `guildBankAddress`.
3. Saves passed in values for global constants `periodDuration`, `votingPeriodLength`, `gracePeriodLength`, and `proposalDeposit`.
4. Immediately starts the first period (period 0) at `startTime = now`.
5. Sets the `endTime` of the first period to 1 day from `now`.
6. Initializes the voting shares of the founding members.
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
Only ever called once, from the constructor. For each founding member:
1. Saves the founder's voting shares.
2. Saves the founder's `delegateKey` as their founder address by default.
3. Updates the `totalVotingShares`.
4. Mints `lootTokens` equal the the voting shares (keeps them in the `Moloch.sol` contract).

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
            require(!members[founder].isActive, "Moloch::_addFoundingMembers - duplicate founder");

            // use the founder address as the delegateKey by default
            members[founder] = Member(founder, shares, true);
            memberAddressByDelegateKey[founder] = founder;
            totalVotingShares = totalVotingShares.add(shares);
            lootToken.mint(this, shares);
        }
    }
```
### updatePeriod

In order to make sure all interactions with Moloch take place during the correct period, the `updatePeriod` function is called at the beginning of every state-updating function.

So long as the current time (`now`) is greater than the `endTime` of the current period (meaning the period is over), the `currentPeriod` is incremented by one and then the `startTime` and the `endTime` for the next `Period` are set as well.

When the `currentPeriod` is incremented, if there are still pending proposals in the queue then `pendingProposals` is decremented.
```
    function updatePeriod() public {
        while (now >= periods[currentPeriod].endTime) {
            Period memory prevPeriod = periods[currentPeriod];
            currentPeriod += 1;
            periods[currentPeriod].startTime = prevPeriod.endTime;
            periods[currentPeriod].endTime = prevPeriod.endTime.add(periodDuration);

            if (pendingProposals > 0) {
                pendingProposals = pendingProposals.sub(1);
            }
        }
    }
```
The reason this is done using a `while` loop is just in case an entire period passes without any Moloch interactions taking place.

### submitProposal
At any time, members can submit new proposals using their `delegateKey`.
1. Updates the period.
2. Transfers all tribute tokens to the `Moloch.sol` contract to be held in escrow until the proposal vote is completed and processed.
3. Sets the `startingPeriod` of the proposal.
4. Pushes the proposal to the end of the `proposalQueue`.

```
    function submitProposal(
        address applicant,
        address[] tributeTokenAddresses,
        uint256[] tributeTokenAmounts,
        uint256 votingSharesRequested
    )
        public
        payable
        onlyMemberDelegate
    {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];

        require(memberAddress == applicant || !members[applicant].isActive, "Moloch::submitProposal - applicant is an active member besides the proposer");
        require(msg.value == proposalDeposit, "Moloch::submitProposal - insufficient proposalDeposit");
        require(votingSharesRequested > 0, "Moloch::submitProposal - votingSharesRequested is zero");

        for (uint256 i = 0; i < tributeTokenAddresses.length; i++) {
            ERC20 token = ERC20(tributeTokenAddresses[i]);
            uint256 amount = tributeTokenAmounts[i];
            require(amount > 0, "Moloch::submitProposal - token tribute amount is 0");
            require(token.transferFrom(applicant, this, amount), "Moloch::submitProposal - tribute token transfer failed");
        }

        pendingProposals = pendingProposals.add(1);
        uint256 startingPeriod = currentPeriod + pendingProposals;

        Proposal memory proposal = Proposal(memberAddress, applicant, votingSharesRequested, startingPeriod, 0, 0, tributeTokenAddresses, tributeTokenAmounts, false);

        proposalQueue.push(proposal);
    }
```
The `startingPeriod` is set based on the `currentPeriod`, and the number of `pendingProposals` in queue before this one. If there are no pending proposals, then the starting period will be set to the next period. If there are pending proposals, the starting period is delayed by the number of pending proposals.

Existing members can earn additional voting shares through new proposals by
listing themselves as the `applicant`, but must call `submitProposal` themselves to do so.

### submitVote
While a proposal is in its voting period, members can submit their vote using their `delegateKey`.
1. Updates the period.
2. Saves the vote on the proposal struct by the member address.
3. Saves the vote on the member struct by the proposal index.
4. Based on their vote, adds the member's voting shares to the proposal `yesVotes` or `noVotes` tallies.

```
    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyMemberDelegate {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];

        Proposal storage proposal = proposalQueue[proposalIndex];
        Vote vote = Vote(uintVote);
        require(proposal.startingPeriod > 0, "Moloch::submitVote - proposal does not exist");
        require(currentPeriod >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(currentPeriod.sub(proposal.startingPeriod) < votingPeriodLength, "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        proposal.votesByMember[memberAddress] = vote;

        Member storage member = members[memberAddress];
        member.votesByProposal[proposalIndex] = vote;

        if (vote == Vote.Yes) {
            proposal.yesVotes.add(member.votingShares);
        } else if (vote == Vote.No) {
            proposal.noVotes.add(member.votingShares);
        }
    }
```

### processProposal
After a proposal has completed its grace period, anyone can call `processProposal` to tally the votes and either accept or reject it.
1. Updates the period.
2. Sets `proposal.processed = true` to prevent duplicate processing.
3. If quorum was reached and the vote passed:
   3.1. If the member was applying on their own behalf, add the requested voting shares to their existing voting shares, and update any votes on active proposals in the voting or grace periods to reflect their new voting power.
   3.2. If the applicant is a new member, save their data and set their default `delegateKey` to be the same as their member address.
   3.3. Update the `totalVotingShares`.
   3.4. Mints `lootTokens` equal the the voting shares (keeps them in the `Moloch.sol` contract).
   3.5. Transfer the tribute tokens being held in escrow to the `GuildBank.sol` contract.
4. Otherwise:
   4.1. Return all the tribute tokens being held in escrow to the applicant.
5. Finally, return the $5,000 ether `proposalDeposit`.
```
    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        require(proposal.startingPeriod > 0, "Moloch::processProposal - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");

        proposal.processed = true;
        uint256 i = 0;

        if (proposal.yesVotes.add(proposal.noVotes) >= (totalVotingShares.mul(QUORUM_NUMERATOR)).div(QUORUM_DENOMINATOR) && proposal.yesVotes > proposal.noVotes) {

            // if the proposer is the applicant, add to their existing voting shares
            if (proposal.proposer == proposal.applicant) {

                members[proposal.applicant].votingShares = members[proposal.applicant].votingShares.add(proposal.votingSharesRequested);

                // loop over their active proposal votes and add the new voting shares to any YES or NO votes
                uint256 currentProposalIndex = proposalQueue.length.sub(pendingProposals.add(1));
                uint256 oldestActiveProposal = (currentProposalIndex.sub(votingPeriodLength)).sub(gracePeriodLength);
                for (uint256 i = currentProposalIndex; i > oldestActiveProposal; i--) {
                    if (isActiveProposal(i)) {
                        Proposal storage proposal = proposalQueue[i];
                        Vote vote = member.votesByProposal[i];

                        if (vote == Vote.Null) {
                            // member didn't vote on this proposal, skip to the next one
                            continue;
                        } else if (vote == Vote.Yes) {
                            proposal.yesVotes = proposal.yesVotes.add(proposal.votingSharesRequested);
                        } else {
                            proposal.noVotes = proposal.noVotes.add(proposal.votingSharesRequested);
                        }
                    } else {
                        // reached inactive proposal, exit the loop
                        break;
                    }
                }
            // the applicant is a new member, create a new record for them
            } else {
                // use applicant address as delegateKey by default
                members[proposal.applicant] = Member(proposal.applicant, proposal.votingSharesRequested, true);
                memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
            }

            // mint new voting shares and loot tokens
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
```

### collectLootTokens

At any time, so long as a member has not voted YES on any active proposals in the voting or grace periods, they can *irreversibly* redeem their voting shares for loot tokens.

1. Update the period.
2. Reduce the member's voting shares by the `lootAmount` being collected.
3. Reduce the total voting shares by the `lootAmount`.
4. Transfer `lootAmount` of loot tokens to the provided `treasury` address.
5. Update any active NO votes to reflect the member's new voting power.

```
    function collectLootTokens(address treasury, uint256 lootAmount) public onlyMember {
        updatePeriod();

        Member storage member = members[msg.sender];

        require(member.votingShares >= lootAmount, "Moloch::collectLoot - insufficient voting shares");

        member.votingShares = member.votingShares.sub(lootAmount);
        totalVotingShares = totalVotingShares.sub(lootAmount);

        require(lootToken.transfer(treasury, lootAmount), "Moloch::collectLoot - loot token transfer failure");

        // loop over their active proposal votes:
        // - make sure they haven't voted YES on any active proposals
        // - update any active NO votes to reflect their new voting power.
        uint256 currentProposalIndex = proposalQueue.length.sub(pendingProposals.add(1));
        uint256 oldestActiveProposal = (currentProposalIndex.sub(votingPeriodLength)).sub(gracePeriodLength);
        for (uint256 i = currentProposalIndex; i > oldestActiveProposal; i--) {
            if (isActiveProposal(i)) {
                Proposal storage proposal = proposalQueue[i];
                Vote vote = member.votesByProposal[i];

                require(vote != Vote.Yes, "Moloch::collectLoot - member voted YES on active proposal");

                if (vote == Vote.Null) {
                    // member didn't vote on this proposal, skip to the next one
                    continue;
                }

                // member voted No, revert the vote.
                proposal.noVotes = proposal.noVotes.sub(lootAmount);

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
```

### updateDelegateKey

By default, when a member is accepted their `delegateKey` is set to their member
address. At any time, they can change it to be any address that isn't already in
use, or back to their member address.

1. Resets the old `delegateKey` reference in the `memberAddressByDelegateKey`
   mapping.
2. Sets the reference for the new `delegateKey` to the member in the
   `memberAddressByDelegateKey` mapping.
3. Updates the `member.delegateKey`.
```

    function updateDelegateKey(address newDelegateKey) public onlyMember {
        // newDelegateKey must be either the member's address or one not in use by any other members
        require(newDelegateKey == msg.sender || !members[memberAddressByDelegateKey[msg.sender]].isActive);
        Member storage member = members[msg.sender];
        memberAddressByDelegateKey[member.delegateKey] = address(0);
        memberAddressByDelegateKey[newDelegateKey] = msg.sender;
        member.delegateKey = newDelegateKey;
    }
```

### isActiveProposal

A proposal is considered active if it is either in the voting or grace period.

```
    // returns true if proposal is either in voting or grace period
    function isActiveProposal(uint256 proposalIndex) internal view returns (bool) {
        uint256 startingPeriod = proposalQueue[proposalIndex].startingPeriod;
        return (currentPeriod >= startingPeriod && currentPeriod.sub(startingPeriod) < votingPeriodLength.add(gracePeriodLength));
    }
```

# GuildBank.sol

## Data Structures

```
    LootToken public lootToken; // loot token contract reference
    mapping (address => bool) knownTokens; // true for tokens that have ever
    been deposited into the guild back
    address[] public tokenAddresses; // the complete set of unique token
    addresses held by guild bank

    mapping (uint256 => mapping (address => bool)) safeRedeemsById; // tracks
    token addresses already withdrawn for each unique safeRedeem attempt to
    prevent double-withdrawals
    uint256 safeRedeemId = 0; // incremented on every safeRedeem attempt
```

## Functions

### setLootTokenAddress

Called only once immediately after contract deployment by the owner. Updates the
`lootToken` address to point to the deployed `LootToken.sol` contract.

Immediately after calling this function, as part of the migration script, the
owner will call `transferOwnership` and make the `Moloch.sol` contract the
permanent owner.

```
    function setLootTokenAddress(address lootTokenAddress) public onlyOwner returns (address) {
        require (address(lootTokenAddress) != address(0), "GuildBank::setLootTokenAddress address must not be zero");
        require (address(lootToken) == address(0),"GuildBank::setLootTokenAddress Loot Token address already set");
        lootToken = LootToken(lootTokenAddress);
        return lootTokenAddress;
    }
```

### depositTributeTokens

Is called by the owner - the `Moloch.sol` contract - in the `processProposal`
function.

1. If this is the first token of it's kind being deposited, save its address in the
   `knownTokens` mapping and push its address to the `tokenAddresses` array.
2. Transfers the admitted member's escrowed tribute tokens from Moloch to the
   Guild Bank.

```
    function depositTributeTokens(
        address sender,
        address tokenAddress,
        uint256 tokenAmount
    ) public onlyOwner returns (bool) {
        if ((knownTokens[tokenAddress] == false) && (tokenAddress != address(lootToken))) {
            knownTokens[tokenAddress] = true;
            tokenAddresses.push(tokenAddress);
        }
        ERC20 token = ERC20(tokenAddress);
        return (token.transferFrom(sender, this, tokenAmount));
    }
```

### redeemLootTokens

Can be used by anyone to consume their loot tokens and withdraw a proportional share of
all tokens held by the guild bank.

1. Transfer `lootAmount` of loot tokens from the `msg.sender` to the guild bank.
2. Burn those loot tokens.
3. Transfer a proportional share of all tokens held by the guild bank to the
   provided `receiver` address.

```
    function redeemLootTokens(
        address receiver,
        uint256 lootAmount
    ) public {
        uint256 totalLootTokens = lootToken.totalSupply();

        require(lootToken.transferFrom(msg.sender, this, lootAmount), "GuildBank::redeemLootTokens - lootToken transfer failed");

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.burn(lootAmount);

        // transfer proportional share of all tokens held by the guild bank
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            ERC20 token = ERC20(tokenAddresses[i]);
            uint256 tokenShare = token.balanceOf(this).mul(lootAmount).div(totalLootTokens);
            require(token.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");
        }
    }
```

### safeRedeemLootTokens

If any of the tribute tokens held by the guild bank have transfer restrictions
that take effect, the `redeemLootTokens` function above would fail. To
circumvent this, loot token holders can provide the set of token addresses they want to withdraw themselves, and skip any that would fail.

This function exists to be a safegaurd, not to give members a free pass. Guild
members should all still be diligent to avoid accepting as tribute tokens that may
introduce transfer restrictions.

1. Increment the `safeRedeemId` - the unique id of each `safeRedeemLootTokens`
   function call.
2. Transfer `lootAmount` of loot tokens from the `msg.sender` to the guild bank.
3. Burn those loot tokens.
4. For all unique tokens addresses in the provided `safeTokenAddresses` array, transfer a proportional share of the guild bank holdings to the
   provided `receiver` address.

```
    function safeRedeemLootTokens(
        address receiver,
        uint256 lootAmount,
        address[] safeTokenAddresses
    ) public {
        safeRedeemId = safeRedeemId.add(1);

        uint256 totalLootTokens = lootToken.totalSupply();

        require(lootToken.transferFrom(msg.sender, this, lootAmount), "GuildBank::redeemLootTokens - lootToken transfer failed");

        // burn lootTokens - will fail if approved lootToken balance is lower than lootAmount
        lootToken.burn(lootAmount);

        // transfer proportional share of all tokens held by the guild bank
        for (uint256 i = 0; i < safeTokenAddresses.length; i++) {
            if (!safeRedeemsById[safeRedeemId][safeTokenAddresses[i]]) {
                safeRedeemsById[safeRedeemId][safeTokenAddresses[i]] = true;
                ERC20 token = ERC20(safeTokenAddresses[i]);
                uint256 tokenShare = token.balanceOf(this).mul(lootAmount).div(totalLootTokens);
                require(token.transfer(receiver, tokenShare), "GuildBank::redeemLootTokens - token transfer failed");
            }
        }
    }
```

The `safeRedeemsById` tracks token addresses already withdrawn for each unique `safeRedeemLootTokens` call to prevent double-withdrawals of the same token.

