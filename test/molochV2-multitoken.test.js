const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

const {
  verifyProposal,
  verifyFlags,
  verifyBalances,
  verifySubmitVote,
  verifyProcessProposal,
  verifyMember
} = require('./test-utils')

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18

const _10e18 = new BN('10000000000000000000') // 10e18
const _100e18 = new BN('100000000000000000000') // 10e18

async function blockTime () {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
}

async function snapshot () {
  return ethereum.send('evm_snapshot', [])
}

async function restore (snapshotId) {
  return ethereum.send('evm_revert', [snapshotId])
}

async function forceMine () {
  return ethereum.send('evm_mine', [])
}

const deploymentConfig = {
  'PERIOD_DURATION_IN_SECONDS': 17280,
  'VOTING_DURATON_IN_PERIODS': 35,
  'GRACE_DURATON_IN_PERIODS': 35,
  'EMERGENCY_EXIT_WAIT_IN_PERIODS': 35,
  'BAILOUT_WAIT_IN_PERIODS': 70,
  'PROPOSAL_DEPOSIT': 10,
  'DILUTION_BOUND': 3,
  'PROCESSING_REWARD': 1,
  'TOKEN_SUPPLY': _100e18
}

async function moveForwardPeriods (periods) {
  await blockTime()
  const goToTime = deploymentConfig.PERIOD_DURATION_IN_SECONDS * periods
  await ethereum.send('evm_increaseTime', [goToTime])
  await forceMine()
  await blockTime()
  return true
}

