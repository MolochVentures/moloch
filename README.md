# Moloch

> Moloch the incomprehensible prison! Moloch the crossbone soulless jailhouse and Congress of sorrows! Moloch whose buildings are judgment! Moloch the vast stone of war! Moloch the stunned governments!

> Moloch whose mind is pure machinery! Moloch whose blood is running money! Moloch whose fingers are ten armies! Moloch whose breast is a cannibal dynamo! Moloch whose ear is a smoking tomb!

~ Allen Ginsberg, Howl

Moloch is a grant-making DAO / Guild and a radical experiment in voluntary incentive alignment to overcome the "tragedy of the commons". Our objective is to accelerate the development of public Ethereum infrastructure that many teams need but don't want to pay for on their own. By pooling our ETH, teams building on Ethereum can collectively fund open-source work we decide is in our common interest.

This documentation will focus on the Moloch DAO system design and smart contracts. For a deeper explanation of the philosophy behind Moloch, please read the Slate Star Codex post, [Meditations on Moloch](http://slatestarcodex.com/2014/07/30/meditations-on-moloch/), which served as inspiration.

## Design Principles

In developing the Moloch DAO, we realized that the more Solidity we wrote, the greater the likelihood that we would lose everyone's money. In order to prioritize security, we took simplicity and elegance as our primary design principles. We consciously skipped many features, and the result is what we believe to be a Minimally Viable DAO.

## Overview

Moloch is described by two smart contracts:

1. `Moloch.sol` - Responsible for managing membership & voting rights, proposal submissions, voting, and processing proposals based on the outcomes of the votes.
2. `GuildBank.sol` - Responsible for managing Guild assets.

Moloch has a native asset called `shares`. Shares are minted and assigned when a new member is accepted into the Guild and provide voting rights on new membership proposals. They are non-transferrable, but can be *irreversibly* redeemed at any time to collect a proportional share of all ETH held by the Guild in the Guild Bank.

Moloch operates through the submission, voting on, and processing of a series of membership proposals. To combat spam, new membership proposals can only be submitted by existing members and require a 10 ETH deposit. Applicants who wish to join must find a Guild member to champion their proposal and have that member call `submitProposal` on their behalf. The membership proposal includes the number of shares the applicant is requesting, and either the amount of ETH the applicant is offering as tribute or a pledge that the applicant will complete some work that benefits the Guild.

All ETH offered as tribute is held in escrow by the `Moloch.sol` contract until the proposal vote is completed and processed. If a proposal vote passes, the applicant becomes a member, the shares requested are minted and assigned to them, and their tribute ETH is deposited into the `GuildBank.sol` contract. If a proposal vote is rejected, all tribute tokens are returned to the applicant. In either case, the 10 ETH deposit is returned to the member who submitted the proposal.

Proposals are voted on in the order they are submitted. The *voting period* for each proposal is 7 days. During the voting period, members can vote (only once, no redos) on a proposal by calling `submitVote`. There can be 5 proposals per day, so there can be a maximum of 35 proposals being voted on at any time (staggered by 4.8 hours). Proposal votes are determined by simple majority, with no quorum requirement.

At the end of the voting period, proposals enter into a 7 day *grace period* before the proposal is processed. The grace period gives members who voted **No** or didn't vote the opportunity to exit by calling the `ragequit` function and witdrawing their proportional share of ETH from the Guild Bank. Members who voted **Yes** must remain until the grace period expires and the proposal is processed, but only if the proposal passed. If the proposal failed, members who voted **Yes** can `ragequit` as well.

At the end of the grace period, proposals are processed when anyone calls `processProposal`. A 0.1 ETH reward is deducted from the proposal deposit and sent to the account to the address which calls `processProposal`.

#### Game Theory

By allowing Guild members to ragequit and exit at any time, Moloch protects its members from 51% attacks and from supporting proposals they vehemently oppose.

In the worst case, one or more Guild members who control >50% of the shares could submit a proposal to grant themselves a ridiculous number of new shares, thereby diluting all other members of their claims to the Guild Bank assets and effectively stealing from them. If this were to happen, everyone else would ragequit during the grace period and take their share of the Guild Bank assets with them, and the proposal would have no impact.

In the more likely case of a contentious vote, those who oppose strongly enough can leave and increase the funding burden on those who choose to stay. Let's say the Guild has 100 outstanding shares and $100M worth of ETH in the Guild Bank. If a project proposal requests 1 newly minted share (~$1M worth), the vote is split 50/50 with 100% voter turnout, and the 50 who voted **No** all ragequit and take their $50M with them, then the remaining members would be diluting themselves twice as much: 1/51 = ~2% vs. 1/101 = ~1%.

In this fashion, the ragequit mechanism also provides an interesting incentive in favor of Guild cohesion. Guild members are disincentivized from voting **Yes** on proposals that they believe will make other members ragequit. Those who do vote **Yes** on contentious proposals will be forced to additionally dilute themselves proportional to the fraction of Voting Shares that ragequit in response.

# Moloch.sol

## Data Structures

#### Global Constants
```
    uint256 public periodDuration; // default = 17280 = 4.8 hours in seconds (5 periods per day)
    uint256 public votingPeriodLength; // default = 7 periods
    uint256 public gracePeriodLength; // default = 7 periods
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
    uint256 public summoningTime; // needed to determine the current period

    ERC20 public approvedToken; // approved token contract reference; default = wETH
    GuildBank public guildBank; // guild bank contract reference

    uint8 constant QUORUM_NUMERATOR = 1;
    uint8 constant QUORUM_DENOMINATOR = 2;
```

All deposits and tributes use the singular `approvedToken` set at contract deployment. In our case this will be wETH, and so we use wETH and ETH interchangably in this documentation.

#### Internal Accounting
```
    uint256 public currentPeriod = 0; // the current period number
    uint256 public pendingProposals = 0; // the # of proposals waiting to be voted on
    uint256 public totalShares = 0; // total voting shares across all members
```
##### Proposals
The `Proposal` struct stores all relevant data for each proposal, and is saved in the `proposalQueue` array in the order it was submitted.
```
    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 sharesRequested; // the # of voting shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        uint256 tokenTribute; // amount of tokens offered as tribute
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 totalSharesAtLastVote; // the total # of shares at the time of the last vote on this proposal (used to bound maximum additional dilution in case of mass ragequit)
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping (address => bool) public isApplicant; // stores the applicant address while a proposal is active (prevents this address from being overwritten)
    Proposal[] public proposalQueue;
```

##### Members
The `Member` struct stores all relevant data for each member, and is saved in the `members` mapping by the member's address.
```
    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of voting shares assigned to this member
        bool isActive; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES
    }

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;
```
The `isActive` field is set to `true` when a member is accepted and remains `true` even if a member redeems 100% of their shares. It is used to prevent overwriting existing members (who may have ragequit all their shares).

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

## Modifiers

#### onlyMember
Checks that the `msg.sender` is the address of a member with at least 1 share.
```
    modifier onlyMember {
        require(members[msg.sender].shares > 0, "Moloch::onlyMember - not a member");
        _;
    }
```
Applied only to `ragequit` and `updateDelegateKey`.

#### onlyMemberDelegate
Checks that the `msg.sender` is the `delegateKey` of a member with at least 1 share.
```
    modifier onlyDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].shares > 0, "Moloch::onlyDelegate - not a member");
        _;
    }
```
Applied only to `submitProposal` and `submitVote`.

## Functions

### Moloch Constructor
1. Sets the `approvedToken` ERC20 contract reference.
2. Deploys a new `GuildBank.sol` contract and saves the reference.
3. Saves passed in values for global constants `periodDuration`, `votingPeriodLength`, `gracePeriodLength`, `proposalDeposit`, `dilutionBound`,  and `processingReward`.
4. Saves the start time of Moloch `summoningTime = now`.
6. Mints 1 share for the `summoner` and saves their membership.

```
    constructor(
        address summoner,
        address _approvedToken,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward
    ) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_approvedToken != address(0), "Moloch::constructor - _approvedToken cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");

        approvedToken = ERC20(_approvedToken);

        guildBank = new GuildBank(_approvedToken);

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        proposalDeposit = _proposalDeposit;
        dilutionBound = _dilutionBound;
        processingReward = _processingReward;

        summoningTime = now;

        members[summoner] = Member(summoner, 1, true, 0);
        memberAddressByDelegateKey[summoner] = summoner;
        totalShares = totalShares.add(1);
    }

```

### updatePeriod

In order to make sure all interactions with Moloch take place during the correct period, the `updatePeriod` function is called at the beginning of every state-updating function.

The difference between `now` and the `summoningTime` is used to figure out how many periods have elapsed and the `currentPeriod` is updated accordingly. The number of `pendingProposals` is decremented by the number of elapsed periods (1 new proposal is taken off the queue each period).

```
    function updatePeriod() public {
        uint256 newCurrentPeriod = now.sub(summoningTime).div(periodDuration);
        if (newCurrentPeriod > currentPeriod) {
            uint256 periodsElapsed = newCurrentPeriod.sub(currentPeriod);
            currentPeriod = newCurrentPeriod;
            pendingProposals = pendingProposals > periodsElapsed ? pendingProposals.sub(periodsElapsed) : 0;
        }
    }

```


### submitProposal
At any time, members can submit new proposals using their `delegateKey`.
1. Updates the period.
2. Transfers the proposal deposit and tribute ETH to the `Moloch.sol` contract to be held in escrow until the proposal vote is completed and processed.
3. Increments the number of `pendingProposals`.
4. Calculates the proposal starting period, creates a new proposal, and pushes the proposal to the end of the `proposalQueue`.
5. Saves the applicant address to the `isApplicant` mapping.

```
    function submitProposal(
        address applicant,
        uint256 tokenTribute,
        uint256 sharesRequested,
        string memory details
    )
        public
        onlyDelegate
    {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];

        // collect proposal deposit from proposer and store it in the Moloch until the proposal is processed
        require(approvedToken.transferFrom(msg.sender, address(this), proposalDeposit), "Moloch::submitProposal - proposal deposit token transfer failed");

        // collect tribute from applicant and store it in the Moloch until the proposal is processed
        require(approvedToken.transferFrom(applicant, address(this), tokenTribute), "Moloch::submitProposal - tribute token transfer failed");

        pendingProposals = pendingProposals.add(1);
        uint256 startingPeriod = currentPeriod.add(pendingProposals);

        // create proposal ...
        Proposal memory proposal = Proposal({
            proposer: memberAddress,
            applicant: applicant,
            sharesRequested: sharesRequested,
            startingPeriod: startingPeriod,
            yesVotes: 0,
            noVotes: 0,
            processed: false,
            tokenTribute: tokenTribute,
            details: details,
            totalSharesAtLastVote: totalShares
        });

        // ... and append it to the queue
        proposalQueue.push(proposal);

        // save the applicant address (to prevent delegate keys from overwriting it)
        isApplicant[proposal.applicant] = true;

        uint256 proposalIndex = proposalQueue.length.sub(1);
        emit SubmitProposal(proposalIndex, applicant, memberAddress);
    }
```
The `startingPeriod` is set based on the `currentPeriod`, and the number of `pendingProposals` in queue before this one. If there are no pending proposals, then the starting period will be set to the next period. If there are pending proposals, the starting period is delayed by the number of pending proposals.

Existing members can earn additional voting shares through new proposals if they are listed as the `applicant`.

### submitVote
While a proposal is in its voting period, members can submit their vote using their `delegateKey`.
1. Updates the period.
2. Saves the vote on the proposal by the member address.
3. Based on their vote, adds the member's voting shares to the proposal `yesVotes` or `noVotes` tallies.
4. If the member voted **Yes** and this is now the highest index proposal they voted **Yes** on, update their `highestIndexYesVote`.
5. Save the total shares at the time of the vote.

```
    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];
        Proposal storage proposal = proposalQueue[proposalIndex];
        Vote vote = Vote(uintVote);

        require(proposal.startingPeriod > 0, "Moloch::submitVote - proposal does not exist");
        require(currentPeriod >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");

        // store vote
        proposal.votesByMember[memberAddress] = vote;

        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares);

            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares);
        }

        // set total shares on proposal - used to bound dilution for yes voters
        proposal.totalSharesAtLastVote = totalShares;

        emit SubmitVote(msg.sender, memberAddress, proposalIndex, uintVote);
    }
```

### processProposal
After a proposal has completed its grace period, anyone can call `processProposal` to tally the votes and either accept or reject it. The caller receives 0.1 ETH as a reward.

1. Updates the period.
2. Sets `proposal.processed = true` to prevent duplicate processing.
3. Determine if the proposal passed or failed.
4. If the proposal passed:
    4.1. If the applicant is an existing member, add the requested shares to their existing shares.
    4.2. If the applicant is a new member, save their data and set their default `delegateKey` to be the same as their member address.
    4.3. Update the `totalShares`.
    4.4. Transfer the tribute ETH being held in escrow to the `GuildBank.sol` contract.
5. Otherwise:
   5.1. Return all the tribute being held in escrow to the applicant.
6. Send the processing reward to the address that called this function.
7. Send the proposal deposit back to the proposer.
8. Delete the applicant's entry in the `isApplicant` mapping.

```
    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        require(proposal.startingPeriod > 0, "Moloch::processProposal - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");
        require(proposalIndex == 0 || proposalQueue[proposalIndex.sub(1)].processed, "Moloch::processProposal - previous proposal must be processed");

        proposal.processed = true;

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares * dilutionBound < proposal.totalSharesAtLastVote) {
            didPass = false;
        }

        // PROPOSAL PASSED
        if (didPass) {

            // if the proposer is already a member, add to their existing voting shares
            if (members[proposal.applicant].isActive) {
                members[proposal.applicant].shares = members[proposal.applicant].shares.add(proposal.sharesRequested);

            // the applicant is a new member, create a new record for them
            } else {
                // use applicant address as delegateKey by default
                members[proposal.applicant] = Member(proposal.applicant, proposal.sharesRequested, true, 0);
                memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
            }

            // mint new voting shares
            totalShares = totalShares.add(proposal.sharesRequested);

            // transfer tokens to guild bank
            require(
                approvedToken.approve(address(guildBank), proposal.tokenTribute),
                "Moloch::processProposal - approval of token transfer to guild bank failed"
            );
            require(
                guildBank.deposit(proposal.tokenTribute),
                "Moloch::processProposal - passing vote token transfer failed"
            );

        // PROPOSAL FAILED
        } else {
            // return all tokens to the applicant
            require(
                approvedToken.transfer(proposal.applicant, proposal.tokenTribute),
                "Moloch::processProposal - failing vote token transfer failed"
            );
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

        // remove the isApplicant entry for the applicant
        isApplicant[proposal.applicant] = false;

        emit ProcessProposal(
            proposalIndex,
            proposal.applicant,
            proposal.proposer,
            didPass,
            proposal.sharesRequested
        );
    }
```

The `dilutionBound` is a safety mechanism designed to prevent a member from facing a potentially unbounded grant obligation if they vote YES on a passing proposal and the vast majority of the other members ragequit before it is processed. The `proposal.totalSharesAtLastVote` will be the total shares at the time of the last vote on the proposal. When the proposal is being processed, if members have ragequit and the total shares has dropped by more than the `dilutionBound` (default = 3), the proposal will fail. This means that members voting **Yes** will only be obligated to contribute *at most* 3x what the were willing to contribute their share of the proposal cost, if 2/3 of the shares ragequit.

### ragequit

At any time, so long as a member has not voted YES on any proposal in the voting period or any *passing* proposal in the grace period, they can *irreversibly* destroy some of their shares and receive a proportional sum of ETH from the Guild Bank.

1. Update the period.
2. Reduce the member's shares by the `sharesToBurn` being destroyed.
3. Reduce the total shares by the `sharesToBurn`.
4. Instruct the Guild Bank to send the member their proportional amount of ETH.

```
    function ragequit(uint256 sharesToBurn) public onlyMember {
        updatePeriod();

        uint256 initialTotalShares = totalShares;

        Member storage member = members[msg.sender];

        require(member.shares >= sharesToBurn, "Moloch::ragequit - insufficient voting shares");

        require(canRagequit(member.highestIndexYesVote), "Moloch::ragequit - can't ragequit until highest index proposal member voted YES on is processed or the vote fails");

        // burn voting shares
        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        // instruct guildBank to transfer fair share of tokens to the receiver
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn);
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
        // skip checks if member is setting the delegate key to their member address
        if (newDelegateKey != msg.sender) {
            require(!members[newDelegateKey].isActive, "Moloch::updateDelegateKey - can't overwrite existing members");
            require(!members[memberAddressByDelegateKey[newDelegateKey]].isActive, "Moloch::updateDelegateKey - can't overwrite existing delegate keys");
            require(!isApplicant[newDelegateKey], "Moloch::updateDelegateKey - can't overwrite existing applicants");
        }

        Member storage member = members[msg.sender];
        memberAddressByDelegateKey[member.delegateKey] = address(0);
        memberAddressByDelegateKey[newDelegateKey] = msg.sender;
        member.delegateKey = newDelegateKey;
    }
```

### Getters

#### canRagequit
```
    function canRagequit(uint256 highestIndexYesVote) public view returns (bool) {
        Proposal memory proposal = proposalQueue[highestIndexYesVote];

        return proposal.processed || (hasVotingPeriodExpired(proposal.startingPeriod) && proposal.noVotes >= proposal.yesVotes);
    }
```

#### hasVotingPeriodExpired
```
    function hasVotingPeriodExpired(uint256 startingPeriod) public view returns (bool) {
        return currentPeriod.sub(startingPeriod) >= votingPeriodLength;
    }
```

#### getMemberProposalVote
```
    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        return proposalQueue[proposalIndex].votesByMember[memberAddress];
    }
```

# GuildBank.sol

## Data Structures

```
    ERC20 public approvedToken; // approved token contract reference
```

## Functions

### constructor
1. Sets the `approvedToken` and saves the contract reference. Called by the  `Moloch.sol` constructor.
```
    constructor(address approvedTokenAddress) public {
        approvedToken = ERC20(approvedTokenAddress);
    }
```



### deposit

Is called by the owner - the `Moloch.sol` contract - in the `processProposal`
function if the proposal passed.

```
    function deposit(uint256 amount) public onlyOwner returns (bool) {
        emit Deposit(amount);
        return approvedToken.transferFrom(msg.sender, address(this), amount);
    }
```

### withdraw

Is called by the owner - the `Moloch.sol` contract - in the `ragequit`
function.

1. Transfer a proportional share of ETH held by the guild bank to the
   provided `receiver` address.

```
    function withdraw(address receiver, uint256 shares, uint256 totalShares) public onlyOwner returns (bool) {
        uint256 amount = approvedToken.balanceOf(address(this)).mul(shares).div(totalShares);
        emit Withdrawal(receiver, amount);
        return approvedToken.transfer(receiver, amount);
    }
```
