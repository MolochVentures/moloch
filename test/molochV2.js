// v2 test spec
//
// Process
// 0. Read the Guide
//  - https://github.com/MolochVentures/moloch/blob/master/test/README.md DONE
// 1. Remove obviated code
// 2. Update tests in logical order (constructor, submitProposal, etc..)
//  - update test code based on changelog to get each test passing
// 3. Add tests for new functions
// 4. Add tests for new edge cases
//
// Cleanup
// - remove abort tests
// - update to new proposal mapping data structure
// - update to new proposal.flags data structure
// - update to using a base token instead of default moloch.approvedToken
// - update to deposit token for proposal deposits instead of approvedToken
//
// New Functions
// - sponsorProposal
// - submitWhitelistProposal
// - submitGuildKickProposal
// - safeRagequit
// - cancelProposal
//
// submitProposal
// - update verifySubmitProposal to simply check that proposal is saved
// - test all requires, modifiers, and code paths (whitelist, guild kick)
//
// sponsorProposal
// - copy verifySubmitProposal code to verifySponsorProposal to do the rest
// - test all requires, modifiers, and code paths (whitelist, guild kick)
//
// submitWhitelistProposal
// - check that proposal data are saved properly
//
// submitGuildKickProposal
// - check that proposal data are saved properly
//
// processProposal
// - passing proposal auto-fails if guildbank doesn't have $$ for a payment
//   - proposal sends payment otherwise
// - return funds to proposer, not applicant
// - guild kick ragequits on behalf of a user
//   - updates proposedToKick (for both successs & failure)
// - token whitelist adds token to whitelist
//   - updates proposedToWhitelist (for both successs & failure)
//
// safeRagequit
// - works only for approved tokens, ragequits the correct amounts
//   - e.g. airdrop a non-whitelisted token on to guildbank, then try
//
// cancelProposal
// - returns the tribute tokens to the proposer
//
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

const utils = require('./utils')

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const deploymentConfig = {
  'SUMMONER': '0x9a8d670c323e894dda9a045372a75d607a47cb9e',
  'PERIOD_DURATION_IN_SECONDS': 17280,
  'VOTING_DURATON_IN_PERIODS': 35,
  'GRACE_DURATON_IN_PERIODS': 35,
  'EMERGENCY_EXIT_WAIT_IN_PERIODS': 35,
  'PROPOSAL_DEPOSIT': 10,
  'DILUTION_BOUND': 3,
  'PROCESSING_REWARD': 1,
  'TOKEN_SUPPLY': 10000
}

