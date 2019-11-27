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

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

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
  submitProposalProposalMustHaveBeenProposed: 'proposal must have been proposed',
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
  processProposalProposalDoesNotExist: 'proposal does not exist',
  processProposalProposalIsNotReadyToBeProcessed: 'proposal is not ready to be processed',
  processProposalProposalHasAlreadyBeenProcessed: 'proposal has already been processed',
  processProposalPreviousProposalMustBeProcessed: 'previous proposal must be processed',
  molochNotAMember: 'not a member',
  molochRageQuitInsufficientShares: 'insufficient shares',
  updateDelegateKeyNewDelegateKeyCannotBe0: 'newDelegateKey cannot be 0',
  updateDelegateKeyCantOverwriteExistingMembers: 'cant overwrite existing members',
  canRageQuitProposalDoesNotExist: 'proposal does not exist',
  getMemberProposalVoteMemberDoesntExist: 'member doesn\'t exist',
  getMemberProposalVoteProposalDoesntExist: 'proposal doesn\'t exist',
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18
const _1e18Plus1 = _1e18.add(_1)
const _10e18 = new BN('10000000000000000000') // 10e18
const _10e18Plus1 = _10e18.add(_1)

const valueOr0 = (val) => val || 0

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
  'TOKEN_SUPPLY': 10000
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

  const initSummonerBalance = 100

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 100
  const standardTribute = 100

  let snapshotId

  const fundAndApproveToMoloch = async ({ to, from, value }) => {
    await tokenAlpha.transfer(to, value, { from: creator })
    await tokenAlpha.approve(moloch.address, value, { from: to })
  }

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY)
    tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY)

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
      details: 'all hail moloch',
      flags: [false, false, false, false, false, false] // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: 50,
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

      const summonerData = await moloch.members(summoner)
      assert.equal(summonerData.delegateKey, summoner) // delegateKey matches
      assert.equal(summonerData.shares, 1)
      assert.equal(summonerData.exists, true)
      assert.equal(summonerData.highestIndexYesVote, 0)

      const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(summoner)
      assert.equal(summonerAddressByDelegateKey, summoner)

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
      assert.equal(firstWhitelistedToken, depositToken.address)
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
        summoner,
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
      await fundAndApproveToMoloch({
        to: applicant1,
        from: creator,
        value: proposal1.tributeOffered
      })
    })

    it('happy case', async () => {
      const countBefore = await moloch.proposalCount()

      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: proposal1.tributeOffered
      })

      const proposer = proposal1.applicant
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

      await verifyProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      // tribute been moved to the DAO
      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      // DAO is holding the tribute
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: proposal1.tributeOffered
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
      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: proposal1.applicant,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!'
      }

      // no tribute value is required
      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      await moloch.submitWhitelistProposal(
        whitelistProposal.tributeToken,
        whitelistProposal.details,
        { from: proposer }
      )

      await verifyProposal({
        proposal: whitelistProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // whitelist flag set to true after proposal
      })

      // no tribute value is required
      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      // no tribute value is required so moloch will be empty
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: 0
      })
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
      const proposer = proposal1.applicant
      const guildKickProposal = {
        applicant: summoner,
        proposer: proposer,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: zeroAddress,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'kick me!'
      }

      // no tribute value is required
      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      await moloch.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: proposer }
      )

      await verifyProposal({
        proposal: guildKickProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, true] // guild kick flag set to true after proposal
      })

      // no tribute value is required
      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      // no tribute value is required so moloch will be empty
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: 0
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
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // ensure summoner has balance
      await verifyBalance({
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT
      })

      // moloch has approval to move the funds
      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: deploymentConfig.PROPOSAL_DEPOSIT
      })
    })

    it('happy path - sponsor add token to whitelist', async () => {
      // whitelist newToken
      const newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)
      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: proposal1.applicant,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!'
      }

      await moloch.submitWhitelistProposal(
        whitelistProposal.tributeToken,
        whitelistProposal.details,
        { from: proposer }
      )

      // ensure period and queue length at zero
      await verifyProposal({
        proposal: whitelistProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // not sponsored yet...
      })

      // sponsorship sent by a delegate
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        proposal: whitelistProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1, // sponsoring moves the period on
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1 // we have one in the queue post sponsorship
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false] // sponsored flag set
      })

      // deposit has moved
      await verifyBalance({
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      // moloch has the deposit
      await verifyBalance({
        token: depositToken,
        address: moloch.address,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: 0
      })
    })

    it('happy path - sponsor guildKick proposal', async () => {
      const proposer = proposal1.applicant
      const guildKickProposal = {
        applicant: summoner,
        proposer: proposer,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: zeroAddress,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'kick me!'
      }

      await moloch.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: proposer }
      )

      // ensure period and queue length at zero
      await verifyProposal({
        proposal: guildKickProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, true] // not sponsored yet...
      })

      let proposedToKick = await moloch.proposedToKick(summoner)
      assert.equal(proposedToKick, false)

      // sponsor send by a delegate
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      proposedToKick = await moloch.proposedToKick(summoner)
      assert.equal(proposedToKick, true)

      await verifyProposal({
        proposal: guildKickProposal,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1, // sponsoring moves the period on
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1 // we have one in the queue post sponsorship
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, true] // sponsored flag set
      })

      // deposit has moved
      await verifyBalance({
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      // moloch has the deposit
      await verifyBalance({
        token: depositToken,
        address: moloch.address,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: 0
      })
    })

    it('happy path - sponsor proposal', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await verifyBalance({
        token: depositToken,
        address: proposal1.applicant,
        expectedBalance: proposal1.tributeOffered
      })

      await verifyAllowance({
        token: depositToken,
        owner: proposal1.applicant,
        spender: moloch.address,
        expectedAllowance: proposal1.tributeOffered
      })

      const proposer = proposal1.applicant
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested, // 100
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      await verifyBalance({
        token: depositToken,
        address: proposal1.applicant,
        expectedBalance: 0
      })

      // ensure period and queue length at zero
      await verifyProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      // sponsor send by a delegate
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // ensure period and queue length at zero
      await verifyProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // deposit has moved
      await verifyBalance({
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      // moloch has the deposit
      await verifyBalance({
        token: depositToken,
        address: moloch.address,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered
      })

      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: 0
      })
    })

    it('failure - proposal has already been sponsored', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

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
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // add another deposit to re-sponsor
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
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

      await moloch.cancelProposal(firstProposalIndex, { from: proposer })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
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

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      let proposedToWhitelist = await moloch.proposedToWhitelist(newToken.address)
      assert.equal(proposedToWhitelist, true)

      // duplicate proposal
      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposer }
      )

      // add another deposit to sponsor proposal 1
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
        .should.be.rejectedWith(revertMesages.sponsorProposalAlreadyProposedToWhitelist)
    })

    it('failure - sponsor kick proposal already proposed', async () => {
      const proposer = proposal1.applicant

      await moloch.submitGuildKickProposal(
        summoner,
        'kick',
        { from: proposer }
      )

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      let proposedToKick = await moloch.proposedToKick(summoner)
      assert.equal(proposedToKick, true)

      // duplicate proposal
      await moloch.submitGuildKickProposal(
        summoner,
        'kick',
        { from: proposer }
      )

      // add another deposit to sponsor proposal 1
      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
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

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
        .should.be.rejectedWith(revertMesages.sponsorProposalTooManySharesRequested)
    })

    it('require fail - insufficient deposit token', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: summoner })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.sponsorProposal(invalidPropsalIndex, { from: summoner })
        .should.be.rejectedWith(SolRevert)
    })

    it('require fail - sponsor non-existant proposal fails', async () => {
      await moloch.sponsorProposal(invalidPropsalIndex, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitProposalProposalMustHaveBeenProposed)
    })
  })

  describe('submitVote', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      const proposer = proposal1.applicant
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

      await verifyProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: yes,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, no, { from: summoner })

      await verifySubmitVote({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: no,
        expectedMaxSharesAtYesVote: 0
      })
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitVoteProposalDoesNotExist)
    })

    it('require fail - vote must be less than 3', async () => {
      await moloch.submitVote(firstProposalIndex, 3, { from: summoner })
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
        .submitVote(secondProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith('proposal has not been sponsored')
    })

    it('require fail - voting period has not started', async () => {
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasNotStarted)
    })

    describe('voting period boundary', () => {
      it('require fail - voting period has expired', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS + 1)
        await moloch
          .submitVote(firstProposalIndex, yes, { from: summoner })
          .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasExpired)
      })

      it('success - vote 1 period before voting period expires', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

        await verifySubmitVote({
          proposal: proposal1,
          proposalIndex: firstProposalIndex,
          memberAddress: summoner,
          expectedVote: yes,
          expectedMaxSharesAtYesVote: 1
        })
      })
    })

    it('require fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch
        .submitVote(firstProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitVoteMemberHasAlreadyVoted)
    })

    it('require fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch
        .submitVote(firstProposalIndex, 0, { from: summoner })
        .should.be.rejectedWith(revertMesages.submitVoteVoteMustBeEitherYesOrNo)
    })

    it('modifier - delegate', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: creator })
        .should.be.rejectedWith('not a delegate')
    })

    it('emits SubmitVote', async () => {
      await moveForwardPeriods(1)
      const emittedLogs = await moloch.submitVote(0, 1, { from: summoner })

      const { logs } = emittedLogs
      const log = logs[0]
      const { proposalIndex, delegateKey, memberAddress, uintVote } = log.args
      assert.equal(log.event, 'SubmitVote')
      assert.equal(proposalIndex, 0)
      assert.equal(delegateKey, summoner)
      assert.equal(memberAddress, summoner)
      assert.equal(uintVote, 1)
    })

    describe('submitVote modifying member.highestIndexYesVote', () => {
      beforeEach(async () => {
        await fundAndApproveToMoloch({
          to: proposal2.applicant,
          from: creator,
          value: proposal2.tributeOffered
        })

        const proposer = proposal2.applicant
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

        await verifyProposal({
          proposal: proposal2,
          proposalIndex: secondProposalIndex,
          proposer: proposer,
          sponsor: zeroAddress,
          expectedStartingPeriod: 0,
          expectedProposalCount: 2,
          expectedProposalQueueLength: 1
        })

        await verifyFlags({
          proposalIndex: secondProposalIndex,
          expectedFlags: [false, false, false, false, false, false]
        })

        await fundAndApproveToMoloch({
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        await verifyProposal({
          proposal: proposal2,
          proposalIndex: secondProposalIndex,
          proposer: proposer,
          sponsor: summoner,
          expectedStartingPeriod: 2,
          expectedProposalCount: 2,
          expectedProposalQueueLength: 2
        })

        await verifyFlags({
          proposalIndex: secondProposalIndex,
          expectedFlags: [true, false, false, false, false, false]
        })

        // moloch has the deposit
        // (100 (proposal 1) + 10 (sponsorship)) + (50 (proposal 2) + 10 (sponsorship)) = 170
        await verifyBalance({
          token: depositToken,
          address: moloch.address,
          expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT + proposal2.tributeOffered
        })
      })

      it('require fail - voting period not starting yet', async () => {
        await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
          .should.be.rejectedWith(revertMesages.submitVoteVotingPeriodHasNotStarted)
      })

      it('happy case - yes vote, highestIndexYesVote is updated', async () => {
        await moveForwardPeriods(2)
        await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
        await verifySubmitVote({
          proposal: proposal2,
          proposalIndex: secondProposalIndex,
          memberAddress: summoner,
          expectedVote: yes,
          expectedMaxSharesAtYesVote: 1
        })

        const memberData = await moloch.members(summoner)
        assert.equal(memberData.highestIndexYesVote, secondProposalIndex, 'highestIndexYesVote does not match')
      })

      it('happy case - no vote, highestIndexYesVote not updated', async () => {

        let memberData = await moloch.members(summoner)
        assert.equal(memberData.highestIndexYesVote, 0, 'highestIndexYesVote does not match')

        await moveForwardPeriods(2)
        await moloch.submitVote(secondProposalIndex, no, { from: summoner })
        await verifySubmitVote({
          proposal: proposal2,
          proposalIndex: secondProposalIndex,
          memberAddress: summoner,
          expectedVote: no,
          expectedMaxSharesAtYesVote: 0
        })

        // no change
        memberData = await moloch.members(summoner)
        assert.equal(memberData.highestIndexYesVote, 0, 'highestIndexYesVote does not match')
      })
    })
  })

  describe.only('processProposal', () => {
    let proposer, applicant
    beforeEach(async () => {})

    it('happy path - pass - yes wins', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

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

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance,
        processor: processor,
        expectedProcessorBalance: 0
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + 1, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: 1 // FIXME - review this number?
      })

      await verifyFlags({
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
        expectedSponsorBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      await verifyMember({
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.tributeOffered,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })
    })

    it('happy path - fail - no wins', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

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

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, no, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyMember({
        member: proposal1.applicant,
        expectedShares: 0,
        expectedExists: false
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance,
        processor: processor,
        expectedProcessorBalance: 0
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 0,
        expectedNoVotes: 1,
        expectedTotalShares: 1, // just the summoner still in
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: 0 // FIXME - review this number?
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant, // applicant gets tribute returned
        expectedApplicantBalance: proposal1.tributeOffered,
        sponsor: summoner, // sponsor - deposit returned
        expectedSponsorBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
        processor: processor, // processor - gets reward
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      await verifyMember({
        member: proposal1.applicant,
        expectedDelegateKey: zeroAddress,
        expectedShares: 0,
        expectedExists: false
      })
    })

    it('happy path  - shares added to existing member', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // double the amount is required
      })

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

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // double the amount is required
      })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await verifyFlags({
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(2)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifyMember({
        member: proposal1.applicant,
        expectedShares: 0,
        expectedExists: false
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: (deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered) * 2,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance,
        processor: processor,
        expectedProcessorBalance: 0
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      let newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, 0)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, proposal1.sharesRequested)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, proposal1.sharesRequested + proposal1.sharesRequested)

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyFlags({
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyMember({
        member: proposal1.applicant,
        expectedShares: proposal1.sharesRequested + proposal1.sharesRequested, // two lots of shares
        expectedExists: true,
        expectedDelegateKey: proposal1.applicant,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered * 2,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance + ((deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2),
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD * 2
      })
    })

    it.only('happy path  - applicant is used as a delegate key so delegate key is reset', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant

      await moloch.updateDelegateKey(proposer, { from: summoner })

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

      await fundAndApproveToMoloch({
        to: proposer,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: proposer })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: proposer })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      // using a delegate
      let summonerMemberData = await moloch.members(summoner)
      assert.equal(summonerMemberData.delegateKey, proposer)

      let summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(proposer)
      assert.equal(summonerAddressByDelegateKey, summoner)

      await verifyMember({
        member: summoner,
        expectedDelegateKey: proposer,
        expectedShares: 1, // summoner already has one share
        expectedExists: true,
        expectedMemberAddressByDelegateKey: summoner
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT,
        guildBank: guildBank.address,
        expectedGuildBankBalance: 0,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance,
        processor: processor,
        expectedProcessorBalance: 0
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        proposal: proposal1,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + 1, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: 1 // FIXME - review this number?
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      // delegate reset to summoner
      summonerMemberData = await moloch.members(summoner)
      assert.equal(summonerMemberData.delegateKey, summoner)

      summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(summoner)
      assert.equal(summonerAddressByDelegateKey, summoner)

      await verifyFlags({
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
        expectedSponsorBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      // delegate reset
      await verifyMember({
        member: summoner,
        expectedDelegateKey: summoner,
        expectedShares: 1, // summoner already has one share
        expectedExists: true,
        expectedMemberAddressByDelegateKey: summoner
      })

      // applicant has approved shares
      await verifyMember({
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.tributeOffered,
        expectedExists: true,
        expectedMemberAddressByDelegateKey: proposal1.applicant
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal(whitelistProposal, 0, proposer, summoner, processor, {
        initialTotalSharesRequested: 0,
        initialTotalShares: 1,
        initialMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        initialSponsorBalance: initSummonerBalance,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })

      const newApprovedToken = await moloch.approvedTokens(2)
      assert.equal(newApprovedToken, newToken.address)
    })

    it('happy path - kick member', async () => {
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      let member = await moloch.members(applicant)
      assert.equal(+member.shares, proposal1.sharesRequested)

      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: applicant })

      member = await moloch.members(applicant)
      assert.equal(+member.shares, 0) // all shares gone!

      // TODO verify value returned
      //
      // await verifyProcessProposal(proposal1, 0, proposer, summoner, processor, {
      //   initialTotalSharesRequested: 0,
      //   initialTotalShares: 1,
      //   initialMolochBalance: proposalDeposit,
      //   initialSponsorBalance: initSummonerBalance,
      //   expectedYesVotes: 1,
      //   expectedMaxSharesAtYesVote: 1
      // })
    })

    it('edge case - emergency processing', async () => {
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS)

      let newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, 0)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      // no shares given
      newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, 0)

      // flags and proposal data
      const proposalFlags = await moloch.getProposalFlags(firstProposalIndex)
      assert.equal(proposalFlags[0], true, 'sponsored flag incorrect')
      assert.equal(proposalFlags[1], true, 'processed flag incorrect')
      assert.equal(proposalFlags[2], false, 'didPass flag incorrect')
      assert.equal(proposalFlags[3], false, 'cancelled flag incorrect')
    })

    it('edge case - paymentRequested more than funds in the bank', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      proposal1.paymentRequested = 101
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      let newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, 0)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      // no shares given
      newMemberData = await moloch.members(applicant)
      assert.equal(newMemberData.shares, 0)

      // flags and proposal data
      const proposalFlags = await moloch.getProposalFlags(firstProposalIndex)
      assert.equal(proposalFlags[0], true, 'sponsored flag incorrect')
      assert.equal(proposalFlags[1], true, 'processed flag incorrect')
      assert.equal(proposalFlags[2], false, 'didPass flag incorrect')
      assert.equal(proposalFlags[3], false, 'cancelled flag incorrect')
    })

    it('require fail  - proposal does not exist', async () => {
      await moloch.processProposal(invalidPropsalIndex, { from: processor })
        .should.be.rejectedWith(revertMesages.processProposalProposalDoesNotExist)
    })

    it('require fail  - proposal is not ready to be processed', async () => {
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moloch.processProposal(firstProposalIndex, { from: processor })
        .should.be.rejectedWith(revertMesages.processProposalProposalIsNotReadyToBeProcessed)
    })

    it('require fail  - proposal has already been processed', async () => {
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await moloch.processProposal(firstProposalIndex, { from: processor })
        .should.be.rejectedWith(revertMesages.processProposalProposalHasAlreadyBeenProcessed)
    })

    it('require fail  - previous proposal must be processed', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered * 2, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered * 2, { from: proposal1.applicant })

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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT * 2, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT * 2, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(2)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })
        .should.be.rejectedWith(revertMesages.processProposalPreviousProposalMustBeProcessed)
    })
  })

  describe('rageQuit', () => {
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await verifySubmitVote(proposal1, firstProposalIndex, summoner, 1, {
        expectedMaxSharesAtYesVote: 1
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })
    })

    describe('fails when', () => {
      it('not a member', async () => {
        await moloch.ragequit(1, { from: nonMemberAccount })
          .should.be.rejectedWith(revertMesages.molochNotAMember)
      })

      it('requesting more shares than you own', async () => {
        await moloch.ragequit(proposal1.sharesRequested + 1, { from: proposal1.applicant })
          .should.be.rejectedWith(revertMesages.molochRageQuitInsufficientShares)
      })

      it('guild bank fails to transfer tokens', async () => {
        // TODO
      })

      describe('when a proposal is in flight', () => {
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

          await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
          await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

          await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

          await moveForwardPeriods(1)
          await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
        })

        it('unable to quit when proposal in flight', async () => {
          await moloch.ragequit(secondProposalIndex, { from: summoner })
            .should.be.rejectedWith('cant ragequit until highest index proposal member voted YES on is processed')
        })
      })
    })

    describe('all shares', () => {
      let emittedLogs

      beforeEach(async () => {
        const { logs } = await moloch.ragequit(proposal1.sharesRequested, { from: proposal1.applicant })
        emittedLogs = logs
      })

      it('member shares reduced', async () => {
        const newMemberData = await moloch.members(proposal1.applicant)
        assert.equal(newMemberData.shares, 0)
      })

      it('total shares reduced', async () => {
        const totalShares = await moloch.totalShares()
        assert.equal(totalShares, 1)
      })

      it('emits event', async () => {
        const log = emittedLogs[0]
        const { memberAddress, sharesToBurn } = log.args
        assert.equal(log.event, 'Ragequit')
        assert.equal(memberAddress, proposal1.applicant)
        assert.equal(sharesToBurn, proposal1.sharesRequested)
      })
    })

    describe('partial shares', () => {
      let emittedLogs

      let partialRageQuitShares

      beforeEach(async () => {
        partialRageQuitShares = 20
        const { logs } = await moloch.ragequit(partialRageQuitShares, { from: proposal1.applicant })
        emittedLogs = logs
      })

      it('member shares reduced', async () => {
        const newMemberData = await moloch.members(proposal1.applicant)
        assert.equal(newMemberData.shares, proposal1.sharesRequested - partialRageQuitShares)
      })

      it('total shares reduced', async () => {
        const totalShares = await moloch.totalShares()
        // your remaining shares plus the summoners 1 share
        assert.equal(totalShares, (proposal1.sharesRequested - partialRageQuitShares) + 1)
      })

      it('emits event', async () => {
        const log = emittedLogs[0]
        const { memberAddress, sharesToBurn } = log.args
        assert.equal(log.event, 'Ragequit')
        assert.equal(memberAddress, proposal1.applicant)
        assert.equal(sharesToBurn, partialRageQuitShares)
      })
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

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })

      proposalFlags = await moloch.getProposalFlags(0)
      assert.equal(proposalFlags[3], true) // cancelled

      // tribute offered has been returned
      let proposerBalanceAfterCancel = await tokenAlpha.balanceOf(proposal1.applicant)
      assert.equal(+proposerBalanceAfterCancel, +proposerBalance + proposal.tributeOffered)
    })

    it('failure - already sponsored', async () => {
      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })
        .should.be.rejectedWith(revertMesages.cancelProposalProposalHasAlreadyBeenSponsored)
    })

    it('failure - only the proposer can cancel', async () => {
      await moloch.cancelProposal(firstProposalIndex, { from: creator })
        .should.be.rejectedWith(revertMesages.cancelProposalOnlyTheProposerCanCancel)
    })

    it('emits event', async () => {
      const emittedLogs = await moloch.cancelProposal(0, { from: proposal1.applicant })
      const { logs } = emittedLogs
      const log = logs[0]
      const { proposalIndex, applicantAddress } = log.args
      assert.equal(log.event, 'CancelProposal')
      assert.equal(proposalIndex, firstProposalIndex)
      assert.equal(applicantAddress, proposal1.applicant)
    })
  })

  describe('updateDelegateKey', () => {
    it('happy case', async () => {
      await moloch.updateDelegateKey(processor, { from: summoner })

      const member = await moloch.members(summoner)
      assert.equal(member.delegateKey, processor)
    })

    it('failure - can not be zero address', async () => {
      await moloch.updateDelegateKey(zeroAddress, { from: summoner })
        .should.be.rejectedWith(revertMesages.updateDelegateKeyNewDelegateKeyCannotBe0)
    })

    it('failure - cant overwrite existing members', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await moloch.updateDelegateKey(applicant, { from: summoner })
        .should.be.rejectedWith(revertMesages.updateDelegateKeyCantOverwriteExistingMembers)
    })
  })

  describe('canRageQuit', () => {
    it('happy case', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      let canRageQuit = await moloch.canRagequit(firstProposalIndex)
      assert.equal(canRageQuit, false)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      canRageQuit = await moloch.canRagequit(firstProposalIndex)
      assert.equal(canRageQuit, true)
    })

    it('failure - proposal does not exist', async () => {
      await moloch.canRagequit(invalidPropsalIndex)
        .should.be.rejectedWith(revertMesages.canRageQuitProposalDoesNotExist)
    })
  })

  describe('getMemberProposalVote', () => {
    it('happy case', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
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

      await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
      await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

      // sponsor
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // vote
      let memberVote = await moloch.getMemberProposalVote(summoner, firstProposalIndex)
      assert.equal(memberVote, 0)

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      memberVote = await moloch.getMemberProposalVote(summoner, firstProposalIndex)
      assert.equal(memberVote, 1)
    })

    it('failure - member does not exist', async () => {
      await moloch.getMemberProposalVote(zeroAddress, firstProposalIndex)
        .should.be.rejectedWith(revertMesages.getMemberProposalVoteMemberDoesntExist)
    })

    it('failure - proposal does not exist', async () => {
      await moloch.getMemberProposalVote(summoner, invalidPropsalIndex)
        .should.be.rejectedWith(revertMesages.getMemberProposalVoteProposalDoesntExist)
    })
  })

  // VERIFY PROPOSAL
  const verifyProposal = async (
    {
      proposal,
      proposalIndex,
      proposer,
      sponsor = zeroAddress,
      expectedStartingPeriod = 0,
      expectedProposalCount = 0,
      expectedProposalQueueLength = 0,
    }
  ) => {
    const proposalData = await moloch.proposals(proposalIndex)

    const proposalCount = await moloch.proposalCount()
    assert.equal(+proposalCount, expectedProposalCount)

    const proposalQueueLength = await moloch.getProposalQueueLength()
    assert.equal(+proposalQueueLength, expectedProposalQueueLength)

    assert.equal(proposalData.applicant, proposal.applicant)
    assert.equal(proposalData.proposer, proposer, 'proposers does not match')
    assert.equal(proposalData.sponsor, sponsor, 'sponsor does not match')

    assert.equal(proposalData.sharesRequested, proposal.sharesRequested, 'sharesRequested does not match')

    assert.equal(proposalData.tributeOffered, proposal.tributeOffered, 'tributeOffered does not match')
    assert.equal(proposalData.tributeToken, proposal.tributeToken, 'tributeToken does not match')

    assert.equal(proposalData.paymentRequested, proposal.paymentRequested, 'paymentRequested does not match')
    assert.equal(proposalData.paymentToken, proposal.paymentToken, 'paymentToken does not match')

    assert.equal(+proposalData.startingPeriod, expectedStartingPeriod, 'startingPeriod does not match')
    assert.equal(proposalData.yesVotes, 0, 'yesVotes does not match')
    assert.equal(proposalData.noVotes, 0, 'noVotes does not match')
    assert.equal(proposalData.details, proposal.details, 'details does not match')
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0, 'maxTotalSharesAtYesVote invalid')
  }

  const verifyFlags = async ({ proposalIndex, expectedFlags }) => {
    const actualFlags = await moloch.getProposalFlags(proposalIndex)

    // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    assert.equal(actualFlags[0], expectedFlags[0], 'sponsored flag incorrect')
    assert.equal(actualFlags[1], expectedFlags[1], 'processed flag incorrect')
    assert.equal(actualFlags[2], expectedFlags[2], 'didPass flag incorrect')
    assert.equal(actualFlags[3], expectedFlags[3], 'cancelled flag incorrect')
    assert.equal(actualFlags[4], expectedFlags[4], 'whitelist flag incorrect')
    assert.equal(actualFlags[5], expectedFlags[5], 'guildkick flag incorrect')
  }

  const verifyBalance = async ({ token, address, expectedBalance }) => {
    const balance = await token.balanceOf(address)
    assert.equal(+balance, expectedBalance, `token balance incorrect for ${token.address} with ${address}`)
  }

  const verifyBalances = async (
    {
      token,
      moloch,
      expectedMolochBalance,
      guildBank,
      expectedGuildBankBalance,
      applicant,
      expectedApplicantBalance,
      sponsor,
      expectedSponsorBalance,
      processor,
      expectedProcessorBalance
    }
  ) => {
    const molochBalance = await token.balanceOf(moloch)
    assert.equal(+molochBalance, expectedMolochBalance, `moloch token balance incorrect for ${token.address} with ${moloch}`)

    const guildBankBalance = await token.balanceOf(guildBank)
    assert.equal(+guildBankBalance, expectedGuildBankBalance, `Guild Bank token balance incorrect for ${token.address} with ${guildBank}`)

    const applicantBalance = await token.balanceOf(applicant)
    assert.equal(+applicantBalance, expectedApplicantBalance, `Applicant token balance incorrect for ${token.address} with ${applicant}`)

    const sponsorBalance = await token.balanceOf(sponsor)
    assert.equal(+sponsorBalance, expectedSponsorBalance, `Sponsor token balance incorrect for ${token.address} with ${sponsor}`)

    const processorBalance = await token.balanceOf(processor)
    assert.equal(+processorBalance, expectedProcessorBalance, `Processor token balance incorrect for ${token.address} with ${processor}`)
  }

  const verifyAllowance = async ({ token, owner, spender, expectedAllowance }) => {
    const allowance = await token.allowance(owner, spender)
    assert.equal(+allowance, expectedAllowance, `allowance incorrect for ${token.address} owner ${owner} spender ${spender}`)
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (
    {
      proposal,
      proposalIndex,
      memberAddress,
      expectedVote,
      expectedMaxSharesAtYesVote = 0,
      initialYesVotes = 0,
      initialNoVotes = 0
    }
  ) => {
    const proposalData = await moloch.proposals(proposalIndex)
    assert.equal(+proposalData.yesVotes, initialYesVotes + (expectedVote === 1 ? 1 : 0))
    assert.equal(+proposalData.noVotes, initialNoVotes + (expectedVote === 1 ? 0 : 1))
    assert.equal(+proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)

    const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
    assert.equal(+memberVote, expectedVote)
  }

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (
    {
      proposal,
      proposalIndex,
      expectedYesVotes = 0,
      expectedNoVotes = 0,
      expectedTotalShares = 0,
      expectedFinalTotalSharesRequested = 0,
      expectedMaxSharesAtYesVote = 0,
    }
  ) => {
    // flags and proposal data
    const proposalData = await moloch.proposals(proposalIndex)

    assert.equal(+proposalData.yesVotes, expectedYesVotes, 'proposal yes votes incorrect')
    assert.equal(+proposalData.noVotes, expectedNoVotes, 'proposal no votes incorrect')
    assert.equal(+proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote, 'total shares at yes vote incorrect')

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(+totalSharesRequested, expectedFinalTotalSharesRequested, 'total shares requested incorrect')

    const totalShares = await moloch.totalShares()
    assert.equal(+totalShares, expectedTotalShares, 'total shares incorrect')
  }

  const verifyMember = async (
    {
      member,
      expectedDelegateKey = zeroAddress,
      expectedShares = 0,
      expectedExists = true,
      expectedHighestIndexYesVote = 0,
      expectedMemberAddressByDelegateKey = zeroAddress
    }
  ) => {
    const newMemberData = await moloch.members(member)
    assert.equal(newMemberData.delegateKey, expectedDelegateKey, 'delegate key incorrect')
    assert.equal(+newMemberData.shares, expectedShares, 'expected shares incorrect')
    assert.equal(newMemberData.exists, expectedExists, 'exists incorrect')
    assert.equal(newMemberData.highestIndexYesVote, expectedHighestIndexYesVote, 'highest index yes vote incorrect')

    const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(expectedDelegateKey)
    assert.equal(newMemberAddressByDelegateKey, expectedMemberAddressByDelegateKey, 'member address by delegate key incorrect')
  }
})
