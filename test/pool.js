const { artifacts, web3, ethereum } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

chai
  .use(require('chai-as-promised'))
  .should()

const BN = web3.utils.BN

const Moloch = artifacts.require('Moloch')
const MolochPool = artifacts.require('MolochPool')
const Token = artifacts.require('Token')

const MAX_NUMBER_OF_SHARES = new BN(10).pow(new BN(30))
const MAX_UINT256 = new BN(2).pow(new BN(256)).sub(new BN(1))

const PERIOD_DURATION_IN_SECONDS = 17280
const VOTING_DURATON_IN_PERIODS = 35
const GRACE_DURATON_IN_PERIODS = 35
const ABORT_WINDOW_IN_PERIODS = 5
const PROPOSAL_DEPOSIT = 10
const DILUTION_BOUND = 3
const PROCESSING_REWARD = 1

const TOKEN_SUPPLY = new BN(10).pow(new BN(18)).mul(new BN(1000000000))

const VOTE_YES = 1
const VOTE_NO = 2

async function advanceTime (seconds) {
  await ethereum.send('evm_increaseTime', [seconds])
  await ethereum.send('evm_mine', [])
}

async function advanceTimeInPeriods (periods) {
  await advanceTime(periods * PERIOD_DURATION_IN_SECONDS)
}

function assertEventArgs (event, ...args) {
  for (let i = 0; i < args.length; i++) {
    let expected = args[i]
    let actual = event.args[i]

    if (typeof expected === 'number') {
      expected = new BN(expected)
    }

    if (expected instanceof BN) {
      expected = expected.toString()
      actual = actual.toString()
    }

    assert.deepEqual(actual, expected, `Event ${event.event} argument ${i} is wrong`)
  }
}

function assertEvent (transactionResult, eventName, ...args) {
  const event = transactionResult.logs.find(l => l.event === eventName)
  assert.isDefined(event, `Event ${eventName} not emitted`)
  assert.equal(event.args.__length__, args.length, `Wrong number of arguments for event ${eventName}`)

  assertEventArgs(event, ...args)
}