const revertMesages = {
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorPeriodDurationCannotBe0: '_periodDuration cannot be 0',
  molochConstructorVotingPeriodLengthCannotBe0: '_votingPeriodLength cannot be 0',
  molochConstructorVotingPeriodLengthExceedsLimit: '_votingPeriodLength exceeds limit',
  molochConstructorGracePeriodLengthExceedsLimit: '_gracePeriodLength exceeds limit',
  molochConstructorEmergencyExitWaitCannotBe0: '_emergencyExitWait cannot be 0',
  molochConstructorDilutionBoundCannotBe0: '_dilutionBound cannot be 0',
  molochConstructorDilutionBoundExceedsLimit: '_dilutionBound exceeds limit',
  molochConstructorNeedAtLeastOneApprovedToken: 'need at least one approved token',
  molochConstructorDepositCannotBeSmallerThanProcessingReward: '_proposalDeposit cannot be smaller than _processingReward',
  molochConstructorApprovedTokenCannotBe0: '_approvedToken cannot be 0',
  molochConstructorDuplicateApprovedToken: 'revert duplicate approved token',
  submitProposalTributeTokenIsNotWhitelisted: 'tributeToken is not whitelisted',
  submitProposalPaymetTokenIsNotWhitelisted: 'payment is not whitelisted',
  submitProposalApplicantCannotBe0: 'revert applicant cannot be 0',
  submitWhitelistProposalMustProvideTokenAddress: 'must provide token address',
  submitWhitelistProposalAlreadyHaveWhitelistedToken: 'can\'t already have whitelisted the token',
  submitGuildKickProposalMemberMustHaveAtLeastOneShare: 'member must have at least one share',
  sponsorProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  sponsorProposalProposalHasAlreadyBeenCancelled: 'proposal has been cancelled',
  sponsorProposalAlreadyProposedToWhitelist: 'already proposed to whitelist',
  sponsorProposalAlreadyProposedToKick: 'already proposed to kick',
  sponsorProposalTooManySharesRequested: 'too many shares requested',
  submitVoteProposalDoesNotExist: 'proposal does not exist',
  submitVoteMustBeLessThan3: 'must be less than 3',
  submitVoteVotingPeriodHasNotStarted: 'voting period has not started',
  submitVoteVotingPeriodHasExpired: 'voting period has expired',
  submitVoteMemberHasAlreadyVoted: 'member has already voted',
  submitVoteVoteMustBeEitherYesOrNo: 'vote must be either Yes or No',
  cancelProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  cancelProposalOnlyTheProposerCanCancel: 'only the proposer can cancel',
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const notOwnedAddress = '0x0000000000000000000000000000000000000002'

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18
const _1e18Plus1 = _1e18.add(_1)
const _10e18 = new BN('10000000000000000000') // 10e18
const _10e18Plus1 = _10e18.add(_1)

const valueOr0 = (val) => val ? val : 0

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

async function moveForwardPeriods (periods) {
  await blockTime()
  const goToTime = deploymentConfig.PERIOD_DURATION_IN_SECONDS * periods
  await ethereum.send('evm_increaseTime', [goToTime])
  await forceMine()
  await blockTime()
  return true
}

contract('Moloch', ([creator, summoner, applicant1, applicant2, processor, delegateKey, ...otherAccounts]) => {
  let moloch, guildBank, tokenAlpha, tokenBeta
  let proposal1, proposal2

  const initSummonerBalance = 100

  let snapshotId

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY)
    tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY)

    moloch = await Moloch.new(
      deploymentConfig.SUMMONER,
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
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: 1,
      tributeOffered: 100,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch',
      flags: [false, false, false, false, false, false] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: 1,
      tributeOffered: 50,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch 2',
      flags: [false, false, false, false, false, false] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    }

    tokenAlpha.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('constructor', () => {
    it('verify deployment parameters', async () => {
      // eslint-disable-next-line no-unused-vars
      const now = await blockTime()

      const proposalCount = await moloch.proposalCount()
      assert.equal(proposalCount, 0)

      const depositToken = await moloch.depositToken()
      assert.equal(depositToken, tokenAlpha.address)

      const guildBankAddress = await moloch.guildBank()
      assert.equal(guildBankAddress, guildBank.address)

      const guildBankOwner = await guildBank.owner()
      assert.equal(guildBankOwner, moloch.address)

      const periodDuration = await moloch.periodDuration()
      assert.equal(+periodDuration, deploymentConfig.PERIOD_DURATION_IN_SECONDS)

      const votingPeriodLength = await moloch.votingPeriodLength()
      assert.equal(+votingPeriodLength, deploymentConfig.VOTING_DURATON_IN_PERIODS)

      const gracePeriodLength = await moloch.gracePeriodLength()
      assert.equal(+gracePeriodLength, deploymentConfig.GRACE_DURATON_IN_PERIODS)

      const emergencyExitWaitLength = await moloch.emergencyExitWait()
      assert.equal(+emergencyExitWaitLength, deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS)

      const proposalDeposit = await moloch.proposalDeposit()
      assert.equal(+proposalDeposit, deploymentConfig.PROPOSAL_DEPOSIT)

      const dilutionBound = await moloch.dilutionBound()
      assert.equal(+dilutionBound, deploymentConfig.DILUTION_BOUND)

      const processingReward = await moloch.processingReward()
      assert.equal(+processingReward, deploymentConfig.PROCESSING_REWARD)

      const currentPeriod = await moloch.getCurrentPeriod()
      assert.equal(+currentPeriod, 0)

      const summonerData = await moloch.members(deploymentConfig.SUMMONER)
      assert.equal(summonerData.delegateKey.toLowerCase(), deploymentConfig.SUMMONER) // delegateKey matches
      assert.equal(summonerData.shares, 1)
      assert.equal(summonerData.exists, true)
      assert.equal(summonerData.highestIndexYesVote, 0)

      const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(
        deploymentConfig.SUMMONER
      )
      assert.equal(summonerAddressByDelegateKey.toLowerCase(), deploymentConfig.SUMMONER)

      const totalShares = await moloch.totalShares()
      assert.equal(+totalShares, 1)

      // confirm initial deposit token supply and summoner balance
      const tokenSupply = await tokenAlpha.totalSupply()
      assert.equal(+tokenSupply.toString(), deploymentConfig.TOKEN_SUPPLY)
      const summonerBalance = await tokenAlpha.balanceOf(summoner)
      assert.equal(+summonerBalance.toString(), initSummonerBalance)
      const creatorBalance = await tokenAlpha.balanceOf(creator)
      assert.equal(creatorBalance, deploymentConfig.TOKEN_SUPPLY - initSummonerBalance)

      // check all tokens passed in construction are approved
      const tokenAlphaApproved = await moloch.tokenWhitelist(tokenAlpha.address)
      assert.equal(tokenAlphaApproved, true)

      const tokenBetaApproved = await moloch.tokenWhitelist(tokenBeta.address)
      assert.equal(tokenBetaApproved, true)

      // first token should be the deposit token
      const firstWhitelistedToken = await moloch.approvedTokens(0)
      assert.equal(firstWhitelistedToken, depositToken)
      assert.equal(firstWhitelistedToken, tokenAlpha.address)

      // second token should be the additional token
      const secondWhitelistedToken = await moloch.approvedTokens(1)
      assert.equal(secondWhitelistedToken, tokenBeta.address)
    })

    it('require fail - summoner can not be zero address', async () => {
      await Moloch.new(
        zeroAddress,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorSummonerCannotBe0)
    })

    it('require fail - period duration can not be zero', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        0,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorPeriodDurationCannotBe0)
    })

    it('require fail - voting period can not be zero', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        0,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorVotingPeriodLengthCannotBe0)
    })

    it('require fail - voting period exceeds limit', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        _10e18,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorVotingPeriodLengthExceedsLimit)

      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        _10e18Plus1,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorVotingPeriodLengthExceedsLimit)
    })

    it('require fail - grace period exceeds limit', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        _10e18,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorGracePeriodLengthExceedsLimit)

      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        _10e18Plus1,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorGracePeriodLengthExceedsLimit)
    })

    it('require fail - emergency exit wait can not be zero', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        0,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorEmergencyExitWaitCannotBe0)
    })

    it('require fail - dilution bound can not be zero', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        0,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorDilutionBoundCannotBe0)
    })

    it('require fail - dilution bound exceeds limit', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        _10e18,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorDilutionBoundExceedsLimit)

      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        _10e18Plus1,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorDilutionBoundExceedsLimit)
    })

    it('require fail - need at least one approved token', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorNeedAtLeastOneApprovedToken)
    })

    it('require fail - deposit cannot be smaller than processing reward', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        _1e18,
        deploymentConfig.DILUTION_BOUND,
        _1e18Plus1
      ).should.be.rejectedWith(revertMesages.molochConstructorDepositCannotBeSmallerThanProcessingReward)
    })

    it('require fail - approved token cannot be zero', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [zeroAddress, tokenBeta.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorApprovedTokenCannotBe0)
    })

    it('require fail - duplicate approved token', async () => {
      await Moloch.new(
        deploymentConfig.SUMMONER,
        [tokenAlpha.address, tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMesages.molochConstructorDuplicateApprovedToken)
    })
  })

  describe('submitProposal', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })
    })

    it('happy case', async () => {
      const countBefore = await moloch.proposalCount()

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

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))

      await verifySubmitProposal(proposal1, 0, proposal1.applicant, {
        initialApplicantBalance: proposal1.tributeOffered
      })
    })

    it('require fail - insufficient tribute tokens', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: proposal1.applicant })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(SolRevert)
    })

    it('require fail - tribute token is not whitelisted', async () => {
      proposal1.tributeToken = zeroAddress

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitProposalTributeTokenIsNotWhitelisted)
    })

    it('require fail - payment token is not whitelisted', async () => {
      proposal1.paymentToken = zeroAddress

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitProposalPaymetTokenIsNotWhitelisted)
    })

    it('require fail - applicant can not be zero', async () => {
      await moloch.submitProposal(
        zeroAddress,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitProposalApplicantCannotBe0)
    })
  })

  describe('submitWhitelistProposal', () => {
    let newToken
    beforeEach(async () => {
      newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)
    })

    it('happy case', async () => {
      const countBefore = await moloch.proposalCount()

      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: proposal1.applicant,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!',
        flags: [false, false, false, false, true, false] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
      }

      await moloch.submitWhitelistProposal(
        whitelistProposal.tributeToken,
        whitelistProposal.details,
        { from: proposer }
      )

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))

      await verifySubmitProposal(whitelistProposal, 0, proposer, {})
    })

    it('require fail - applicant can not be zero', async () => {
      await moloch.submitWhitelistProposal(
        zeroAddress,
        'whitelist me!',
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitWhitelistProposalMustProvideTokenAddress)
    })

    it('require fail - cannot add already have whitelisted the token', async () => {
      await moloch.submitWhitelistProposal(
        tokenAlpha.address,
        'whitelist me!',
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitWhitelistProposalAlreadyHaveWhitelistedToken)
    })
  })

  describe('submitGuildKickProposal', () => {
    it('happy case', async () => {
      const countBefore = await moloch.proposalCount()

      const summonerBalance = await tokenAlpha.balanceOf(summoner)

      const proposer = proposal1.applicant
      const guildKickProposal = {
        applicant: deploymentConfig.SUMMONER,
        proposer: proposer,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: zeroAddress,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'kick me!',
        flags: [false, false, false, false, false, true] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
      }

      await moloch.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: proposer }
      )

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))

      await verifySubmitProposal(guildKickProposal, 0, proposer, {
        initialApplicantBalance: summonerBalance
      })
    })

    it('require fail - member must have at least one share', async () => {
      await moloch.submitGuildKickProposal(
        zeroAddress,
        'kick me!',
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMesages.submitGuildKickProposalMemberMustHaveAtLeastOneShare)
    })
  })

  describe('sponsorProposal', () => {
    beforeEach(async () => {
      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })
    })

    it('happy path - sponsor add token to whitelist', async () => {
      const newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const proposer = proposal1.applicant

      // whitelist newToken
      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposer }
      )

      let proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 0)

      let proposedToWhitelist = await moloch.proposedToWhitelist(newToken.address)
      assert.equal(proposedToWhitelist, false)

      // sponsor send by a delegate
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      proposedToWhitelist = await moloch.proposedToWhitelist(newToken.address)
      assert.equal(proposedToWhitelist, true)

      let proposal = await moloch.proposals(0)
      assert.equal(proposal.sponsor.toLowerCase(), deploymentConfig.SUMMONER.toLowerCase())
      assert.equal(proposal.startingPeriod, 1) // should be 1 plus the current period that is 0

      proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 1)
    })

    it('happy path - sponsor guildKick proposal', async () => {
      const proposer = proposal1.applicant

      await moloch.submitGuildKickProposal(
        deploymentConfig.SUMMONER,
        'kick',
        { from: proposer }
      )

      let proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 0)

      let proposedToKick = await moloch.proposedToKick(deploymentConfig.SUMMONER)
      assert.equal(proposedToKick, false)

      // sponsor send by a delegate
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      proposedToKick = await moloch.proposedToKick(deploymentConfig.SUMMONER)
      assert.equal(proposedToKick, true)

      let proposal = await moloch.proposals(0)
      assert.equal(proposal.sponsor.toLowerCase(), deploymentConfig.SUMMONER.toLowerCase())
      assert.equal(proposal.startingPeriod, 1) // should be 1 plus the current period that is 0

      proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 1)
    })

    it('happy path - sponsor proposal', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested, // 1
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      let proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 0)

      let totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(+totalSharesRequested, 0)

      // sponsor send by a delegate
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(+totalSharesRequested, 1)

      let proposal = await moloch.proposals(0)
      assert.equal(proposal.sponsor.toLowerCase(), deploymentConfig.SUMMONER.toLowerCase())
      assert.equal(proposal.startingPeriod, 1) // should be 1 plus the current period that is 0

      proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(+proposalQueueLength, 1)
    })

    it('failure - proposal has already been sponsored', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested, // 1
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      // sponsor send by a delegate
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      // add another deposit to re-sponsor
      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.sponsorProposalProposalHasAlreadyBeenSponsored)
    })

    it('failure - proposal has been cancelled', async () => {
      const newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const proposer = proposal1.applicant

      // whitelist newToken
      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposer }
      )

      await moloch.cancelProposal(0, { from: proposer })

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.sponsorProposal)
    })

    it('failure - sponsor whitelist token proposal already proposed', async () => {
      const newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const proposer = proposal1.applicant

      // whitelist newToken
      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposer }
      )

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      let proposedToWhitelist = await moloch.proposedToWhitelist(newToken.address)
      assert.equal(proposedToWhitelist, true)

      // duplicate proposal
      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposer }
      )

      // add another deposit to sponsor proposal 1
      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      await moloch.sponsorProposal(1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.sponsorProposalAlreadyProposedToWhitelist)
    })

    it('failure - sponsor kick proposal already proposed', async () => {
      const proposer = proposal1.applicant

      await moloch.submitGuildKickProposal(
        deploymentConfig.SUMMONER,
        'kick',
        { from: proposer }
      )

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      let proposedToKick = await moloch.proposedToKick(deploymentConfig.SUMMONER)
      assert.equal(proposedToKick, true)

      // duplicate proposal
      await moloch.submitGuildKickProposal(
        deploymentConfig.SUMMONER,
        'kick',
        { from: proposer }
      )

      // add another deposit to sponsor proposal 1
      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      await moloch.sponsorProposal(1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.sponsorProposalAlreadyProposedToKick)
    })

    it('failure - too many shares requested', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      await moloch.submitProposal(
        proposal1.applicant,
        _10e18, // MAX_NUMBER_OF_SHARES
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.sponsorProposalTooManySharesRequested)
    })

    it('require fail - insufficient deposit token', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: deploymentConfig.SUMMONER })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.sponsorProposal(123, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(SolRevert)
    })

    // FIXME check this is a valid use-case!
    it('edge case - sponsor non-existant proposal', async () => {
      let proposal = await moloch.proposals(123456)
      assert.equal(proposal.applicant, zeroAddress)
      assert.equal(proposal.proposer, zeroAddress)
      assert.equal(proposal.sponsor, zeroAddress)

      await moloch.sponsorProposal(123456, { from: deploymentConfig.SUMMONER })

      // takes deposit and adds to the queue
      proposal = await moloch.proposals(123456)
      assert.equal(proposal.sponsor.toLowerCase(), deploymentConfig.SUMMONER.toLowerCase())

      let queue = await moloch.proposalQueue(0)
      assert.equal(+queue, 123456)
    })
  })

  describe('submitVote', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

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

      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })
      await verifySubmitVote(proposal1, 0, deploymentConfig.SUMMONER, 1, {
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 2, { from: deploymentConfig.SUMMONER })
      await verifySubmitVote(proposal1, 0, summoner, 2, {})
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.submitVoteProposalDoesNotExist)
    })

    it('require fail - vote must be less than 3', async () => {
      await moloch.submitVote(0, 3, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.submitVoteMustBeLessThan3)
    })

    // TODO require(proposal.flags[0], "proposal has not been sponsored"); can not be reached because of this: require(proposalIndex < proposalQueue.length, "proposal does not exist");
    it('require fail - proposal has not been sponsored', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // proposal 1
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

      // no sponsor made
      await moloch
        .submitVote(1, 1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith('proposal has not been sponsored')
    })

    it('require fail - voting period has not started', async () => {
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasNotStarted)
    })

    describe('voting period boundary', () => {
      it('require fail - voting period has expired', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS + 1)
        await moloch
          .submitVote(0, 1, { from: deploymentConfig.SUMMONER })
          .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasExpired)
      })

      it('success - vote 1 period before voting period expires', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })
        await verifySubmitVote(proposal1, 0, deploymentConfig.SUMMONER, 1, {
          expectedMaxSharesAtYesVote: 1
        })
      })
    })

    it('require fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })
      await moloch
        .submitVote(0, 1, { from: deploymentConfig.SUMMONER })
        .should.be.rejectedWith(revertMesages.submitVoteMemberHasAlreadyVoted)
    })

    it('require fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch
        .submitVote(0, 0, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitVoteVoteMustBeEitherYesOrNo)
    })

    it('modifier - delegate', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: creator })
        .should.be.rejectedWith('not a delegate')
    })

    // TODO edge cases - explore two ifs inside the YES vote

    describe('submitVote modifying member.highestIndexYesVote', () => {

      const proposal2Index = 1

      beforeEach(async () => {
        await tokenAlpha.transfer(proposal2.applicant, proposal2.tributeOffered, { from: creator })
        await tokenAlpha.approve(moloch.address, proposal2.tributeOffered, { from: proposal2.applicant })

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

        const proposalDeposit = await moloch.proposalDeposit()
        await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
        await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

        await moloch.sponsorProposal(1, { from: deploymentConfig.SUMMONER })
      })

      it('proposal two should be created in the right state', async () => {

        // TODO consider passing flags into the validate method and not mutating the proposal template IMO
        proposal2.flags = [true, false, false, false, false, false]

        await verifySubmitProposal(proposal2, proposal2Index, proposal2.applicant, {
          initialApplicantBalance: proposal2.tributeOffered,
          sponsor: deploymentConfig.SUMMONER,
          expectedStartingPeriod: 2,
          expectedMolochBalance: 170 // (100 (proposal 1) + 10 (sponsorship)) + (50 (proposal 2) + 10 (sponsorship)) = 170
        })
      })

      it('require fail - voting period not starting yet', async () => {
        await moloch.submitVote(proposal2Index, 1, { from: deploymentConfig.SUMMONER })
          .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasNotStarted)
      })

      it('happy case - yes vote - highestIndexYesVote update', async () => {
        await moveForwardPeriods(2)
        await moloch.submitVote(proposal2Index, 1, { from: deploymentConfig.SUMMONER })
        await verifySubmitVote(proposal2, proposal2Index, deploymentConfig.SUMMONER, 1, {
          expectedMaxSharesAtYesVote: 1
        })

        const memberData = await moloch.members(deploymentConfig.SUMMONER)
        assert.equal(memberData.highestIndexYesVote, proposal2Index, 'highestIndexYesVote does not match')
      })

      it('happy case - no vote - highestIndexYesVote not updated', async () => {
        await moveForwardPeriods(2)
        await moloch.submitVote(proposal2Index, 2, { from: deploymentConfig.SUMMONER })
        await verifySubmitVote(proposal2, proposal2Index, summoner, 2, {})

        const memberData = await moloch.members(deploymentConfig.SUMMONER)
        assert.equal(memberData.highestIndexYesVote, 0, 'highestIndexYesVote does not match')
      })

    })
  })

  describe('processProposal', () => {
    let proposer, applicant
    beforeEach(async () => {

    })

    it('happy path - pass', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      // sponsor
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(0, { from: processor })

      // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
      proposal1.flags = [true, true, true, false, false, false] // fixme didPass to be TRUE?

      await verifyProcessProposal(proposal1, 0, proposer, deploymentConfig.SUMMONER, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialSponsorBalance: initSummonerBalance,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('happy path - token whitelist', async () => {
      const newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      // submit whitelist proposal
      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: proposal1.applicant,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!',
        flags: [true, true, true, false, true, false] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
      }

      await moloch.submitWhitelistProposal(
        whitelistProposal.tributeToken,
        whitelistProposal.details,
        { from: proposer }
      )

      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      // sponsor
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(0, { from: processor })

      await verifyProcessProposal(whitelistProposal, 0, proposer, deploymentConfig.SUMMONER, processor, {
        initialTotalSharesRequested: 0,
        initialTotalShares: 1,
        initialMolochBalance: proposalDeposit,
        initialSponsorBalance: initSummonerBalance,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })

      const newApprovedToken = await moloch.approvedTokens(2)
      assert.equal(newApprovedToken, newToken.address)
    })

    it.only('happy path - kick member', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      // sponsor
      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: deploymentConfig.SUMMONER })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(0, { from: processor })

      // proposal 1 has given applicant shares
      const member = await moloch.members(applicant)
      assert.equal(+member.shares, proposal1.sharesRequested)

      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      // sponsor
      await moloch.sponsorProposal(1, { from: deploymentConfig.SUMMONER })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from: deploymentConfig.SUMMONER })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      const proposal = await moloch.proposals(1)
      console.log('Proposal', proposal)
      console.log('member', member)

      await moloch.processProposal(1, { from: applicant })

      // await verifyProcessProposal(proposal1, 0, proposer, deploymentConfig.SUMMONER, processor, {
      //   initialTotalSharesRequested: 0,
      //   initialTotalShares: 1,
      //   initialMolochBalance: proposalDeposit,
      //   initialSponsorBalance: initSummonerBalance,
      //   expectedYesVotes: 1,
      //   expectedMaxSharesAtYesVote: 1
      // })

    })
  })

  describe('cancelProposal', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

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
    })

    it('happy case', async () => {
      const proposal = await moloch.proposals(0)

      let proposalFlags = await moloch.getProposalFlags(0)
      assert.equal(proposalFlags[3], false) // not cancelled

      let proposerBalance = await tokenAlpha.balanceOf(proposal1.applicant)

      await moloch.cancelProposal(0, { from: proposal1.applicant })

      proposalFlags = await moloch.getProposalFlags(0)
      assert.equal(proposalFlags[3], true) // cancelled

      // tribute offered has been returned
      let proposerBalanceAfterCancel = await tokenAlpha.balanceOf(proposal1.applicant)
      assert.equal(+proposerBalanceAfterCancel, +proposerBalance + proposal.tributeOffered)
    })

    it('failure - already sponsored', async () => {
      const proposalDeposit = await moloch.proposalDeposit()
      await tokenAlpha.transfer(deploymentConfig.SUMMONER, proposalDeposit, { from: creator })
      await tokenAlpha.approve(moloch.address, proposalDeposit, { from: deploymentConfig.SUMMONER })

      await moloch.sponsorProposal(0, { from: deploymentConfig.SUMMONER })

      await moloch.cancelProposal(0, { from: proposal1.applicant })
        .should.be.rejectedWith(revertMesages.cancelProposalProposalHasAlreadyBeenSponsored)
    })

    it('failure - only the proposer can cancel', async () => {
      await moloch.cancelProposal(0, { from: creator })
        .should.be.rejectedWith(revertMesages.cancelProposalOnlyTheProposerCanCancel)
    })
  })

  // VERIFY SUBMIT PROPOSAL
  const verifySubmitProposal = async (
    proposal,
    proposalIndex,
    proposer,
    options
  ) => {
    const initialApplicantBalance = valueOr0(options.initialApplicantBalance)
    const expectedStartingPeriod = valueOr0(options.expectedStartingPeriod)

    const proposalData = await moloch.proposals(proposalIndex)

    assert.equal(proposalData.applicant.toLowerCase(), proposal.applicant.toLowerCase()) // FIXME can be improved
    assert.equal(proposalData.proposer, proposer, 'proposers does not match')
    const expectedSponsor = options.sponsor
      ? options.sponsor.toLowerCase()
      : zeroAddress
    assert.equal(proposalData.sponsor.toLowerCase(), expectedSponsor, 'sponsors incorrectly set')

    if (typeof proposal.sharesRequested === 'number') {
      assert.equal(proposalData.sharesRequested, proposal.sharesRequested, 'sharesRequested does not match')
    } else {
      // for testing overflow boundary with BNs
      assert(proposalData.sharesRequested.eq(proposal.sharesRequested), 'sharesRequested does not match')
    }
    assert.equal(proposalData.tributeOffered, proposal.tributeOffered, 'tributeOffered does not match')
    assert.equal(proposalData.tributeToken, proposal.tributeToken, 'tributeToken does not match')

    assert.equal(proposalData.paymentRequested, proposal.paymentRequested, 'paymentRequested does not match')
    assert.equal(proposalData.paymentToken, proposal.paymentToken, 'paymentToken does not match')

    assert.equal(proposalData.startingPeriod, expectedStartingPeriod, 'startingPeriod does not match')
    assert.equal(proposalData.yesVotes, 0, 'yesVotes does not match')
    assert.equal(proposalData.noVotes, 0, 'noVotes does not match')

    const proposalFlags = await moloch.getProposalFlags(proposalIndex)

    // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    assert.equal(proposalFlags[0], proposal.flags[0], 'sponsored flag incorrect')
    assert.equal(proposalFlags[1], proposal.flags[1], 'processed flag incorrect')
    assert.equal(proposalFlags[2], proposal.flags[2], 'didPass flag incorrect')
    assert.equal(proposalFlags[3], proposal.flags[3], 'cancelled flag incorrect')
    assert.equal(proposalFlags[4], proposal.flags[4], 'whitelist flag incorrect')
    assert.equal(proposalFlags[5], proposal.flags[5], 'guildkick flag incorrect')

    assert.equal(proposalData.details, proposal.details, 'details does not match')
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0, 'maxTotalSharesAtYesVote invalid')

    const molochBalance = await tokenAlpha.balanceOf(moloch.address)
    const expectedMolochBalance = options.expectedMolochBalance || proposal.tributeOffered
    assert.equal(molochBalance, expectedMolochBalance, 'moloch balance incorrect')

    const applicantBalance = await tokenAlpha.balanceOf(proposal.applicant)
    assert.equal(applicantBalance, initialApplicantBalance - proposal.tributeOffered, 'application balance incorrect')
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (
    proposal,
    proposalIndex,
    memberAddress,
    expectedVote,
    options
  ) => {
    const initialYesVotes = valueOr0(options.initialYesVotes)
    const initialNoVotes = valueOr0(options.initialNoVotes)
    const expectedMaxSharesAtYesVote = valueOr0(options.expectedMaxSharesAtYesVote)

    const proposalData = await moloch.proposals(proposalIndex)
    assert.equal(proposalData.yesVotes, initialYesVotes + (expectedVote === 1 ? 1 : 0))
    assert.equal(proposalData.noVotes, initialNoVotes + (expectedVote === 1 ? 0 : 1))
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)

    const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
    assert.equal(memberVote, expectedVote)
  }

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (
    proposal,
    proposalIndex,
    proposer,
    sponsor,
    processor,
    options
  ) => {
    // TODO fix initialTotalSharesRequested not used
    // eslint-disable-next-line no-unused-vars
    const initialTotalSharesRequested = valueOr0(options.initialTotalSharesRequested)
    const initialTotalShares = valueOr0(options.initialTotalShares)
    const initialApplicantShares = valueOr0(options.initialApplicantShares)
    const initialMolochBalance = valueOr0(options.initialMolochBalance)
    const initialGuildBankBalance = valueOr0(options.initialGuildBankBalance)
    const initialApplicantBalance = valueOr0(options.initialApplicantBalance)
    const initialProposerBalance = valueOr0(options.initialProposerBalance)
    const initialSponsorBalance = valueOr0(options.initialSponsorBalance)
    const initialProcessorBalance = valueOr0(options.initialProcessorBalance)
    const expectedYesVotes = valueOr0(options.expectedYesVotes)
    const expectedNoVotes = valueOr0(options.expectedNoVotes)
    const expectedMaxSharesAtYesVote = valueOr0(options.expectedMaxSharesAtYesVote)
    const expectedFinalTotalSharesRequested = valueOr0(options.expectedFinalTotalSharesRequested)

    // flags and proposal data
    const proposalFlags = await moloch.getProposalFlags(proposalIndex)
    const proposalData = await moloch.proposals(proposalIndex)

    const didPass = proposalFlags[2]
    assert.equal(proposalData.yesVotes, expectedYesVotes, 'proposal yes votes incorrect')
    assert.equal(proposalData.noVotes, expectedNoVotes, 'proposal no votes incorrect')
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote, 'proposal total shares at yes cote incorrect')

    // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    assert.equal(proposalFlags[0], proposal.flags[0], 'sponsored flag incorrect')
    assert.equal(proposalFlags[1], proposal.flags[1], 'processed flag incorrect')
    assert.equal(proposalFlags[2], proposal.flags[2], 'didPass flag incorrect')
    assert.equal(proposalFlags[3], proposal.flags[3], 'cancelled flag incorrect')
    assert.equal(proposalFlags[4], proposal.flags[4], 'whitelist flag incorrect')
    assert.equal(proposalFlags[5], proposal.flags[5], 'guildkick flag incorrect')

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(totalSharesRequested, expectedFinalTotalSharesRequested, 'total shares requested incorrect')

    const totalShares = await moloch.totalShares()
    const expectedTotalShares = didPass ? initialTotalShares + proposal.sharesRequested : initialTotalShares
    assert.equal(totalShares, expectedTotalShares, 'total shares incorrect')

    const molochBalance = await tokenAlpha.balanceOf(moloch.address)
    const expectedMolochBalance = initialMolochBalance - proposalData.tributeOffered - deploymentConfig.PROPOSAL_DEPOSIT
    assert.equal(molochBalance, expectedMolochBalance, 'moloch balance incorrect')

    // FIXME for multi-token
    const guildBankBalance = await tokenAlpha.balanceOf(guildBank.address)
    const expectedGuildBankBalance = didPass ? initialGuildBankBalance + proposal.tributeOffered : initialGuildBankBalance
    assert.equal(guildBankBalance, expectedGuildBankBalance, 'application balance incorrect')

    // proposer and applicant are different
    if (proposer !== proposal.applicant) {
      const applicantBalance = await tokenAlpha.balanceOf(proposal.applicant)
      const expectedApplicantBalance = didPass ? initialApplicantBalance : initialApplicantBalance + proposal.tributeOffered
      assert.equal(applicantBalance, expectedApplicantBalance, 'application balance incorrect')

      // TODO fixme
      const proposerBalance = await tokenAlpha.balanceOf(proposer)
      const expectedProposerBalance = initialProposerBalance
      assert.equal(+proposerBalance, +expectedProposerBalance, 'proposer balance incorrect')
    } else {

      const sponsorBalance = await tokenAlpha.balanceOf(sponsor)
      const expectedBalance = didPass
        ? initialSponsorBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD
        : initialSponsorBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD + proposal.tributeOffered
      assert.equal(+sponsorBalance, +expectedBalance, 'sponsor balance incorrect')
    }

    const processorBalance = await tokenAlpha.balanceOf(processor)
    assert.equal(
      processorBalance,
      initialProcessorBalance + deploymentConfig.PROCESSING_REWARD,
      'processing balance incorrect'
    )

    if (didPass) {
      // whitelist token
      if (proposalFlags[4]) {
        // FIXME rework
      } else {
        // existing member
        if (initialApplicantShares > 0) {
          const memberData = await moloch.members(proposal.applicant)
          assert.equal(
            memberData.shares,
            proposal.sharesRequested + initialApplicantShares
          )
        } else {
          const newMemberData = await moloch.members(proposal.applicant)
          assert.equal(newMemberData.delegateKey, proposal.applicant)
          assert.equal(newMemberData.shares, proposal.sharesRequested)
          assert.equal(newMemberData.exists, true)
          assert.equal(newMemberData.highestIndexYesVote, 0)

          const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(proposal.applicant)
          assert.equal(newMemberAddressByDelegateKey, proposal.applicant)
        }
      }
    }
  }
})
