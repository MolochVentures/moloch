# Moloch Testing Guide

![tshirt](https://slatestarcodex.com/blog_images/moloch-tshirt.png)

> "Interesting," said Professor Quirrell. "That does sound similar. Is there a moral?"

> "That your strength as a rationalist is your ability to be more confused by fiction than by reality," said Harry. "If you're equally good at explaining any outcome, you have zero knowledge.

~ [Harry Potter and the Methods of Rationality](https://www.hpmor.com/chapter/26)

This document is intended to help those interested in learning about testing solidity in general, and also to act as a guide for testing future iterations of the Moloch smart contracts. It is organized as a set of principles and, where possible, examples demonstrating their practical application.

### Test Code Quality

Tests should be written, not only to verify correctness of the target code, but to be comprehensively reviewed by other programmers. Therefore, for mission critical solidity code, the quality of the tests are just as important (if not more so) than the code itself, and should be written with the highest standards of clarity and elegance.

### Tests Should Follow DRY (Don't Repeat Yourself)
The first pass of unit tests will inevitably proceed faster by copy-pasting the setup and verification code from one test to the next, but these duplicated lines of code get in the way of careful indedepent review. A reviewer must read *every* line of test code and must thus constantly fight the urge to gloss over certain lines that look the same as in the previous test, in case there is a slight but meaningful deviation that requires their evaluation.

After the first pass of unit tests, it is important to refactor the common setup and verification into their own functions. Not only does this save time for a reviewer who only has to review those functions once, but it also **emphasizes the differences** between unit test scenarios and make them easier to reason about.

#### Verification Functions

For each Moloch.sol function, the Moloch tests have a *verification function* that checks each state transition expected from the successful execution of the function.

For example, `verifySubmitVote` checks that the `proposal.yesVotes` or `proposal.noVotes` were tallied (depending on which way a member voted), that the `proposal.maxTotalSharesAtYesVote` is updated if needed, and that the vote is also recorded in the `proposal.votesByMember` mapping.

The `member.highestIndexYesVote` field is also conditionally updated by `submitVote`, but the conditional was complex enough to omit from the main verification function and check it separately.

#### Snapshot & Revert

The Moloch tests make heavy use of EVM snapshot & revert both to speed up the tests and to allow for less repetitive setup code.

```
  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      tokenTribute: 100,
      sharesRequested: 1,
      details: 'all hail moloch'
    }

    token.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })
```

The `beforeEach` is invoked before each unit test, and the `afterEach` is invoked after each unit test. The highest level `beforeEach` shown above takes a fresh snapshot, resets the global `proposal1` data to a predictable baseline, and transfers to the summoner their expected initial token balance. The `afterEach` simply reverts to the snapshot.

Nested in the next `describe` test block is another `beforeEach` which is invoked before only the unit tests in the `desribe` test block. The higher level `beforeEach` above is still called before this one on every unit test in the block.

`beforeEach_1 -> beforeEach_2 -> { test } -> afterEach`

```
  describe('submitProposal', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, {
        from: creator
      })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, {
        from: proposal1.applicant
      })
    })
    ...
```

This `beforeEach` performs the setup for the `submitProposal` unit tests by transferring the proposal applicant the required amount of tribute tokens, approving the transfer of those tokens from the applicant to the Moloch contract, and also approving the transfer of enough tokens to cover the proposal deposit from the summoner.

This setup code is re-used in the following 8 tests, which only minimally deviate from the initial setup in order to test various other scenarios. For example, the first happy case test simply calls submit proposal with the baseline `proposal1` parameters, and then calls the `verifySubmitProposal` to check the state transitions.

```
    it('happy case', async () => {
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.tokenTribute,
        proposal1.sharesRequested,
        proposal1.details,
        { from: summoner }
      )
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: proposal1.tokenTribute,
        initialProposerBalance: initSummonerBalance
      })
    })
```

The next unit test changes *ONLY* one thing, which is that it sets the shares requested to the 1e18 (1 x 10^18) to test the maximum value enforced by has been exceeded, and that the call to `submitProposal` properly fails with the correct error message from the triggered `require`: "too many shares requested".
```
    it('require fail - uint overflow', async () => {
      proposal1.sharesRequested = _1e18
      await moloch
        .submitProposal(
          proposal1.applicant,
          proposal1.tokenTribute,
          proposal1.sharesRequested,
          proposal1.details,
          { from: summoner }
        )
        .should.be.rejectedWith('too many shares requested')
    })
```

### Trigger Every Require / Assert

There are several reasons to write unit tests trigger every `require` (and `assert`, if you prefer to use those):
1. To make sure that the function fails when it should
2. To identify obviated `require` checks that no scenario can actually trigger
3. To force you, the tester, to reason about every single `require` and think about every single way your function can fail

When writing unit tests to trigger a `require` failure, it is important to follow DRY as described above and minimally deviate from the happy case baseline in setting up the unit test to make it exceptionally obvious what parameter has been changed that is now causing the function to fail.

It is also important to add unique `require` messages for each function and in the tests check for the specific error message from the `require` you intended to trigger to make sure not only that the function failed, but that it failed for the expected reason.

### Test Modifier Existence

Similar to `require` checks, the proper application of all modifiers should be tested. For example, the `submitProposal` unit tests check the `onlyDelegate` modifier to make sure it prevents access from non-delegates (changing *only* the `from` field from the summoner to the creator and leaving everything else the same).

```
    it('modifier - delegate', async () => {
      await moloch
        .submitProposal(
          proposal1.applicant,
          proposal1.tokenTribute,
          proposal1.sharesRequested,
          proposal1.details,
          { from: creator }
        )
        .should.be.rejectedWith('not a delegate')
    })
```

It is especially important to also test the existence of the `internal` modifier when used. To do so, remove the `internal` modifier from your function, write a test case that successfully executes your function, then add the `internal` modifier back to the function, and only then update your unit test to enforce a failing function call. Following this pattern helps prevent cases where you might forget to add `internal` back to the function, and the test still passes because the function call fails for some other reason.

### Test Boundary Conditions

For example, for most integer inputs, this means testing `0`, `1`, `uint_max`, and `uint_max - 1`. This will trigger any potential overflows that might otherwise not be caught by `require` checks. In Moloch we hard-coded a few upper limits for certain variables and also used `SafeMath` for all math operations to eliminate the risk of overflows.

```
// HARD-CODED LIMITS
// These numbers are quite arbitrary; they are small enough to avoid overflows when doing calculations
// with periods or shares, yet big enough to not limit reasonable use cases.
uint256 constant MAX_VOTING_PERIOD_LENGTH = 10**18; // maximum length of voting period
uint256 constant MAX_GRACE_PERIOD_LENGTH = 10**18; // maximum length of grace period
uint256 constant MAX_DILUTION_BOUND = 10**18; // maximum dilution bound
uint256 constant MAX_NUMBER_OF_SHARES = 10**18; // maximum number of shares that can be minted
```

We still check the boundaries, however, as it is not sufficient to check that the maximum value properly fails, it is also necessary to check that *one less than the maximum value* properly succeeds.

```
      it('success - request 1 less share than the overflow limit', async () => {
        proposal1.sharesRequested = _1e18.sub(new BN(1)) // 1 less
        await moloch.submitProposal(
          proposal1.applicant,
          proposal1.tokenTribute,
          proposal1.sharesRequested,
          proposal1.details,
          { from: summoner }
        )
        await verifySubmitProposal(proposal1, 0, summoner, {
          initialTotalShares: 1,
          initialApplicantBalance: proposal1.tokenTribute,
          initialProposerBalance: initSummonerBalance
        })
      })

```

### Test All Code Paths

This likely goes without saying but 100% of the code paths must be tested. For every conditional evaluation, there should be a unique test for each possible outcome. Combinations of conditionals inside a single `if` statement (e.g. `if (a && b)` should be treated as separate conditions (e.g. 4 tests) even if the resulting code path is the same. This combinatorial complexity of code interactions is the fundamental reason why it is so important to keep the smart contract code as simple as possible—not doing so results in exponentially more tests required.

### Test in a Logical Progression

Like any codebase, the tests should provide an intuitive map of the territory. The tests should roughly align with the usage flow of the smart contract. For example, the Moloch tests are organized in the same order as the Moloch.sol smart contract:
1. constructor
2. submitProposal
3. submitVote
4. processProposal
5. ragequit
6. abort
7. updateDelegateKey
8. more complex tests (multi-member/proposal)

The unit tests for each function are organized as follows:
1. happy cases
2. trigger requires
3. check modifiers
4. edge cases