contract('Pool', ([deployer, summoner, firstPoolMember, depositor, firstMemberKeeper, depositorKeeper, ...otherAccounts]) => {
  let moloch
  let token
  let pool

  beforeEach('Deploy contracts', async () => {
    token = await Token.new(TOKEN_SUPPLY)
    moloch = await Moloch.new(
      summoner,
      token.address,
      PERIOD_DURATION_IN_SECONDS,
      VOTING_DURATON_IN_PERIODS,
      GRACE_DURATON_IN_PERIODS,
      ABORT_WINDOW_IN_PERIODS,
      PROPOSAL_DEPOSIT,
      DILUTION_BOUND,
      PROCESSING_REWARD
    )

    // We set the gas manually here because of
    // https://github.com/nomiclabs/buidler/issues/272
    // TODO(@alcuadrado): Remove this when the issue gets fixed
    pool = await MolochPool.new(moloch.address, { gas: 8000000 })
  })

  async function sendTokensTo (receiver, amount) {
    return token.transfer(receiver, amount, { from: deployer })
  }

  async function giveAllowanceToMoloch (approver) {
    return token.approve(moloch.address, MAX_UINT256, { from: approver })
  }

  async function giveAllowanceToMolochPool (approver) {
    return token.approve(pool.address, MAX_UINT256, { from: approver })
  }

  async function submitProposal (applicant, proposer, tribute, shares, description) {
    await sendTokensTo(proposer, PROPOSAL_DEPOSIT)
    await giveAllowanceToMoloch(proposer)

    if (tribute) {
      await sendTokensTo(applicant, tribute)
      await giveAllowanceToMoloch(applicant)
    }

    return moloch.submitProposal(
      applicant,
      tribute,
      shares,
      description,
      { from: proposer }
    )
  }

  async function processProposal (proposal, processor = deployer) {
    return moloch.processProposal(proposal, { from: processor })
  }

  async function activatePool (activator, initialTokens, initialShares) {
    await sendTokensTo(activator, initialTokens)
    await giveAllowanceToMolochPool(activator)

    // We set the gas manually here because of
    // https://github.com/nomiclabs/buidler/issues/272
    // TODO(@alcuadrado): Remove this when the issue gets fixed
    return pool.activate(initialTokens, initialShares, { from: activator, gas: 2000000 })
  }

  async function assertBNEquals (bnOrPromiseToBn, expectedBnNumberOrString) {
    const bn = await bnOrPromiseToBn
    const expected = new BN(expectedBnNumberOrString)

    assert.equal(bn.toString(), expected.toString())
  }

  async function assertBalance (who, tokens) {
    await assertBNEquals(token.balanceOf(who), tokens)
  }

  async function assertShares (donor, numberOfShares) {
    await assertBNEquals(pool.donors(donor), numberOfShares)
  }

  async function assertTotalShares (numberOfShares) {
    await assertBNEquals(pool.totalPoolShares(), numberOfShares)
  }

  async function assertCurrentProposalIndex (index) {
    await assertBNEquals(pool.currentProposalIndex(), index)
  }

  describe('constructor', () => {
    it('should be initialized with the right values', async () => {
      await assertTotalShares(0)
      await assertBNEquals(pool.currentProposalIndex(), 0)
      assert.equal(await pool.moloch(), moloch.address)
      assert.equal(await pool.approvedToken(), token.address)
    })
  })

  describe('When not active', () => {
    describe('activate', () => {
      it('should be initialized with the right values', async () => {
        const shares = 123
        const tokens = 12

        await sendTokensTo(firstPoolMember, 1)
        await assertBalance(firstPoolMember, 1)

        await activatePool(firstPoolMember, tokens, shares)

        await assertBalance(firstPoolMember, 1)
        await assertBalance(pool.address, tokens)
        await assertTotalShares(shares)
        await assertShares(firstPoolMember, shares)
      })

      it("Shouldn't work when already activated", async () => {
        await activatePool(firstPoolMember, 1, 2)
        await activatePool(firstPoolMember, 1, 2).should.be.rejectedWith('MolochPool: Already active')
      })

      it("Shouldn't accept more than MAX_NUMBER_OF_SHARES initial shares", async () => {
        await activatePool(firstPoolMember, 1, MAX_NUMBER_OF_SHARES.add(new BN(1)))
          .should.be.rejectedWith('MolochPool: Max number of shares exceeded')
      })

      it('Should fail if no allowance is given', async () => {
        await sendTokensTo(firstPoolMember, 1)
        // This should be rejected rejectedWith("MolochPool: Initial tokens transfer failed")
        // But the token used for testing doesn't return a boolean, but reverts on errors,
        // so the MolochPool contract never gets to return a revert reason.
        await pool.activate(1, 1, { from: firstPoolMember }).should.be.rejected
      })

      it('Should emit the SharesMinted event', async () => {
        await sendTokensTo(firstPoolMember, 1)
        await giveAllowanceToMolochPool(firstPoolMember)

        const tx = await pool.activate(1, 2, { from: firstPoolMember })

        assertEvent(tx, 'SharesMinted', 2, firstPoolMember, 2)
      })
    })

    describe('deposit', () => {
      it("Shouldn't be callable", async () => {
        await sendTokensTo(deployer, 123)
        await giveAllowanceToMolochPool(deployer)
        await pool.deposit(123, { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })

    describe('withdraw', () => {
      it("Shouldn't be callable", async () => {
        await pool.withdraw(0, { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })

    describe('keeperWithdraw', () => {
      it("Shouldn't be callable", async () => {
        await pool.keeperWithdraw(0, deployer, { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })

    describe('addKeepers', () => {
      it("Shouldn't be callable", async () => {
        await pool.addKeepers([], { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })

    describe('removeKeepers', () => {
      it("Shouldn't be callable", async () => {
        await pool.removeKeepers([], { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })

    describe('sync', () => {
      it("Shouldn't be callable", async () => {
        await pool.sync(0, { from: deployer })
          .should.be.rejectedWith('MolochPool: Not active')
      })
    })
  })

  describe('When active', () => {
    const initialShares = 1000000
    const initialTokens = 1

    beforeEach('Activate pool', async () => {
      await activatePool(firstPoolMember, initialTokens, initialShares)
    })

    describe('deposit', () => {
      it('Should transfer the deposited tokens into the pool and mint the right shares', async () => {
        await sendTokensTo(depositor, 125)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(120, { from: depositor })

        await assertBalance(pool.address, initialTokens + 120)
        await assertBalance(depositor, 5)
        await assertShares(depositor, 120 * initialShares)

        await assertTotalShares(121 * initialShares)
      })

      it('Should emit the Deposit event', async () => {
        await sendTokensTo(depositor, 125)
        await giveAllowanceToMolochPool(depositor)
        const tx = await pool.deposit(120, { from: depositor })
        assertEvent(tx, 'Deposit', 120, depositor)
      })

      it('Should emit the SharesMinted event', async () => {
        await sendTokensTo(depositor, 125)
        await giveAllowanceToMolochPool(depositor)
        const tx = await pool.deposit(120, { from: depositor })
        assertEvent(tx, 'SharesMinted', 120 * initialShares, depositor, 121 * initialShares)
      })

      it('Should fail if the amounts of shares minted makes the total exceed the MAX_NUMBER_OF_SHARES', async () => {
        const missingShares = MAX_NUMBER_OF_SHARES.sub(new BN(initialShares))
        const tokensNeeded = missingShares.div(new BN(initialShares)).add(new BN(1))

        await sendTokensTo(depositor, tokensNeeded)
        await giveAllowanceToMolochPool(depositor)

        // We set the gas manually here because of
        // https://github.com/nomiclabs/buidler/issues/272
        // TODO(@alcuadrado): Remove this when the issue gets fixed
        await pool.deposit(tokensNeeded, { from: depositor, gas: 2000000 })
          .should.be.rejectedWith('MolochPool: Max number of shares exceeded')
      })

      it('Should be callable by anyone', async () => {
        for (const acc of otherAccounts) {
          await sendTokensTo(acc, 1)
          await giveAllowanceToMolochPool(acc)

          await pool.deposit(1, { from: acc }).should.be.fulfilled
        }
      })

      it('Should fail if no allowance is given', async () => {
        await sendTokensTo(depositor, 1)
        // This should be rejected rejectedWith("MolochPool: Deposit transfer failed")
        // But the token used for testing doesn't return a boolean, but reverts on errors,
        // so the MolochPool contract never gets to return a revert reason.
        await pool.deposit(1, { from: depositor }).should.be.rejected
      })
    })

    describe('Withdraw', () => {
      it('should be callable with 0 shares', async () => {
        await assertShares(firstPoolMember, initialShares)
        await pool.withdraw(0, { from: firstPoolMember }).should.be.fulfilled
        await assertShares(firstPoolMember, initialShares)
        await assertTotalShares(initialShares)
      })

      it('should fail if trying to withdraw more shares than the ones you own', async () => {
        await pool.withdraw(initialShares + 1, { from: firstPoolMember })
          .should.be.rejectedWith('MolochPool: Not enough shares to burn')
      })

      it("should fail if trying with any share if you aren't a donor", async () => {
        await pool.withdraw(1, { from: depositor })
          .should.be.rejectedWith('MolochPool: Not enough shares to burn')
      })

      it('Should transfer a proportional amount of tokens according to the shares burnt, and burn the shares', async () => {
        // We deposit twice the initial tokens, so we get twice the shares.
        // Then we burnt half of it
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(initialTokens * 2, { from: depositor })

        await assertShares(depositor, initialShares * 2)
        await assertBalance(depositor, 0)
        await assertBalance(pool.address, initialTokens * 3)

        await pool.withdraw(initialShares, { from: depositor })

        await assertShares(depositor, initialShares)
        await assertBalance(depositor, initialTokens)
        await assertBalance(pool.address, initialTokens * 2)
        await assertTotalShares(initialShares * 2)
      })

      it('Should emit the Withdraw event', async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)
        await pool.deposit(initialTokens * 2, { from: depositor })

        const tx = await pool.withdraw(2, { from: depositor })
        assertEvent(tx, 'Withdraw', 2, depositor)
      })

      it('Should emit the SharesBurned event', async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)
        await pool.deposit(initialTokens * 2, { from: depositor })

        const tx = await pool.withdraw(initialShares, { from: depositor })
        assertEvent(tx, 'SharesBurned', initialShares, depositor, initialShares * 2)
      })
    })

    describe('keeperWithdraw', () => {
      beforeEach('Add a keeper to depositor', async () => {
        await pool.addKeepers([depositorKeeper], { from: depositor })
        await pool.addKeepers([firstMemberKeeper], { from: firstPoolMember })
      })

      it("should fail if you aren't a keeper", async () => {
        await pool.keeperWithdraw(0, firstPoolMember, { from: otherAccounts[0] })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')
      })

      it('should be callable with 0 shares', async () => {
        await assertShares(depositor, 0)
        await pool.keeperWithdraw(0, depositor, { from: depositorKeeper })
        await assertShares(depositor, 0)
        await assertTotalShares(initialShares)
      })

      it('should fail if trying to withdraw more shares than the ones you own', async () => {
        await pool.keeperWithdraw(initialShares + 1, firstPoolMember, { from: firstMemberKeeper })
          .should.be.rejectedWith('MolochPool: Not enough shares to burn')
      })

      it("should fail if trying to any share if you aren't a donor", async () => {
        await pool.keeperWithdraw(1, depositor, { from: depositorKeeper })
          .should.be.rejectedWith('MolochPool: Not enough shares to burn')
      })

      it('Should transfer a proportional amount of tokens according to the shares burnt, and burn the shares, whithout affecting the keeper', async () => {
        // We deposit twice the initial tokens, so we get twice the shares.
        // Then we burnt half of it.
        // We also deposit initial-tokens from the depositor's keepr, to check
        // that their numbers aren't affected
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)

        await sendTokensTo(depositorKeeper, initialTokens)
        await giveAllowanceToMolochPool(depositorKeeper)

        await pool.deposit(initialTokens * 2, { from: depositor })
        await pool.deposit(initialTokens, { from: depositorKeeper })

        await assertShares(depositor, initialShares * 2)
        await assertBalance(depositor, 0)

        await assertShares(depositorKeeper, initialShares)
        await assertBalance(depositorKeeper, 0)

        await assertBalance(pool.address, initialTokens * 4)

        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper })

        await assertShares(depositor, initialShares)
        await assertBalance(depositor, initialTokens)

        await assertShares(depositorKeeper, initialShares)
        await assertBalance(depositorKeeper, 0)

        await assertBalance(pool.address, initialTokens * 3)
        await assertTotalShares(initialShares * 3)
      })

      it('Should emit the KeeperWithdraw event', async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)
        await pool.deposit(initialTokens * 2, { from: depositor })
        const tx = await pool.keeperWithdraw(15, depositor, { from: depositorKeeper })
        assertEvent(tx, 'KeeperWithdraw', 15, depositor, depositorKeeper)
      })

      it('Should emit the SharesBurned event', async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)
        await pool.deposit(initialTokens * 2, { from: depositor })
        const tx = await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper })
        assertEvent(tx, 'SharesBurned', initialShares, depositor, initialShares * 2)
      })
    })

    describe('addKeepers', () => {
      it('should add keepers', async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(initialTokens * 2, { from: depositor })

        // try to call it with keepers before adding it
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')

        // Add them as keepers
        await pool.addKeepers([depositorKeeper, otherAccounts[0]], { from: depositor })

        // Now these should work
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.fulfilled

        // This one shouldn't, it wasn't added
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')
      })

      it('should be callable with addresses that are already keepers', async () => {
        await pool.addKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
        await pool.addKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
      })

      it('Should emit the AddKeepers event', async () => {
        const keepers = [depositorKeeper, otherAccounts[0]]
        const tx = await pool.addKeepers(keepers, { from: depositor })
        assertEvent(tx, 'AddKeepers', keepers)
      })
    })

    describe('removeKeepers', () => {
      it("should be callable with addresses that aren't already keepers", async () => {
        await pool.removeKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
      })

      it('should remove keeprs', async () => {
        await sendTokensTo(depositor, initialTokens * 6)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(initialTokens * 6, { from: depositor })

        // Add them as keepers
        await pool.addKeepers([depositorKeeper, otherAccounts[0], otherAccounts[1]], { from: depositor })

        // They should be able to withdraw
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.fulfilled

        // Remove them
        await pool.removeKeepers([depositorKeeper, otherAccounts[0]], { from: depositor })

        // They shouldn't now
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] })
          .should.be.rejectedWith('MolochPool: Sender is not a keeper')

        // Except this one, that wasn't removed
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.fulfilled
      })

      it('Should emit the RemoveKeepers event', async () => {
        const keepers = [depositorKeeper, otherAccounts[0]]
        const tx = await pool.removeKeepers(keepers, { from: depositor })
        assertEvent(tx, 'RemoveKeepers', keepers)
      })
    })

    describe('Moloch syncing', function () {
      this.timeout(10000)
      const proposed = otherAccounts[3]

      it('Should fail if called with a toIndex larger than the number of proposals', async () => {
        // We set the gas manually here because of
        // https://github.com/nomiclabs/buidler/issues/272
        // TODO(@alcuadrado): Remove this when the issue gets fixed
        await pool.sync(1, { gas: 2000000 }).should.be.rejectedWith('MolochPool: Proposal index too high')

        await submitProposal(proposed, summoner, 0, 1, '')

        await pool.sync(1).should.be.fulfilled

        await pool.sync(2, { gas: 2000000 }).should.be.rejectedWith('MolochPool: Proposal index too high')

        await submitProposal(otherAccounts[0], summoner, 0, 1, '')

        await pool.sync(2).should.be.fulfilled

        await pool.sync(3, { gas: 2000000 }).should.be.rejectedWith('MolochPool: Proposal index too high')
      })

      it('Should be callable by anyone', async () => {
        await submitProposal(proposed, summoner, 0, 1, '')

        for (const acc of otherAccounts) {
          await pool.sync(1, { from: acc }).should.be.fulfilled
        }
      })

      it('Should emit the Sync event', async () => {
        await submitProposal(proposed, summoner, 0, 1, '')

        let tx = await pool.sync(1)
        assertEvent(tx, 'Sync', 0)

        await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
        await moloch.submitVote(0, VOTE_NO, { from: summoner })
        await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
        await processProposal(0)

        tx = await pool.sync(1, { gas: 2000000 })
        assertEvent(tx, 'Sync', 1)
      })

      describe('When syncing a single proposal', () => {

        describe("When the proposal hasn't pass or hasn't been processed", () => {
          it("Shouldn't modify anything if the proposal hasn't been processed", async () => {
            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(0)

            await submitProposal(proposed, summoner, 0, 1, '')
            await pool.sync(1)

            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(0)
          })

          it("Shouldn't mint shares if the proposal has been aborted, but it should increase the index", async () => {
            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(0)

            await submitProposal(proposed, summoner, 0, 1, '')

            await moloch.abort(0, { from: proposed })
            await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS + VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
            await processProposal(0)

            await pool.sync(1)

            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(1)
          })

          it("Shouldn't mint shares if the proposal didn't pass, but it should increase the index", async () => {
            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(0)

            await submitProposal(proposed, summoner, 0, 1, '')

            await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
            await moloch.submitVote(0, VOTE_NO, { from: summoner })
            await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
            await processProposal(0)

            await pool.sync(1)

            await assertTotalShares(initialShares)
            await assertCurrentProposalIndex(1)
          })
        })

        describe('When the proposal is approved and processed', () => {
          describe("When the proposal isn't a grant", () => {
            it("Shouldn't mint shares if the proposal isn't a grant (tokenTribute > 0), but it should increase the index", async () => {
              await assertTotalShares(initialShares)
              await assertCurrentProposalIndex(0)

              await submitProposal(proposed, summoner, 1, 1, '')

              await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
              await moloch.submitVote(0, VOTE_YES, { from: summoner })
              await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
              await processProposal(0)

              await pool.sync(1)

              await assertTotalShares(initialShares)
              await assertCurrentProposalIndex(1)
            })

            it("Shouldn't mint shares if the proposal asked didn't ask for shares, but it should increase the index", async () => {
              // We should use tokenTribute = 0 here to separate it from the previous case
              await assertTotalShares(initialShares)
              await assertCurrentProposalIndex(0)

              await submitProposal(proposed, summoner, 0, 0, '')

              await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
              await moloch.submitVote(0, VOTE_YES, { from: summoner })
              await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
              await processProposal(0)

              await pool.sync(1)

              await assertTotalShares(initialShares)
              await assertCurrentProposalIndex(1)
            })
          })

          describe('When the proposal is a grant', () => {
            const ignoredMember = depositor

            describe("When nobody ragequits nor joins before it's processed", () => {
              it('Should mint shares proportional to the current amount of the Moloch shares', async () => {
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(0)

                // We ask for twice the amount of Moloch's shares, so we
                // should receive twice the amount of the pool's shares too.
                await submitProposal(proposed, summoner, 0, 2, '')

                await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
                await moloch.submitVote(0, VOTE_YES, { from: summoner })
                await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
                await processProposal(0)

                await pool.sync(1)

                await assertTotalShares(initialShares * 3)
                await assertShares(proposed, initialShares * 2)
                await assertCurrentProposalIndex(1)
              })

              it('Should emit the SharesMinted event', async () => {
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(0)

                // We ask for twice the amount of Moloch's shares, so we
                // should receive twice the amount of the pool's shares too.
                await submitProposal(proposed, summoner, 0, 2, '')

                await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
                await moloch.submitVote(0, VOTE_YES, { from: summoner })
                await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
                await processProposal(0)

                const tx = await pool.sync(1)
                assertEvent(tx, 'SharesMinted', initialShares * 2, proposed, initialShares * 3)
              })
            })

            describe("When somebody ragequits and nobody joins before it's processed", () => {
              it('Should mint shares proportional to the max amount of the Moloch on yest votes', async () => {
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(0)

                // We first add a member that is going to ragequit
                await submitProposal(ignoredMember, summoner, 1, 1, '')
                await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
                await moloch.submitVote(0, VOTE_YES, { from: summoner })
                await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
                await processProposal(0)

                // We need to sync here, but this is not what we are testing
                await pool.sync(1)

                // Just to make sure everything is fine, that wasn't a grant,
                // so no pool shares were minted
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(1)

                // Now we propose the member we want to test
                await submitProposal(proposed, summoner, 0, 1, '')

                await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
                await moloch.submitVote(1, VOTE_YES, { from: summoner })
                await moloch.ragequit(1, { from: ignoredMember })
                await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
                await processProposal(1)

                await pool.sync(2)

                // The max numbers of Moloch shares when voting yes was 2, and
                // this member asked for 1, so 0.5 initial shares should have
                // been minted

                await assertTotalShares(Math.floor(initialShares * 1.5))
                await assertShares(proposed, Math.floor(initialShares * 0.5))
                await assertCurrentProposalIndex(2)
              })
            })

            describe("When nobody ragequits and someone joins before it's processed", () => {
              it('Should mint shares proportional to the max amount of the Moloch on yest votes', async () => {
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(0)

                // We first propose this member that doesn't get processed
                // until the tested one is proposed and voted
                await submitProposal(ignoredMember, summoner, 1, 1, '')

                // Now we propose the member we want to test
                await submitProposal(proposed, summoner, 0, 1, '')

                await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)

                // Vote YES to both proposals
                await moloch.submitVote(0, VOTE_YES, { from: summoner })
                await moloch.submitVote(1, VOTE_YES, { from: summoner })

                await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)

                await processProposal(0)

                // Moloch now has two shares
                await assertBNEquals(moloch.totalShares(), 2)

                await processProposal(1)

                // Moloch now has three shares
                await assertBNEquals(moloch.totalShares(), 3)

                // We need to sync here, but this is not what we are testing
                await pool.sync(1)

                // Just to make sure everything is fine, that wasn't a grant,
                // so no pool shares were minted
                await assertTotalShares(initialShares)
                await assertCurrentProposalIndex(1)

                // Now sync the other, the one we want to test
                await pool.sync(2)

                // The max numbers of Moloch shares when voting yes was 1, and
                // this member asked for 1, so initialShares should have
                // been minted

                await assertTotalShares(initialShares * 2)
                await assertShares(proposed, initialShares)
                await assertCurrentProposalIndex(2)
              })
            })
          })
        })
      })

      describe('When syncing multiple proposals', () => {
        it('Should sync up to the first non-processed proposal', async function () {
          // There's a weird bug here with solidity-coverage, that emits the 
          // events twice
          if (process.env.RUNNING_COVERAGE) {
            return
          }

          // This test sets up the followint scenario to then validate the
          // syncing results.

          //  Depositor deposits intialToken tokens (pool shares: initialShares * 2)
          //  Proposal 0: Approved non-grant (shares requested: 2)
          //  Process proposal 0
          //  Proposal 1: Approved approved grant (shares requested: 2 - max shares: 3)
          //  Proposal 2: Rejected proposal
          //  Process proposals 1 and 2
          //  Proposal 3: Approved grant (shares requested: 1 - max shares: 5)
          //  Process proposal 3
          //  Proposal 4: Aborted proposal
          //  Proposal 5: Approved grant (shares requested: 2 - max shares: 6)
          //  Process proposals 4 and 5
          //  Proposal 6: Approved grant without processing (shares requested: 5 - max shares: 8)
          //  Proposal 7: Proposed non-grant (shares requested: 8)
          //  sync(8)

          await sendTokensTo(depositor, initialTokens)
          await giveAllowanceToMolochPool(depositor)
          await pool.deposit(initialTokens, { from: depositor })

          const proposed0 = deployer // We need to give allowance with this account
          const proposed1 = '0x0000000000000000000000000000000000000002'
          const proposed2 = '0x0000000000000000000000000000000000000003'
          const proposed3 = '0x0000000000000000000000000000000000000004'
          const proposed4 = otherAccounts[0] // We need to abort with this account
          const proposed5 = '0x0000000000000000000000000000000000000005'
          const proposed6 = '0x0000000000000000000000000000000000000006'
          const proposed7 = depositorKeeper // We need to give allowance with this account

          // Proposal 0
          await submitProposal(proposed0, summoner, 1, 2, '')
          await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
          await moloch.submitVote(0, VOTE_YES, { from: summoner })
          await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
          await processProposal(0)

          // Proposal 1
          await submitProposal(proposed1, summoner, 0, 2, '')

          // Proposal 2
          await submitProposal(proposed2, summoner, 0, 2, '')

          // Vote and process proposals 1 and 2
          await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
          await moloch.submitVote(1, VOTE_YES, { from: summoner })
          await moloch.submitVote(2, VOTE_NO, { from: summoner })
          await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
          await processProposal(1)
          await processProposal(2)

          // Proposal 3
          await submitProposal(proposed3, summoner, 0, 1, '')
          await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
          await moloch.submitVote(3, VOTE_YES, { from: summoner })
          await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
          await processProposal(3)

          // Proposal 4
          await submitProposal(proposed4, summoner, 0, 2, '')
          await moloch.abort(4, { from: proposed4 })

          // Proposal 5
          await submitProposal(proposed5, summoner, 0, 2, '')
          await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
          await moloch.submitVote(5, VOTE_YES, { from: summoner })

          // Process proposals 4 and 5
          await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
          await processProposal(4)
          await processProposal(5)

          // Proposal 6
          await submitProposal(proposed6, summoner, 0, 5, '')
          await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
          await moloch.submitVote(6, VOTE_YES, { from: summoner })
          await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)

          // Proposal 7
          await submitProposal(proposed7, summoner, 1, 8, '')

          // We check the shares before syncing
          assertTotalShares(initialShares * 2)
          assertShares(firstPoolMember, initialShares)
          assertShares(depositor, initialShares)
          await assertBNEquals(moloch.totalShares(), 8)

          const tx = await pool.sync(8)
          assertEvent(tx, 'Sync', 6)

          // We need to be sure that SharesMinted has been emitted multiple
          // times. They are emitted in order, so their totalPoolShares arg
          // increases with each event.
          const events = tx.logs.filter(l => l.event === 'SharesMinted')
          assert.lengthOf(events, 3)
          const [proposed1Event, proposed3Event, proposed5Event] = events

          await assertCurrentProposalIndex(6)

          await assertShares(firstPoolMember, initialShares)
          await assertShares(depositor, initialShares)

          // Proposal 0
          await assertShares(proposed0, 0)

          // Proposal 1
          let totalSharesBeforeProsalBeingTested = initialShares * 2
          let expectedGranteeShares = Math.floor(totalSharesBeforeProsalBeingTested * 2 / 3)

          await assertShares(proposed1, expectedGranteeShares)

          assertEventArgs(
            proposed1Event,
            expectedGranteeShares,
            proposed1,
            totalSharesBeforeProsalBeingTested + expectedGranteeShares
          )

          // Proposal 2
          await assertShares(proposed2, 0)

          // Proposal 3
          totalSharesBeforeProsalBeingTested += expectedGranteeShares
          expectedGranteeShares = Math.floor(totalSharesBeforeProsalBeingTested * 1 / 5)

          await assertShares(proposed3, expectedGranteeShares)

          assertEventArgs(
            proposed3Event,
            expectedGranteeShares,
            proposed3,
            totalSharesBeforeProsalBeingTested + expectedGranteeShares
          )

          // Proposal 4
          await assertShares(proposed4, 0)

          // Proposal 5
          totalSharesBeforeProsalBeingTested += expectedGranteeShares
          expectedGranteeShares = Math.floor(totalSharesBeforeProsalBeingTested * 2 / 6)

          const totalShares = totalSharesBeforeProsalBeingTested + expectedGranteeShares

          await assertShares(proposed5, expectedGranteeShares)

          assertEventArgs(
            proposed5Event,
            expectedGranteeShares,
            proposed5,
            totalShares
          )

          // Proposal 6
          await assertShares(proposed7, 0)

          // Proposal 7
          await assertShares(proposed7, 0)

          await assertTotalShares(totalShares)
        })
      })
    })
  })

  describe('Internal functions', () => {
    describe('_mintSharesForAddress', () => {
      it("Shouldn't be callable", async () => {
        const encodedCall = web3.eth.abi.encodeFunctionCall({
          name: '_mintSharesForAddress',
          type: 'function',
          inputs: [
            {
              type: 'uint256',
              name: 'sharesToMint'
            },
            {
              type: 'address',
              name: 'recipient'
            }
          ]
        }, ['1', depositor])

        await web3.eth.sendTransaction({
          to: pool.address,
          from: deployer,
          data: encodedCall
        }).should.be.rejected
      })
    })

    describe('_withdraw', () => {
      it("Shouldn't be callable", async () => {
        // We activate the pool here, as we want to be sure that the tx is
        // reverted because the function is internal, and not because of a
        // failed require.
        await activatePool(firstPoolMember, 123, 123)

        const encodedCall = web3.eth.abi.encodeFunctionCall({
          name: '_withdraw',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'recipient'
            },
            {
              type: 'uint256',
              name: 'sharesToBurn'
            }
          ]
        }, [firstMemberKeeper, '1'])

        await web3.eth.sendTransaction({
          to: pool.address,
          from: deployer,
          data: encodedCall
        }).should.be.rejected
      })
    })
  })

  describe('Syncing proposals with huge descriptions', () => {
    it('should not OOG if the proposal being synced has a huge description', async function () {
      // We don't run this test when computing code coverage, as that requires
      // a different block gas limit.
      if (process.env.RUNNING_COVERAGE) {
        return
      }

      // This test is quite long, read the comments to understand why
      this.timeout(10000)

      // Activate the pool
      await activatePool(firstPoolMember, 1, 1)

      const block = await web3.eth.getBlock('latest')

      // This test is here to ensure that the MolochPool can't be locked by
      // submitting a proposal with a description so large that it would cause
      // an OOG when syncing it.

      // This test is quiet complex, as it has been developed as part of the
      // auditing process, with a lot of trial and error.

      // We want to set a proposal with the longest possible description. We
      // figured out that we can submit slightly longer descriptions if it
      // isn't the first one.

      // We submit a proposal that will be ignored.

      await submitProposal(deployer, summoner, 0, 1, '')
      await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
      await moloch.submitVote(0, VOTE_YES, { from: summoner })
      await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
      await processProposal(0)

      // With the current block gas limit (i.e. 8M), the max proposal
      // description length is 11136. This number will increase in the future,
      // when the block gas limit also increases.

      // We submit a proposal with a description of that length.
      const MAX_DESCRIPTION_LENGTH = 11136

      let description = ''
      for (let i = 0; i < MAX_DESCRIPTION_LENGTH; i++) {
        description += 'A'
      }

      const applicant = '0x0000000000000000000000000000000000000021'
      const proposalResult = await submitProposal(applicant, summoner, 0, 1, description)

      // We assert here that the tx consumed almost the entire gas of the block
      assert.isAbove(proposalResult.receipt.gasUsed, Math.ceil(block.gasLimit * 0.95))

      await advanceTimeInPeriods(ABORT_WINDOW_IN_PERIODS)
      await moloch.submitVote(1, VOTE_YES, { from: summoner })
      await advanceTimeInPeriods(VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS)
      await processProposal(1)

      // Sync the first proposal, we don't care about it.
      await pool.sync(1)

      // We sync the second proposal, the one with the huge description.
      // It doesn't have to OOG

      const syncResult = await pool.sync(2)

      // We assert here that the gas used is much lower than the block gas limit
      // as both numbers will increase in the future.
      assert.isBelow(syncResult.receipt.gasUsed, Math.floor(block.gasLimit / 4))
    })
  })
})