contract('Moloch', ([creator, summoner, applicant1, applicant2, processor, delegateKey, nonMemberAccount, ...otherAccounts]) => {
  let moloch, guildBank, tokenAlpha, tokenBeta
  let proposal1, proposal2, proposal3, depositToken

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const thirdProposalIndex = 2
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 1
  const standardLootRequest = 10
  const standardTribute = _1e18
  const summonerShares = 1

  let snapshotId

  const fundAndApproveToMoloch = async ({ token, to, from, value }) => {
    await token.transfer(to, value, { from: from })
    await token.approve(moloch.address, value, { from: to })
  }

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })

    moloch = await Moloch.new(
      summoner,
      [tokenAlpha.address, tokenBeta.address],
      deploymentConfig.PERIOD_DURATION_IN_SECONDS,
      deploymentConfig.VOTING_DURATON_IN_PERIODS,
      deploymentConfig.GRACE_DURATON_IN_PERIODS,
      deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
      deploymentConfig.BAILOUT_WAIT_IN_PERIODS,
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)

    const depositTokenAddress = await moloch.depositToken()
    assert.equal(depositTokenAddress, tokenAlpha.address)

    depositToken = tokenAlpha
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch ALPHA'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenBeta.address,
      paymentRequested: 0,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch BETA'
    }

    proposal3 = {
      applicant: applicant2,
      sharesRequested: 0,
      lootRequested: 0,
      tributeOffered: 0,
      tributeToken: tokenAlpha.address,
      paymentRequested: 10,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch ALPHA tribute BETA payment'
    }
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('rageQuit - multi-token', async () => {
    beforeEach(async () => {
      // 1st proposal for with token alpha tribute
      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      // 2nd proposal for with token beta tribute
      await fundAndApproveToMoloch({
        token: tokenBeta,
        to: proposal2.applicant,
        from: creator,
        value: proposal2.tributeOffered
      })

      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.lootRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: proposal2.applicant }
      )

      await fundAndApproveToMoloch({
        token: depositToken,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyBalances({
        token: tokenBeta,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal2.tributeOffered, // tribute now in bank
        applicant: proposal2.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: 0, // sponsor in deposit token (not this one)
        processor: processor,
        expectedProcessorBalance: 0 // rewarded in deposit token
      })

      // check sponsor in deposit token returned
      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: ((deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2), // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD * 2
      })

      await verifyMember({
        moloch: moloch,
        member: proposal2.applicant,
        expectedDelegateKey: proposal2.applicant,
        expectedShares: proposal2.sharesRequested,
        expectedLoot: proposal2.lootRequested,
        expectedMemberAddressByDelegateKey: proposal2.applicant
      })
    })

    describe('happy path - ', () => {
      const sharesToQuit = new BN('1') // all
      let initialShares
      let initialLoot
      beforeEach(async () => {
        initialShares = await moloch.totalShares()
        initialLoot = await moloch.totalLoot()
        await moloch.ragequit(sharesToQuit, 0, { from: proposal1.applicant })
      })

      it('member shares reduced', async () => {
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested - sharesToQuit,
          expectedLoot: proposal1.lootRequested,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        // started with 3 total shares - rage quitted 1 - so now 2
        const totalShares = await moloch.totalShares()
        assert.equal(+totalShares, summonerShares + proposal1.sharesRequested + proposal2.sharesRequested - sharesToQuit)

        // balances should be calculated correctly regardless of shares/loot requested in proposals 1-2
        await verifyBalances({
          token: depositToken,
          moloch: moloch.address,
          expectedMolochBalance: 0,
          guildBank: guildBank.address,
          expectedGuildBankBalance: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
          applicant: proposal1.applicant,
          expectedApplicantBalance: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
          sponsor: summoner,
          expectedSponsorBalance: ((deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2), // sponsor - deposit returned
          processor: processor,
          expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD * 2
        })

        await verifyBalances({
          token: tokenBeta,
          moloch: moloch.address,
          expectedMolochBalance: 0,
          guildBank: guildBank.address,
          expectedGuildBankBalance: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
          applicant: proposal1.applicant,
          expectedApplicantBalance: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
          sponsor: summoner,
          expectedSponsorBalance: 0,
          processor: processor,
          expectedProcessorBalance: 0
        })
      })
    })
  })

  describe('processProposal - failing token transfer', async () => {

    beforeEach(async () => {
      // 1st proposal for with token alpha tribute
      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

    })

    describe('proposal.tributeToken.transfer()', async () => {
      it('require fail - reverts because token transfer fails', async () => {

        // Force the transfer method to revert
        await tokenAlpha.updateTransfersEnabled(false)

        // Attempt to process the proposal
        await moloch.processProposal(firstProposalIndex, { from: processor })
          .should.be.rejectedWith(SolRevert)

        // Ensure balances do not change
        await verifyBalances({
          token: depositToken,
          moloch: moloch.address,
          expectedMolochBalance: proposal1.tributeOffered, // maintains tribute from proposal
          guildBank: guildBank.address,
          expectedGuildBankBalance: 0,  // balance of zero as failed to process
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0,
          sponsor: summoner,
          expectedSponsorBalance: 0,
          processor: processor,
          expectedProcessorBalance: 0
        })

        // Ensure not actually a member
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: zeroAddress,
          expectedShares: 0,
          expectedLoot: 0,
          expectedMemberAddressByDelegateKey: zeroAddress,
          expectedExists: false
        })
      })

      it('require fail - reverts with reason because token transfer fails', async () => {

        // Force the transfer method to return false skipping token transfer
        await tokenAlpha.updateTransfersReturningFalse(true)

        // Attempt to process the proposal
        await moloch.processProposal(firstProposalIndex, { from: processor })
          .should.be.rejectedWith('token transfer to guild bank failed')

        // Ensure balances do not change
        await verifyBalances({
          token: depositToken,
          moloch: moloch.address,
          expectedMolochBalance: proposal1.tributeOffered, // maintains tribute from proposal
          guildBank: guildBank.address,
          expectedGuildBankBalance: 0,  // balance of zero as failed to process
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0,
          sponsor: summoner,
          expectedSponsorBalance: 0,
          processor: processor,
          expectedProcessorBalance: 0
        })

        // Ensure not actually a member
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: zeroAddress,
          expectedShares: 0,
          expectedLoot: 0,
          expectedMemberAddressByDelegateKey: zeroAddress,
          expectedExists: false
        })
      })
    })

    describe('guildBank.withdrawToken()', async () => {
      it('require revert - fail to withdraw payment token with message', async function () {
        await moloch.processProposal(firstProposalIndex, { from: processor })

        // 2nd proposal for with token beta tribute
        await fundAndApproveToMoloch({
          token: tokenBeta,
          to: proposal2.applicant,
          from: creator,
          value: proposal2.tributeOffered
        })

        await moloch.submitProposal(
          proposal2.applicant,
          proposal2.sharesRequested,
          proposal2.lootRequested,
          proposal2.tributeOffered,
          proposal2.tributeToken,
          proposal2.paymentRequested,
          proposal2.paymentToken,
          proposal2.details,
          { from: proposal2.applicant }
        )

        await fundAndApproveToMoloch({
          token: tokenAlpha,
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        await moveForwardPeriods(1)
        await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

        await moloch.processProposal(secondProposalIndex, { from: processor })

        // Force the transfer method on beta to revert
        await tokenBeta.updateTransfersReturningFalse(true)

        // 3rd proposal for with token alpha tribute, token beta payment
        await moloch.submitProposal(
          proposal3.applicant,
          proposal3.sharesRequested,
          proposal3.lootRequested,
          proposal3.tributeOffered,
          proposal3.tributeToken,
          proposal3.paymentRequested,
          proposal3.paymentToken,
          proposal3.details,
          { from: proposal2.applicant }
        )

        await fundAndApproveToMoloch({
          token: tokenAlpha,
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })

        await moveForwardPeriods(1)
        await moloch.submitVote(thirdProposalIndex, yes, { from: summoner })

        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

        await moloch.processProposal(thirdProposalIndex, { from: processor })
          .should.be.rejectedWith('token payment to applicant failed')
      })

      it('require revert - fail to withdraw payment token with no revert message', async function () {
        await moloch.processProposal(firstProposalIndex, { from: processor })

        // 2nd proposal for with token beta tribute
        await fundAndApproveToMoloch({
          token: tokenBeta,
          to: proposal2.applicant,
          from: creator,
          value: proposal2.tributeOffered
        })

        await moloch.submitProposal(
          proposal2.applicant,
          proposal2.sharesRequested,
          proposal2.lootRequested,
          proposal2.tributeOffered,
          proposal2.tributeToken,
          proposal2.paymentRequested,
          proposal2.paymentToken,
          proposal2.details,
          { from: proposal2.applicant }
        )

        await fundAndApproveToMoloch({
          token: tokenAlpha,
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        await moveForwardPeriods(1)
        await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

        await moloch.processProposal(secondProposalIndex, { from: processor })

        // Force the transfer method on beta to revert
        await tokenBeta.updateTransfersEnabled(false)

        // 3rd proposal for with token alpha tribute, token beta payment
        await moloch.submitProposal(
          proposal3.applicant,
          proposal3.sharesRequested,
          proposal3.lootRequested,
          proposal3.tributeOffered,
          proposal3.tributeToken,
          proposal3.paymentRequested,
          proposal3.paymentToken,
          proposal3.details,
          { from: proposal2.applicant }
        )

        await fundAndApproveToMoloch({
          token: tokenAlpha,
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })

        await moveForwardPeriods(1)
        await moloch.submitVote(thirdProposalIndex, yes, { from: summoner })

        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

        await moloch.processProposal(thirdProposalIndex, { from: processor })
          .should.be.rejectedWith(SolRevert)
      })
    })
  })

  describe('edge case - emergency exit with locked token', async () => {
    it('can still process proposals after emergency exit', async () => {

      await fundAndApproveToMoloch({
        token: tokenBeta,
        to: proposal2.applicant,
        from: creator,
        value: proposal2.tributeOffered
      })

      // using non-deposit token as tribute
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.lootRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: proposal2.applicant }
      )

      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyMember({
        moloch: moloch,
        member: proposal2.applicant,
        expectedExists: false,
        expectedShares: 0,
        expectedLoot: 0
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: 0,
        processor: processor,
        expectedProcessorBalance: 0
      })

      await verifyBalances({
        token: tokenBeta,
        moloch: moloch.address,
        expectedMolochBalance: proposal2.tributeOffered,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: 0,
        processor: processor,
        expectedProcessorBalance: 0
      })

      // Force the transfer method to revert (tokenBeta used on proposal 2)
      await tokenBeta.updateTransfersReturningFalse(true)

      // fails as token has transfer disabled (fails moving to guild bank)
      await moloch.processProposal(firstProposalIndex, { from: processor })
        .should.be.rejectedWith('token transfer to guild bank failed')

      // move past emergency exit
      await moveForwardPeriods(deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS)

      // should process
      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: 1,
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false] // didPass is false
      })

      // sponsor and reward returned
      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      // tribute still in DAO
      await verifyBalances({
        token: tokenBeta,
        moloch: moloch.address,
        expectedMolochBalance: proposal2.tributeOffered,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: 0,
        processor: processor,
        expectedProcessorBalance: 0
      })

      // still no shares
      await verifyMember({
        moloch: moloch,
        member: proposal2.applicant,
        expectedExists: false,
        expectedShares: 0,
        expectedLoot: 0
      })

      // next proposal should be work as expected
      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2, // sponsor's 2nd proposal
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD * 2 // processor's 2nd proposal
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })
    })
  })
})
