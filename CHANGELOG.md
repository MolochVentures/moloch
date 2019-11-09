# Changelog
## GuildBank
- removed constructor
- removed `approvedToken` reference
- updated `withdraw` to support multi-token withdrawals
- add `withdrawToken` to allow for token payments of specific amounts

## Moloch.sol -> MolochVentures.sol

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
- add `address tokenToWhitelist`

##### Globals
- add `mapping (address => bool) public proposedToWhitelist` to prevent duplicate active token whitelist proposals

##### `submitWhitelistProposal`
- new function to propose adding a token to the whitelist
- enforces that the token address isn't null or already whitelisted
- saves a proposal with all other params set to null except the `tokenToWhitelist` address

##### `processProposal`
- on a passing whitelist proposal, add the token to whitelist
- remove token from `proposedToWhitelist` so another proposal to whitelist the token can be made (assuming it failed)

### Emergency Exit
Multi-token support comes with the risk of any individual token breaking or getting stuck in escrow if for whatever reason transfer restrictions prevent it from being transferred. For example, if the members add USDC to the whitelist, a proposal is made with USDC offered as tribute, and before the proposal is processed the applicant is added to the USDC blacklist, then should the proposal fail the applicant will be unable to have their escrowed USDC tribute offering returned to them because the USDC transfer would fail, which in turn would make the entire `processProposal` function call fail. To make matters worse, because Moloch proposals must be processed *in order*, none of the proposals after the failing one would be able to be processed either, and even though the guild bank funds would be safe and could be ragequit, any escrowed tribute on active proposals would be stuck forever.

To counter this, we add a concept of `emergencyProcessing` which kicks in for proposals that still haven't been processed after an `emergencyExitWait` period (e.g 1 week) has passed from the time they should have been processed. During `emergencyProcessing`, a proposal auto-fails (even if the votes were passing) but skips returning the escrowed tribute offered to the applicant.

Fortunately, after the stuck proposal is processed all subsequent proposals also stuck as result will be able to be processed immediately.

The emergency exit is the second line of defense after the token whitelist to defend against malicious or disfunctional tokens. If a whitelisted token breaks, however, any member can submit a proposal using the broken token as tribute and get it stuck in processing, so the best course of action is likely for the members to all ragequit and reform, and take extra precautions against whitelisting tokens with transfer restrictions.

##### Globals
- add `uint256 public emergencyExitWait`

##### `constructor`
- save `emergencyExitWait`

##### `processProposal`
- if the proposal should have been processed more than `emergencyExitWait` periods ago, active `emergencyProcessing` and auto-fail the proposal
- if `emergencyProcessing` has been activated, skip returning tribute to the applicant

### Submit -> Sponsor Flow
As Nomic Labs explained in their [audit report](https://medium.com/nomic-labs-blog/moloch-dao-audit-report-f31505e85c70), approving ERC20 tokens to Moloch is unsafe.

>>> Approving the Moloch DAO to transfer your tokens is, in general, unsafe. Users need to approve tokens to be a proposer or an applicant, but they can end up as the applicant of an unwanted proposal if someone attacks them, as explained in [MOL-L01].

>>> This also has an impact in the UX, as submitting a proposal requires three transactions (2 approvals, 1 submitProposal call). This is in contrast to one of the most common UX pattern for approval, which consists of only calling approve once, with MAX_INT as value. If someone were to use that pattern, she will be in a vulnerable situation.

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
To allow the members to take risks on new members, we add the guild kick proposal type. The guild kick proposal, if it passes, has the same effect as if a member ragequit 100% of their shares—they have their proportional share of all guild bank assets transferred to them.

##### Proposal Struct
- add `address memberToKick`

##### Globals
- add `mapping (address => bool) public proposedToKick` to prevent duplicate active guild kick proposals

##### `submitGuildKickProposal`
- new function to propose kicking a member
- enforces that the member exists (has shares)
- saves a proposal with all other params set to null except the `memberToKick` address

##### `processProposal`
- on a passing guild kick proposal, ragequit 100% of the member's shares
- remove member address from `proposedToKick` so another proposal to kick the member can be made (assuming it failed)

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
