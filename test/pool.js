const { artifacts, web3 } = require('@nomiclabs/buidler')
const { assert } = require("chai")

const BN = web3.utils.BN

const Moloch = artifacts.require("Moloch")
const GuildBank = artifacts.require("GuildBank")
const MolochPool = artifacts.require("MolochPool")
const Token = artifacts.require("Token")

const MAX_NUMBER_OF_SHARES = new BN(10).pow(new BN(30));
const MAX_UINT256 = new BN(2).pow(new BN(256)).sub(new BN(1))

const PERIOD_DURATION_IN_SECONDS = 17280
const VOTING_DURATON_IN_PERIODS = 35
const GRACE_DURATON_IN_PERIODS = 35
const ABORT_WINDOW_IN_PERIODS = 5
const PROPOSAL_DEPOSIT = 10
const DILUTION_BOUND = 3
const PROCESSING_REWARD = 1
const TOKEN_SUPPLY = new BN(10).pow(new BN(18)).mul(new BN(1000000000))


async function advanceTime(seconds) {
  await ethereum.send('evm_increaseTime', [seconds])
  await ethereum.send('evm_mine', [])
}

contract("Pool", ([deployer, summoner, firstPoolMember, depositor, firstMemeberKeeper, depositorKeeper, ...otherAccounts]) => {

  let moloch
  let token
  let guildBank
  let pool

  beforeEach("Deploy contracts", async () => {
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

    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)

    pool = await MolochPool.new(moloch.address, {gas: 8000000})
  })


  async function sendTokensTo(receiver, amount) {
    return token.transfer(receiver, amount, { from: deployer })
  }

  async function giveAllowanceToMoloch(approver) {
    return token.approve(moloch.address, MAX_UINT256, {from: approver})
  }

  async function giveAllowanceToMolochPool(approver) {
    return token.approve(pool.address, MAX_UINT256, {from: approver})
  }

  async function submitProposal(applicant, proposer, tribute, shares, description) {
    await sendTokensTo(proposer, PROPOSAL_DEPOSIT)
    await giveAllowanceToMoloch(proposer);

    if (tribute) {
      await sendTokensTo(applicant, tribute)
      await giveAllowanceToMoloch(applicant);
    }

    return moloch.submitProposal(
      applicant,
      tribute,
      shares,
      description,
      { from: proposer }
    );
  }

  async function processProposal(proposal, processor = deployer) {
    return moloch.processProposal(proposal, {from: processor})
  }

  async function activatePool(activator, initialTokens, initialShares) {
    await sendTokensTo(activator, initialTokens)
    await giveAllowanceToMolochPool(activator);
    await pool.activate(initialTokens, initialShares, {from: activator})
  }

  async function assertBNEquals(bnOrPromiseToBn, expectedBnNumberOrString) {
    const bn = await bnOrPromiseToBn;
    const expected = new BN(expectedBnNumberOrString)

    assert.equal(bn.toString(), expected.toString());
  }

  async function assertBalance(who, tokens) {
    await assertBNEquals(token.balanceOf(who), tokens)
  }

  async function assertShares(donor, numberOfShares) {
    await assertBNEquals(pool.donors(donor), numberOfShares)
  }

  async function assertTotalShares(numberOfShares) {
    await assertBNEquals(pool.totalPoolShares(), numberOfShares)
  }
  
  describe("constructor", () => {
    it("should be initialized with the right values", async () => {
      await assertTotalShares(0)
      await assertBNEquals(pool.currentProposalIndex(), 0)
      assert.equal(await pool.moloch(), moloch.address);
      assert.equal(await pool.approvedToken(), token.address);
    })
  })

  describe("When not active", () => {

    describe("activate", () => {
      it("should be initialized with the right values", async () => {
        const shares = 123;
        const tokens = 12;
  
        await sendTokensTo(firstPoolMember, 1)
        await assertBalance(firstPoolMember, 1)
        
        await activatePool(firstPoolMember, tokens, shares);
  
        await assertBalance(firstPoolMember, 1)
        await assertBalance(pool.address, tokens)
        await assertTotalShares(shares)
        await assertShares(firstPoolMember, shares)
      })
  
      it("Shouldn't work when already activated", async () => {
        await activatePool(firstPoolMember, 1, 2);
        await activatePool(firstPoolMember, 1, 2).should.be.rejected
      })
  
      it("Shouldn't accept more than MAX_NUMBER_OF_SHARES initial shares", async () => {
        await activatePool(firstPoolMember, 1, MAX_NUMBER_OF_SHARES.add(new BN(1))).should.be.rejected
      })
    })

    describe("deposit", () => {
      it("Shouldn't be callable", async () => {
        await sendTokensTo(deployer, 123)
        await giveAllowanceToMolochPool(deployer);
        await pool.deposit(123, { from: deployer }).should.be.rejected
      })
    })

    describe("withdraw", () => {
      it("Shouldn't be callable", async () => {
        await pool.withdraw(0, { from: deployer }).should.be.rejected
      })
    })

    describe("keeperWithdraw", () => {
      it("Shouldn't be callable", async () => {
        await pool.keeperWithdraw(0, deployer, { from: deployer }).should.be.rejected
      })
    })

    describe("addKeepers", () => {
      it("Shouldn't be callable", async () => {
        await pool.addKeepers([], { from: deployer }).should.be.rejected
      })
    })

    describe("removeKeepers", () => {
      it("Shouldn't be callable", async () => {
        await pool.removeKeepers([], { from: deployer }).should.be.rejected
      })
    })

    describe("sync", () => {
      it("Shouldn't be callable", async () => {
        await pool.sync(0, { from: deployer }).should.be.rejected
      })
    })

  })
  
  describe("When active", () => {
    const initialShares = 1000000;
    const initialTokens = 1;

    beforeEach("Activate pool", async () => {
      await activatePool(firstPoolMember, initialTokens, initialShares);
    })

    describe("deposit", () => {

      it("Should transfer the deposited tokens into the pool and mint the right shares", async () => {
        await sendTokensTo(depositor, 125)
        await giveAllowanceToMolochPool(depositor)
        
        await pool.deposit(120, { from: depositor })

        await assertBalance(pool.address, initialTokens + 120)
        await assertBalance(depositor, 5)
        await assertShares(depositor, 120 * initialShares)

        await assertTotalShares(121 * initialShares)
      })

      it("Should fail if the amounts of shares minted makes the total exceed the MAX_NUMBER_OF_SHARES", async () => {
        const missingShares = MAX_NUMBER_OF_SHARES.sub(new BN(initialShares))
        const tokensNeeded = missingShares.div(new BN(initialShares)).add(new BN(1))

        await sendTokensTo(depositor, tokensNeeded)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(tokensNeeded, { from: depositor }).should.be.rejected
      })

      it("Should be callable by anyone", async () => {
        for (const acc of otherAccounts) {
          await sendTokensTo(acc, 1)
          await giveAllowanceToMolochPool(acc)

          await pool.deposit(1, { from: acc }).should.be.fulfilled
        }
      })
    })

    describe("Withdraw", () => {
      it("should be callable with 0 shares", async () => {
        await assertShares(firstPoolMember, initialShares)
        await pool.withdraw(0, { from: firstPoolMember }).should.be.fulfilled
        await assertShares(firstPoolMember, initialShares)
        await assertTotalShares(initialShares)
      })

      it("should fail if trying to withdraw more shares than the ones you own", async () => {
        await pool.withdraw(initialShares + 1, { from: firstPoolMember }).should.be.rejected
      })

      it("should fail if trying to any share if you aren't a donor", async () => {
        await pool.withdraw(1, { from: depositor }).should.be.rejected
      })

      it("Should transfer a proportional amount of tokens according to the shares burnt, and burn the shares", async () => {
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
    })

    describe("keeperWithdraw", () => {

      beforeEach("Add a keeper to depositor", async () => {
        await pool.addKeepers([depositorKeeper], { from: depositor });
        await pool.addKeepers([firstMemeberKeeper], { from: firstPoolMember });
      })

      it("should fail if you aren't a keeper", async () => {
        await pool.keeperWithdraw(0, firstPoolMember, { from: otherAccounts[0] }).should.be.rejected
      })

      it("should be callable with 0 shares", async () => {                
        await assertShares(depositor, 0)
        await pool.keeperWithdraw(0, depositor, { from: depositorKeeper })
        await assertShares(depositor, 0)
        await assertTotalShares(initialShares)
      })

      it("should fail if trying to withdraw more shares than the ones you own", async () => {
        await pool.keeperWithdraw(initialShares + 1, firstPoolMember, { from: firstMemeberKeeper }).should.be.rejected
      })

      it("should fail if trying to any share if you aren't a donor", async () => {
        await pool.keeperWithdraw(1, depositor, { from: depositorKeeper }).should.be.rejected
      })

      it("Should transfer a proportional amount of tokens according to the shares burnt, and burn the shares, whithout affecting the keeper", async () => {
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

    })

    describe("addKeepers", () => {

      it("should add keepers", async () => {
        await sendTokensTo(depositor, initialTokens * 2)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(initialTokens * 2, {from: depositor})

        // try to call it with keepers before adding it
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.rejected
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.rejected
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.rejected

        // Add them as keepers
        await pool.addKeepers([depositorKeeper, otherAccounts[0]], { from: depositor })

        // Now these should work
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.fulfilled

        // This one shouldn't, it wasn't added
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.rejected

      })

      it("should be callable with addresses that are already keepers", async () => {
        await pool.addKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
        await pool.addKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
      })

    })

    describe("removeKeepers", () => {

      it("should be callable with addresses that aren't already keepers", async () => {
        await pool.removeKeepers([depositorKeeper], { from: depositor }).should.be.fulfilled
      })

      it("should remove keeprs", async () => {
        await sendTokensTo(depositor, initialTokens * 6)
        await giveAllowanceToMolochPool(depositor)

        await pool.deposit(initialTokens * 6, {from: depositor})

        // Add them as keepers
        await pool.addKeepers([depositorKeeper, otherAccounts[0], otherAccounts[1]], { from: depositor })

        // They should be able to withdraw
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.fulfilled
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.fulfilled

        // Remove them
        await pool.removeKeepers([depositorKeeper, otherAccounts[0]], { from: depositor })

        // They shouldn't now
        await pool.keeperWithdraw(initialShares, depositor, { from: depositorKeeper }).should.be.rejected
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[0] }).should.be.rejected

        // Except this one, that wasn't removed
        await pool.keeperWithdraw(initialShares, depositor, { from: otherAccounts[1] }).should.be.fulfilled
      })

    })

  })

  describe("Internal functions", () => {

    describe("_mintSharesForAddress", () => {
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
        }, ['1', depositor]);

        await web3.eth.sendTransaction({
          to: pool.address,
          from: deployer,
          data: encodedCall
        }).should.be.rejected
        
      })
    })

    describe("_withdraw", () => {
      it("Shouldn't be callable", async () => {
        // We activate the pool here, as we want to be sure that the tx is
        // reverted because the function is internal, and not  because of a
        // failed require.
        await activatePool(firstPoolMember, 123, 123);

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
        }, [firstMemeberKeeper, '1']);

        await web3.eth.sendTransaction({
          to: pool.address,
          from: deployer,
          data: encodedCall
        }).should.be.rejected
      })
    })

  })

  describe("Syncing proposals with huge descriptions", () => {
    
    it("should not OOG if the proposal being synced has a huge description", async function () {
      // This test is quite long, read the comments to understand why
      this.timeout(5000)

      // Activate the pool
      await activatePool(firstPoolMember, 1, 1);

      const block = await web3.eth.getBlock("latest")

      // This test is here to ensure that the MolochPool can't be locked by
      // submitting a proposal with a description so large that it would cause
      // an OOG when syncing it.

      // This test is quiet complex, as it has been developed as part of the
      // auditing process, with a lot of trial and error.

      // We want to set a proposal with the longest possible description. We
      // figured out that we can submit slightly longer descriptions if it
      // isn't the first one.
      
      // We submit a proposal that will be ignored.

      await submitProposal(deployer, summoner, 0, 1, "")
      await advanceTime(PERIOD_DURATION_IN_SECONDS * (ABORT_WINDOW_IN_PERIODS))
      await moloch.submitVote(0, 1, { from: summoner });
      await advanceTime(PERIOD_DURATION_IN_SECONDS * (VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS))
      await processProposal(0)

      // With the current block gas limit (i.e. 8M), the max proposal 
      // description length is 11136. This number will increase in the future,
      // when the block gas limit also increases.

      // We submit a proposal with a description of that length.
      const MAX_DESCRIPTION_LENGTH = 11136
      
      let description = "";
      for (let i = 0; i < MAX_DESCRIPTION_LENGTH; i++) {
        description += "A"
      }

      const applicant = "0x0000000000000000000000000000000000000021"
      const proposalResult = await submitProposal(applicant, summoner, 0, 1, description)
        
      // We assert here that the tx consumed almost the entire gas of the block
      assert.isAbove(proposalResult.receipt.gasUsed, Math.ceil(block.gasLimit * 0.95))
        
      await advanceTime(PERIOD_DURATION_IN_SECONDS * (ABORT_WINDOW_IN_PERIODS))
      await moloch.submitVote(1, 1, { from: summoner });
      await advanceTime(PERIOD_DURATION_IN_SECONDS * (VOTING_DURATON_IN_PERIODS + GRACE_DURATON_IN_PERIODS))
      await processProposal(1)

      // Sync the first proposal, we don't care about it.
      await pool.sync(1);

      // We sync the second proposal, the one with the huge description.
      // It doesn't have to OOG

      const syncResult = await pool.sync(2);
      
      // We assert here that the gas used is much lower than the block gas limit
      // as both numbers will increase in the future.
      assert.isBelow(syncResult.receipt.gasUsed, Math.floor(block.gasLimit / 4))
    })

  })
});
