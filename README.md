STEAL THIS CODE

# Moloch v2
![Worship Moloch](https://cdn.discordapp.com/attachments/583914506389028865/641047975421804584/2019-11-04_14.55.39.jpg)

> Moloch whose love is endless oil and stone! Moloch whose soul is electricity and banks! Moloch whose poverty is the specter of genius! Moloch whose fate is a cloud of sexless hydrogen! Moloch whose name is the Mind!

> Moloch! Moloch! Robot apartments! invisible suburbs! skeleton treasuries! blind capitals! demonic industries! spectral nations! invincible madhouses! granite cocks! monstrous bombs!

~ Allen Ginsberg, Howl

Moloch v2 is an upgraded version of MolochDAO that allows the DAO to acquire and spend multiple different tokens, instead of just one. It introduces the Guild Kick proposal type which allows members to forcibly remove another member (their assets are refunded in full). It also also allows for issuing non-voting shares in the form of Loot. Finally, v2 fixes the "unsafe approval" issue raised in the original [Nomic Labs audit](https://medium.com/nomic-labs-blog/moloch-dao-audit-report-f31505e85c70).

For a primer on Moloch v1, please visit the [original documentation](https://github.com/MolochVentures/moloch/tree/minimal-revenue/v1_contracts).

## Design Principles
In developing Moloch v2, we stuck with our ruthless minimalism, deviating as little as possible from the original while dramatically improving utility. We skipped many features again and believe our design represents a Minimally Viable For-Profit DAO, yet one flexible enough to support a variety of use decentralized cases, including venture funds, hedge funds, investment banks, and incubators.

## Overview

Moloch v2 is designed to extend MolochDAO's operations from purely single-token public goods grants-making to acquiring and spending (or investing in) an unlimited portfolio of assets.

Proposals in Moloch v2 now specify a **tribute token** and a **payment token**, which can be any whitelisted ERC20. Membership proposals which offer tribute tokens in exchange for shares can now offer any token, possibly helping balance the DAO portfolio. Grant proposals can now be in both shares and a stablecoin payment token to smooth out volatility risk, or even skip shares entirely to pay external contractors without awarding membership. Members can also propose *trades* to swap tokens OTC with the guild bank, which could be used for making investments, active portfolio management, selloffs, or just to top off a stablecoin reserve used to pay for planned expenses.

In addition to standard proposals above, there are two special proposals. The first is for whitelisting new tokens to be eligible as tribute, and the second is for removing DAO members via Guild Kick. Both follow the same voting mechanics as standard proposals (no quorum, simple majority rules).

### MolochLAO

In order to limit legal liability on members of a for-profit deployment of Moloch v2, the members may opt to form a [LAO](https://www.thelao.io/). LAOs are DAOs wrapped in a legally compliant entity, such as an LLC or C-Corp. The LAO can enter legal contracts, custody offchain assets (e.g. SAFTs), and distribute dividends. Investors in a LAO must be accredited, but service providers compensated in LAO shares can earn their shares of the LAO portfolio.

The current Moloch v2 contract standard was designed through a [collaborative effort](https://medium.com/@thelaoofficial/the-lao-joins-forces-with-moloch-dao-and-metacartel-to-begin-to-standardize-dao-related-smart-b6ee4b0db071) between MetaCartel, ConsenSys’s The LAO, and Moloch. The MetaCartel [Venture DAO](https://twitter.com/venture_dao) is expected to be the first deployment of Moloch v2 and blaze the trail for other for-profit DAOs to follow. Check out the Venture DAO [whitepaper](https://github.com/metacartel/MCV/blob/master/MCV-Whitepaper.md) for more information.

##### Security Tokens

To interface with offchain securities like SAFTs, the MolochLAO will issue security tokens that follow the Claims Token Standard [ERC-1843](https://github.com/ethereum/EIPs/issues/1843) and the Simple Restricted Token Standard [ERC-1404](https://github.com/ethereum/EIPs/issues/1404). Upon distribution of the SAFT tokens, the LAO custodian would send them to the claims token contract to be distributed to the claims token holders.

For equity, debt, or other revenue yielding securities the LAO custodian would receive the proceeds, liquidate to a token suitable for dividends (e.g. DAI) and then send the dividend tokens to the claims token contract to be distributed to the claims token holders.

Members that ragequit and receive their fraction of all LAO-held security claims tokens will still be able to use their various claims token to withdraw their dividends from each claims token contract.

Transfer restrictions will be enforced such that the security claims tokens can only be transferred to other DAO members, or other addresses whitelisted by the LAO admins.

## Installation

To intall this project run `npm install`.

## Testing

To tests the contracts run `npm run test`.

To compute their code coverage run `npm run coverage`.

## Deploying an interacting with a Moloch DAO and a Pool

This project includes Buidler tasks for deploying and using DAOs and Pools.

#### Deploying a new DAO

Follow this instructions to deploy a new DAO:

1. Edit `buidler.config.js`, setting the values for `INFURA_API_KEY` and `MAINNET_PRIVATE_KEY`.
2. Edit `deployment-params.js`, setting your desired deployment parameters.
3. Run `npx buidler moloch-deploy --network mainnet`
4. Edit `buidler.config.js`, setting the address of the DAO in `networks.mainnet.deployedContracts.moloch`.

#### Deploying a new Pool

Follow this instructions to deploy a new Pool:

1. Edit `buidler.config.js`, setting the values for `INFURA_API_KEY` and `MAINNET_PRIVATE_KEY`.
2. Make sure you have the right address in `buidler.config.js`'s `networks.mainnet.deployedContracts.moloch` field.
3. Run `npx buidler pool-deploy --network mainnet --shares <shares> --tokens <tokens>` with the initial amount of tokens you want to donate to the pool, and how many shares you want in return.

### Interacting with the smart contracts

This project has tasks to work with DAOs and Pools. To use them, you should first follow this instructions:

1. Edit `buidler.config.js`, setting the values for `INFURA_API_KEY` and `MAINNET_PRIVATE_KEY`.
2. Make sure you have the right address in `buidler.config.js`'s `networks.mainnet.deployedContracts.moloch` field.
3. If you want to use a Pool, make sure you have the right address in `buidler.config.js`'s `networks.mainnet.deployedContracts.pool` field.

After following those instructions, you can run `npx buidler` to get a list with all the tasks:

```
$ npx buidler
AVAILABLE TASKS:

  clean                         Clears the cache and deletes all artifacts
  compile                       Compiles the entire project, building all artifacts
  console                       Opens a buidler console
  flatten                       Flattens and prints all contracts and their dependencies
  help                          Prints this message
  moloch-deploy                 Deploys a new instance of the Moloch DAO
  moloch-process-proposal       Processes a proposal
  moloch-ragequit               Ragequits, burning some shares and getting tokens back
  moloch-submit-proposal        Submits a proposal
  moloch-submit-vote            Submits a vote
  moloch-update-delegate        Updates your delegate
  pool-add-keeper               Adds a keeper
  pool-deploy                   Deploys a new instance of the pool and activates it
  pool-deposit                  Donates tokens to the pool
  pool-keeper-withdraw          Withdraw other users' tokens from the pool
  pool-remove-keeper            Removes a keeper
  pool-sync                     Syncs the pool
  pool-withdraw                 Withdraw tokens from the pool
  run                           Runs a user-defined script after compiling the project
  test                          Runs mocha tests
```


You can run `npx buidler help <task>` to get help about each tasks and their parameters. For example:

```
$ npx buidler help moloch-submit-proposal
Buidler version 1.0.0-beta.7

Usage: buidler [GLOBAL OPTIONS] moloch-submit-proposal --applicant <STRING> --details <STRING> --shares <STRING> --tribute <STRING>

OPTIONS:

  --applicant   The address of the applicant
  --details     The proposal's details
  --shares      The number of shares requested
  --tribute     The number of token's wei offered as tribute

moloch-submit-proposal: Submits a proposal

For global options help run: buidler help
```

# Changelog v2

![Many
Molochs](https://cdn.discordapp.com/attachments/583914506389028865/643303589254529025/molochs.jpeg)

> To expect God to care about you or your personal values or the values of your civilization, that’s hubris.

> To expect God to bargain with you, to allow you to survive and prosper as long as you submit to Him, that’s hubris.

> To expect to wall off a garden where God can’t get to you and hurt you, that’s hubris.

> To expect to be able to remove God from the picture entirely…well, at least it’s an actionable strategy.

> I am a transhumanist because I do not have enough hubris not to try to kill God.

~ Scott Alexander, [Meditations on Moloch](http://slatestarcodex.com/2014/07/30/meditations-on-moloch/)

Moloch v2 is minimally different from Moloch v1, please read the [original documentation](https://github.com/MolochVentures/moloch/tree/master/v1_contracts) first, and then the changelog below.

## GuildBank.sol
- removed constructor
- removed `approvedToken` reference
- removed **SafeMath** dependency
- updated `withdraw` to support multi-token withdrawals
- add `withdrawToken` to allow for token payments of specific amounts
- add `fairShare` to prevent overflows from large token balances
- inline `onlyOwner` modifier and remove dependency on `Owned.sol`

## Moloch.sol

### General Changes

* store the `summoner` address, which is used to assist with **bailouts**

In order to circumvent Solidity's 16 parameter "stack too deep" error we
combined several proposal flags in the Proposal struct into the *flags* array.

```
struct Proposal {
  // ...
  bool[6] flags; // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
  // 0. sponsored - true only if the proposal has been submitted by a member
  // 1. processed - true only if the proposal has been processed
  // 2. didPass - true only if the proposal passed
  // 3. cancelled - true only if the proposer called cancelProposal before a member sponsored the proposal
  // 4. whitelist - true only if this is a whitelist proposal, NOTE - tributeToken is target of whitelist
  // 5. guildkick - true only if this is a guild kick proposal, NOTE - applicant is target of guild kick
  // ...
}
```

### Multi-Token Support

##### Proposal Struct
Add the following tribute/payment params to allow proposals to offer tribute and request payment in ERC20 tokens specified at the time. In theory they can be the same token, although that wouldn't make a lot of sense.
- add `uint256 tributeOffered` (renamed from `tokenTribute`)
- add `IERC20 tributeToken`
- add `uint256 paymentRequested`
- add `IERC20 paymentToken`

##### Globals
Track the whitelisted tokens in a mapping (to check if that token is on the whitelist) and an array (to iterate over them when ragequitting to give members a proportional share of all assets).
- add `mapping (address => IERC20) public tokenWhitelist`
- add `IERC20[] public approvedTokens`

##### `constructor`
- replace single `approvedToken` with an array: `approvedTokens`
- iterate through `approvedTokens` and save them to storage

##### `submitProposal`
- add tribute/payment token params
- enforce tribute/payment tokens are on whitelist
- save tribute/payment to proposal

##### `processProposal`
- auto-fail the proposal if guild bank doesn't have enough tokens for requested payment
- on successful proposal, transfer requested payment tokens to applicant using `guildBank.withdrawToken`

##### `ragequit`
- withdraw proportional share of all whitelisted tokens by calling `guildBank.withdraw` with the array of approved tokens

##### `safeRagequit`
- allow a member to specify the array of tokens to withdraw (and thus, which to leave behind) in case any whitelisted tokens get stuck in the guild bank

### Adding Tokens to Whitelist

##### Proposal Struct
- tributeToken -> token to whitelist
- proposal.flags[4] -> whitelist flag

##### Globals
- add `mapping (address => bool) public proposedToWhitelist` to prevent duplicate active token whitelist proposals

##### `submitWhitelistProposal`
- new function to propose adding a token to the whitelist
- enforces that the token address isn't null or already whitelisted
- saves a proposal with all other params set to null except the whitelist flag
  and `tributeToken` address (tributeToken acts as token to whitelist)

##### `processWhitelistProposal`
- new function to process whitelist proposals
- on a passing whitelist proposal, add the token to whitelist
- remove token from `proposedToWhitelist` so another proposal to whitelist the token can be made (assuming it failed)

### Emergency Processing
Multi-token support comes with the risk of any individual token breaking or getting stuck in escrow if for whatever reason transfer restrictions prevent it from being transferred. For example, if the members add USDC to the whitelist, a proposal is made with USDC offered as tribute, and before the proposal is processed the applicant is added to the USDC blacklist, then should the proposal fail the applicant will be unable to have their escrowed USDC tribute offering returned to them because the USDC transfer would fail, which in turn would make the entire `processProposal` function call fail. To make matters worse, because Moloch proposals must be processed *in order*, none of the proposals after the failing one would be able to be processed either, and even though the guild bank funds would be safe and could be ragequit, any escrowed tribute on active proposals would be stuck forever.

To counter this, we add a concept of `emergencyProcessing` which kicks in for proposals that still haven't been processed after an `emergencyProcessingWait` period (e.g 1 week) has passed from the time they should have been processed. During `emergencyProcessing`, a proposal auto-fails (even if the votes were passing) but skips returning the escrowed tribute offered to the applicant.

Fortunately, after the stuck proposal is processed all subsequent proposals also stuck as result will be able to be processed immediately. *Unfortunately* this breaks one of the core assumptions of Moloch, which is that members should have ample opportunity to ragequit ahead of passing proposals they strongly oppose. Consider the case where a member votes YES on good proposal #10, which enters emergency processing, but wants to ragequit before bad proposal #11. If the stuck proposals are processed all at once, the member will almost certainly not have the chance to ragequit before bad proposal #11.

To address the case above, we track the index of the last proposal to enter emergency processing, and should any subsequently processed proposals be calculated to have been in the grace period when that proposal was emergency processed, they automatically fail, even if the vote passed. This provides better security for the members because failing proposals can't spend their money, so the potential cost to the members is only being forced to re-submit any proposals that might have failed in order to try again.

The emergency processing is the second line of defense after the token whitelist to defend against malicious or disfunctional tokens. If a whitelisted token breaks, however, any member can submit a proposal using the broken token as tribute and get it stuck in processing, so the best course of action is likely for the members to all ragequit and reform, and take extra precautions against whitelisting tokens with transfer restrictions.

##### Globals
- add `uint256 public emergencyProcessingWait`
- add `bool emergencyWarning` -> true if any proposal has ever triggered emergency processing
- add `uint256 lastEmergencyProposalIndex` -> used to auto-fail proposals that are in the grace period when a previous proposal is emergency processed

##### `constructor`
- save `emergencyProcessingWait`

##### `processProposal`
- if the proposal should have been processed more than `emergencyProcessingWait` periods ago, active `emergencyProcessing` and auto-fail the proposal
- if `emergencyProcessing` has been activated, skip returning tribute to the applicant
- if this proposal was in the grace period when a previous proposal was emergency processed, automatically fail

### Submit -> Sponsor Flow
As Nomic Labs explained in their [audit report](https://medium.com/nomic-labs-blog/moloch-dao-audit-report-f31505e85c70), approving ERC20 tokens to Moloch is unsafe.

> Approving the Moloch DAO to transfer your tokens is, in general, unsafe. Users need to approve tokens to be a proposer or an applicant, but they can end up as the applicant of an unwanted proposal if someone attacks them, as explained in [MOL-L01].

> This also has an impact in the UX, as submitting a proposal requires three transactions (2 approvals, 1 submitProposal call). This is in contrast to one of the most common UX pattern for approval, which consists of only calling approve once, with MAX_INT as value. If someone were to use that pattern, she will be in a vulnerable situation.

To fix this, we change the submission process from only allowing members to submit proposals to allowing *anyone* to submit proposals but then only adding them to the proposal queue when a member **sponsors** the proposal.

##### Proposal Struct
- `address proposer` is now whoever calls `submitProposal` (can be non-member)
- add `address sponsor` which is the member that calls `sponsorProposal`
- add `cancelled` to indicate if the proposal has been cancelled by its proposer
- remove `aborted` which existed to address the unsafe approval vulnerability

##### Globals
- add `mapping (uint256 => Proposal) public proposals` to store all proposals by ID
- change `uint256[] public proposalQueue` to only store a reference to the proposal by its ID
- add `proposalCount` which monotonically increases on each proposal submission and acts as the ID

Note - as a result of this change, getting the proposal details from the proposal index changed across the codebase from `proposalQueue[proposalIndex]` to `proposals[proposalQueue[proposalIndex]]` as the former now only returns the proposal ID, which must be used to lookup the proposal details from the `proposals` mapping.

##### `submitProposal`
- saves proposal by ID, but **does not** add it to the `proposalQueue`
- transfers tribute tokens from the `msg.sender` (`proposer`)

Because tribute always comes from the `proposer` and not the `applicant`, there is never a situation where someone else can initiate an action to pull *your* tokens into Moloch, so you are safe to approve Moloch once for the maximum amount of any token you wish to offer as tribute.

##### `sponsorProposal`
- can only be called by a member
- sponsor escrows the proposal deposit
- checks that proposal has not been sponsored or cancelled
- checks to prevent duplicate `tokenWhitelist` and `guildKick` proposals
- adds the proposal to the `proposalQueue`

##### `processProposal`
- if failing, refunds escrowed tribute to the proposer, **not the applicant**

##### `cancelProposal`
If a proposal has been submitted but no members are interested in sponsoring it, the proposer needs a way to withdraw their escrowed tribute. They do this by calling `cancelProposal`, which they can only do before a member sponsors the proposal.
- can only be called by proposal `proposer` (whoever called `submitProposal`)
- checks that the proposal has not been already sponsored
- sets `cancelled` to true on the proposal
- returns escrowed tribute to the proposer

##### remove `abort` function
The abort functionality existed primarily to address the unsafe approval vulnerability by allowing applicants to abort unexpected and/or malicious proposals and have their tribute returned. However, with the new submit -> sponsor process, there is no risk to approved funds and the abort function and all references can be safely removed.

### Guild Kick
To allow the members to take risks on new members, we add the guild kick proposal type. The guild kick proposal, if it passes, puts the member in "jail" until all proposals they have voted YES on have been processed, forcing them to stay in the DAO and be party to any consequences of those proposals. When a member is jailed, 100% of their shares are converted to loot and thus they lose the ability to sponsor, vote on, or be the beneficiary (applicant) of any further proposals.

##### Proposal Struct
- applicant -> member to kick
- proposal.flags[5] -> guild kick flag

##### Member Struct
- add `jailed` -> the index of the proposal which jailed the member was jailed

##### Globals
- add `mapping (address => bool) public proposedToKick` to prevent duplicate active guild kick proposals

##### `submitGuildKickProposal`
- new function to propose kicking a member
- enforces that the member exists (has shares or loot)
- saves a proposal with all other params set to null except the guild kick flag
  and the `applicant` address (applicant acts as member to kick)

##### `processGuildKickProposal`
- a new function to process guild kick proposals
- on a passing guild kick proposal, convert 100% of the member's shares into loot and set `jailed` to the proposal index
- remove member address from `proposedToKick` so another proposal to kick the member can be made (assuming it failed)

### Ragekick
After a member has been jailed as a result of a passing guild kick proposal, once all the proposals they have voted YES on are processed, anyone can call the `ragekick` function to forcibly redeem the member's loot for their proportional share of the guild bank's tokens. This is effectively the same thing as the member calling `ragequit` themselves.

##### `ragekick`
- a new function to kick jailed members
- checks that member is jailed and has loot
- checks that `bailoutWait` hasn't passed

### Bailout
It is possible that a jailed member can not be ragekicked and chooses not to ragequit themselves. For example, if a member has their address blacklisted by one of the approved tokens in the guildbank, all attempts to `ragekick` will fail. The member could still call `safeRagequit` to withdraw all assets *except* the token that blacklisted them, but if they choose not to (or have lost access t their member key) then something else must be done.

Enter the new `bailout` function, which allows anyone to, after waiting the `bailoutWait` time, transfer all the member's loot to the summoner. The summoner is then expected to withdraw the assets and return it to the member, although this is not enforced by the smart contracts.

##### `bailout`
- a new function to transfer a stuck jailed member's loot to the summoner

##### Globals
- add `bailoutWait` to eventually allow stuck jailed members to be bailed out by the summoner

##### `constructor`
- enforce that `bailoutWait` is greater than `emergecyProcessingWait` (see below for explanation)

##### `canBailout`
- a new function to check if the `bailoutWait` has passed

Specifically, the `bailoutWait` starts from either the time the guild kick proposal passed (if the member had no YES votes on proposals pending processing) or from the time that their final YES vote proposal is processed. If the `bailoutWait` is set to 2 weeks, then the member could be bailed out after 2 weeks (if no YES votes) or a maximum of 4 weeks (if they voted YES on a proposal that *just* entered the voting period right before the guild kick propoosal against them was processed).

Please note that even in the edge case where a member votes YES on a proposal that just entered the voting period right before they are guild kicked, it is still possible for the voted-on proposal to have its processing delayed by entering `emergencyProcessing`. As a result, the constructor enforces that the `bailoutWait` must be greater than the `emergencyProcessingWait` to avoid this edge case.

### Loot
To allow the DAO to issue non-voting shares, we introduce the concept of Loot. Just like shares, loot is requested via proposal, issued to specific members and non-transferrable, and can be redeemed (via ragequit) on par with shares for a proportional fraction of assets in the Guild Bank. However, loot do not count towards votes and DAO members with *only* loot will not be able to sponsor proposals or vote on them. Non-shareholder members with loot will also be prevented from updating their delegate keys as they wouldn't be able to use them for anything anyways.

##### Proposal Struct
- add `lootRequested`
- update `maxTotalSharesAtYesVote` -> `maxTotalSharesAndLootAtYesVote`

##### Member Struct
- add `loot`

##### Globals
- add `totalLoot`
- update `totalSharesRequested` -> `totalSharesAndLootRequested`
- update `MAX_NUMBER_OF_SHARES` -> `MAX_NUMBER_OF_SHARES_AND_LOOT`
- add `onlyShareholder` modifier to be members with at least 1 share (not loot)
- update `onlyMember` modifier to be members with at least 1 share **or 1 loot**

##### `submitProposal`
- add `lootRequested` param

##### `sponsorProposal`
- check that `MAX_NUMBER_OF_SHARES_AND_LOOT` won't be exceeded
- update `totalSharesAndLootRequested`

##### `submitVote`
- update `maxTotalSharesAndLootAtYesVote` if necessary

##### `processProposal`
- update `totalSharesAndLootRequested`
- assign loot to member if proposal passes
- update `totalLoot` if proposal passes

Note - the dilution bound exists to prevent share based overpayment resulting from mass ragequit, and thus takes loot into account when calculating the anticipated dilution.

##### `ragequit`
- use updated `onlyMember` modifier (so loot holders can ragequit)
- add `lootToBurn` param

##### `safeRagequit`
- use updated `onlyMember` modifier (so loot holders can ragequit)
- add `lootToBurn` param

##### `updateDelegateKey`
- use `onlyShareholder` modifier to prevent loot-only members from updating delegate keys

### Deposit Token
To enforce consistency of the proposal deposits and processing fees (which were previously simply the sole `approvedToken`) we set a fixed `depositToken` at contract deployment.

##### Globals
- add `IERC20 public depositToken`

##### `constructor`
- save `depositToken` from the first value of the `approvedTokens` array

##### `sponsorProposal`
- collect proposal deposit from the sponsor

##### `processProposal`
- transfer processing reward in `depositToken` to whoever called `processProposal`
- return remaining deposit to proposer


![Goodbye](https://cdn.discordapp.com/attachments/583914506389028865/636359193154289687/image0.jpg)
