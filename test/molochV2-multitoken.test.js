// v2 test spec

// New Edge Cases
// - ragequit with multiple tokens in guildbank
// - ragequit too many tokens (loop should run out of gas)
// - ragequit one less than too many tokens
// - safeRagequit even when there are too many tokens to ragequit
//   - might not work with simply 1 less b/c gas cost of providing token array
// - processProposal after emergencyExitWait expires
//   - [setup] -> break a whitelisted token in the guildbank on purpose
//   - proposal after it in queue should be able to be processed immediately
//   - broken tribute tokens must not be returned (check balance)
// - processProposal guildkick auto-fails b/c of token transfer restriction
//   - proposal can still be processed after emergencyExitWait expires

const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

const {
  verifyProposal,
  verifyFlags,
  verifyBalance,
  verifyBalances,
  verifyAllowance,
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
const _1e18Plus1 = _1e18.add(_1)
const _10e18 = new BN('10000000000000000000') // 10e18
const _100e18 = new BN('100000000000000000000') // 10e18
const _10e18Plus1 = _10e18.add(_1)

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
  let proposal1, proposal2, depositToken

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 1
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
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)

    depositToken = await moloch.depositToken()
    assert.equal(depositToken, tokenAlpha.address)

    depositToken = tokenAlpha
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: standardShareRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch ALPHA'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: standardShareRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenBeta.address,
      paymentRequested: 0,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch BETA'
    }

    // tokenAlpha.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe.only('rageQuit - multi-token', () => {
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

      await verifyFlags({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + summonerShares, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: summonerShares
      })

      await verifyFlags({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

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

      await verifyFlags({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAtYesVote: proposal1.sharesRequested + 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + proposal2.sharesRequested + summonerShares, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: proposal1.sharesRequested + summonerShares
      })

      await verifyFlags({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

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
        expectedMemberAddressByDelegateKey: proposal2.applicant
      })
    })

    describe('happy path - ', () => {
      const sharesToQuit = new BN('1') // all
      let initialShares
      beforeEach(async () => {
        initialShares = await moloch.totalShares()
        await moloch.ragequit(sharesToQuit, { from: proposal1.applicant })
      })

      it('member shares reduced', async () => {
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested - sharesToQuit,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        // started with 3 total shares - rage quitted 1 - so now 2
        const totalShares = await moloch.totalShares()
        assert.equal(+totalShares, summonerShares + proposal1.sharesRequested + proposal2.sharesRequested - sharesToQuit)

        // we have 1e18 of Token Alpha and Token Beta - we are quitting 1 share of 3 in total
        // so the quitter should get a 1/3 of each token in the DAO

        await verifyBalances({
          token: depositToken,
          moloch: moloch.address,
          expectedMolochBalance: 0,
          guildBank: guildBank.address,
          expectedGuildBankBalance: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares)),
          applicant: proposal1.applicant,
          expectedApplicantBalance: _1e18.mul(sharesToQuit).div(initialShares),
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
          expectedGuildBankBalance: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares)),
          applicant: proposal1.applicant,
          expectedApplicantBalance: _1e18.mul(sharesToQuit).div(initialShares),
          sponsor: summoner,
          expectedSponsorBalance: 0,
          processor: processor,
          expectedProcessorBalance: 0
        })
      })
    })
  })
})
