const { artifacts, ethereum, web3 } = require('hardhat')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const {
  verifyBalance,
  verifyInternalBalance,
  verifyInternalBalances,
  verifyAllowance,
  verifyProposal,
  verifyFlags,
  verifyBalances,
  verifySubmitVote,
  verifyProcessProposal,
  verifyMember
} = require('./test-utils')

const Moloch = artifacts.require('./Moloch')
const Token = artifacts.require('./Token')
const Submitter = artifacts.require('./Submitter') // used to test submit proposal return values

const revertMessages = {
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorPeriodDurationCannotBe0: '_periodDuration cannot be 0',
  molochConstructorVotingPeriodLengthCannotBe0: '_votingPeriodLength cannot be 0',
  molochConstructorVotingPeriodLengthExceedsLimit: '_votingPeriodLength exceeds limit',
  molochConstructorGracePeriodLengthExceedsLimit: '_gracePeriodLength exceeds limit',
  molochConstructorDilutionBoundCannotBe0: '_dilutionBound cannot be 0',
  molochConstructorDilutionBoundExceedsLimit: '_dilutionBound exceeds limit',
  molochConstructorNeedAtLeastOneApprovedToken: 'need at least one approved token',
  molochConstructorTooManyTokens: 'too many tokens',
  molochConstructorDepositCannotBeSmallerThanProcessingReward: '_proposalDeposit cannot be smaller than _processingReward',
  molochConstructorApprovedTokenCannotBe0: '_approvedToken cannot be 0',
  molochConstructorDuplicateApprovedToken: 'revert duplicate approved token',
  submitProposalTooManySharesRequested: 'too many shares requested',
  submitProposalProposalMustHaveBeenProposed: 'proposal must have been proposed',
  submitProposalTributeTokenIsNotWhitelisted: 'tributeToken is not whitelisted',
  submitProposalPaymetTokenIsNotWhitelisted: 'payment is not whitelisted',
  submitProposalApplicantCannotBe0: 'revert applicant cannot be 0',
  submitProposalApplicantCannotBeReserved: 'applicant address cannot be reserved',
  submitProposalApplicantIsJailed: 'proposal applicant must not be jailed',
  submitWhitelistProposalMustProvideTokenAddress: 'must provide token address',
  submitWhitelistProposalAlreadyHaveWhitelistedToken: 'cannot already have whitelisted the token',
  submitGuildKickProposalMemberMustHaveAtLeastOneShare: 'member must have at least one share or one loot',
  submitGuildKickProposalMemberMustNotBeJailed: 'member must not already be jailed',
  sponsorProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  sponsorProposalProposalHasAlreadyBeenCancelled: 'proposal has already been cancelled',
  sponsorProposalAlreadyProposedToWhitelist: 'already proposed to whitelist',
  sponsorProposalAlreadyWhitelisted: 'cannot already have whitelisted the token',
  sponsorProposalAlreadyProposedToKick: 'already proposed to kick',
  sponsorProposalApplicantIsJailed: 'proposal applicant must not be jailed',
  submitVoteProposalDoesNotExist: 'proposal does not exist',
  submitVoteMustBeLessThan3: 'must be less than 3',
  submitVoteVotingPeriodHasNotStarted: 'voting period has not started',
  submitVoteVotingPeriodHasExpired: 'voting period has expired',
  submitVoteMemberHasAlreadyVoted: 'member has already voted',
  submitVoteVoteMustBeEitherYesOrNo: 'vote must be either Yes or No',
  cancelProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  cancelProposalSolelyTheProposerCanCancel: 'solely the proposer can cancel',
  processProposalProposalDoesNotExist: 'proposal does not exist',
  processProposalProposalIsNotReadyToBeProcessed: 'proposal is not ready to be processed',
  processProposalProposalHasAlreadyBeenProcessed: 'proposal has already been processed',
  processProposalPreviousProposalMustBeProcessed: 'previous proposal must be processed',
  processProposalMustBeAStandardProposal: 'must be a standard proposal',
  processWhitelistProposalMustBeAWhitelistProposal: 'must be a whitelist proposal',
  processGuildKickProposalMustBeAGuildKickProposal: 'must be a guild kick proposal',
  notAMember: 'not a member',
  notAShareholder: 'not a shareholder',
  rageQuitInsufficientShares: 'insufficient shares',
  rageQuitInsufficientLoot: 'insufficient loot',
  rageQuitUntilHighestIndex: 'cannot ragequit until highest index proposal member voted YES on is processed',
  withdrawBalanceInsufficientBalance: 'insufficient balance',
  updateDelegateKeyNewDelegateKeyCannotBe0: 'newDelegateKey cannot be 0',
  updateDelegateKeyCantOverwriteExistingMembers: 'cannot overwrite existing members',
  updateDelegateKeyCantOverwriteExistingDelegateKeys: 'cannot overwrite existing delegate keys',
  canRageQuitProposalDoesNotExist: 'proposal does not exist',
  ragekickMustBeInJail: 'member must be in jail',
  ragekickMustHaveSomeLoot: 'member must have some loot',
  ragekickPendingProposals: 'cannot ragequit until highest index proposal member voted YES on is processed',
  getMemberProposalVoteMemberDoesntExist: 'member does not exist',
  getMemberProposalVoteProposalDoesntExist: 'proposal does not exist',
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const GUILD  = '0x000000000000000000000000000000000000dead'
const ESCROW = '0x000000000000000000000000000000000000beef'
const TOTAL = '0x000000000000000000000000000000000000babe'
const MAX_TOKEN_WHITELIST_COUNT = new BN('10') // TODO: actual number to be determined

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18
const _1e18Plus1 = _1e18.add(_1)
const _1e18Minus1 = _1e18.sub(_1)

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

function addressArray(length) {
  // returns an array of distinct non-zero addresses
  let array = []
  for (let i = 1; i <= length; i++) {
    array.push('0x' + (new BN(i)).toString(16, 40))
  }
  return array
}

contract('Moloch', ([creator, summoner, applicant1, applicant2, processor, delegateKey, nonMemberAccount, ...otherAccounts]) => {
  let moloch, tokenAlpha, submitter
  let proposal1, proposal2, depositToken

  const initSummonerBalance = 100

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const thirdProposalIndex = 2
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 100
  const standardLootRequest = 73
  const standardTribute = 80
  const summonerShares = 1

  let snapshotId

  const fundAndApproveToMoloch = async ({ to, from, value }) => {
    await tokenAlpha.transfer(to, value, { from: from })
    await tokenAlpha.approve(moloch.address, value, { from: to })
  }

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY)

    moloch = await Moloch.new(
      summoner,
      [tokenAlpha.address],
      deploymentConfig.PERIOD_DURATION_IN_SECONDS,
      deploymentConfig.VOTING_DURATON_IN_PERIODS,
      deploymentConfig.GRACE_DURATON_IN_PERIODS,
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const depositTokenAddress = await moloch.depositToken()
    assert.equal(depositTokenAddress, tokenAlpha.address)

    submitter = await Submitter.new(moloch.address)

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
      details: 'all hail moloch'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: 50,
      lootRequested: 25,
      tributeOffered: 50,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch 2'
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

      const periodDuration = await moloch.periodDuration()
      assert.equal(+periodDuration, deploymentConfig.PERIOD_DURATION_IN_SECONDS)

      const votingPeriodLength = await moloch.votingPeriodLength()
      assert.equal(+votingPeriodLength, deploymentConfig.VOTING_DURATON_IN_PERIODS)

      const gracePeriodLength = await moloch.gracePeriodLength()
      assert.equal(+gracePeriodLength, deploymentConfig.GRACE_DURATON_IN_PERIODS)

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
      assert.equal(summonerData.shares, summonerShares)
      assert.equal(summonerData.exists, true)
      assert.equal(summonerData.highestIndexYesVote, 0)

      const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(summoner)
      assert.equal(summonerAddressByDelegateKey, summoner)

      const totalShares = await moloch.totalShares()
      assert.equal(+totalShares, summonerShares)

      const totalLoot = await moloch.totalLoot()
      assert.equal(+totalLoot, 0)

      const totalGuildBankTokens = await moloch.totalGuildBankTokens()
      assert.equal(+totalGuildBankTokens, 0)

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

      // first token should be the deposit token
      const firstWhitelistedToken = await moloch.approvedTokens(0)
      assert.equal(firstWhitelistedToken, depositToken.address)
      assert.equal(firstWhitelistedToken, tokenAlpha.address)
    })

    it('require fail - summoner can not be zero address', async () => {
      await Moloch.new(
        zeroAddress,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorSummonerCannotBe0)
    })

    it('require fail - period duration can not be zero', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        0,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorPeriodDurationCannotBe0)
    })

    it('require fail - voting period can not be zero', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        0,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorVotingPeriodLengthCannotBe0)
    })

    it('require fail - voting period exceeds limit', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        _1e18Plus1,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorVotingPeriodLengthExceedsLimit)

      // still works with 1 less
      const molochTemp = await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        _1e18,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      const totalShares = await molochTemp.totalShares()
      assert.equal(+totalShares, summonerShares)
    })

    it('require fail - grace period exceeds limit', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        _1e18Plus1,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorGracePeriodLengthExceedsLimit)

      // still works with 1 less
      const molochTemp = await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        _1e18,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      )

      const totalShares = await molochTemp.totalShares()
      assert.equal(+totalShares, summonerShares)
    })

    it('require fail - dilution bound can not be zero', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        0,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorDilutionBoundCannotBe0)
    })

    it('require fail - dilution bound exceeds limit', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        _1e18Plus1,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorDilutionBoundExceedsLimitExceedsLimit)

      // still works with 1 less
      const molochTemp = await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        _1e18,
        deploymentConfig.PROCESSING_REWARD
      )

      const totalShares = await molochTemp.totalShares()
      assert.equal(+totalShares, summonerShares)
    })

    it('require fail - need at least one approved token', async () => {
      await Moloch.new(
        summoner,
        [],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorNeedAtLeastOneApprovedToken)
    })

    it('require fail - too many tokens', async () => {
      await Moloch.new(
        summoner,
        addressArray(MAX_TOKEN_WHITELIST_COUNT + 1),
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorTooManyTokens)
    })

    it('require fail - deposit cannot be smaller than processing reward', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        _1e18,
        deploymentConfig.DILUTION_BOUND,
        _1e18Plus1
      ).should.be.rejectedWith(revertMessages.molochConstructorDepositCannotBeSmallerThanProcessingReward)
    })

    it('require fail - approved token cannot be zero', async () => {
      await Moloch.new(
        summoner,
        [zeroAddress],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorApprovedTokenCannotBe0)
    })

    it('require fail - duplicate approved token', async () => {
      await Moloch.new(
        summoner,
        [tokenAlpha.address, tokenAlpha.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ).should.be.rejectedWith(revertMessages.molochConstructorDuplicateApprovedToken)
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
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

      // ESCROW balance has been updated
      await verifyInternalBalance({
        moloch: moloch,
        token: tokenAlpha,
        user: ESCROW,
        expectedBalance: proposal1.tributeOffered
      })
    })

    it('require fail - insufficient tribute tokens', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: proposal1.applicant })

      // SafeMath reverts in ERC20.transferFrom
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
      ).should.be.rejectedWith(SolRevert)
    })

    it('require fail - tribute token is not whitelisted', async () => {
      proposal1.tributeToken = zeroAddress

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
      ).should.be.rejectedWith(revertMessages.submitProposalTributeTokenIsNotWhitelisted)
    })

    it('require fail - payment token is not whitelisted', async () => {
      proposal1.paymentToken = zeroAddress

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
      ).should.be.rejectedWith(revertMessages.submitProposalPaymetTokenIsNotWhitelisted)
    })

    it('require fail - applicant can not be zero', async () => {
      await moloch.submitProposal(
        zeroAddress,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalApplicantCannotBe0)
    })

    it('require fail - applicant address can not be reserved', async () => {
      await moloch.submitProposal(
        GUILD,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalApplicantCannotBeReserved)

      await moloch.submitProposal(
        ESCROW,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalApplicantCannotBeReserved)

      await moloch.submitProposal(
        TOTAL,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalApplicantCannotBeReserved)    
    })

    it('failure - too many shares requested', async () => {
      await moloch.submitProposal(
        proposal1.applicant,
        _1e18Plus1, // MAX_NUMBER_OF_SHARES_AND_LOOT
        0, // skip loot
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalTooManySharesRequested)

      const proposalCount = await moloch.proposalCount()
      assert.equal(proposalCount, 0)

      // should work with one less
      await moloch.submitProposal(
        proposal1.applicant,
        _1e18, // MAX_NUMBER_OF_SHARES_AND_LOOT - 1
        0, // skip loot
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      const proposalCountAfter = await moloch.proposalCount()
      assert.equal(proposalCountAfter, 1)
    })

    it('failure - too many shares (just loot) requested', async () => {
      await moloch.submitProposal(
        proposal1.applicant,
        0, // skip shares
        _1e18Plus1, // MAX_NUMBER_OF_SHARES_AND_LOOT
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalTooManySharesRequested)

      const proposalCount = await moloch.proposalCount()
      assert.equal(proposalCount, 0)

      // should work with one less
      await moloch.submitProposal(
        proposal1.applicant,
        0, // skip shares
        _1e18, // MAX_NUMBER_OF_SHARES_AND_LOOT - 1
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      const proposalCountAfter = await moloch.proposalCount()
      assert.equal(proposalCountAfter, 1)
    })

    it('failure - too many shares (& loot) requested', async () => {
      await moloch.submitProposal(
        proposal1.applicant,
        _1e18Plus1.sub(new BN('10')), // MAX_NUMBER_OF_SHARES_AND_LOOT - 10
        10, // 10 loot
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitProposalTooManySharesRequested)

      const proposalCount = await moloch.proposalCount()
      assert.equal(proposalCount, 0)

      // should work with one less
      await moloch.submitProposal(
        proposal1.applicant,
        _1e18.sub(new BN('10')), // MAX_NUMBER_OF_SHARES_AND_LOOT - 10
        10, // 10 loot
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      const proposalCountAfter = await moloch.proposalCount()
      assert.equal(proposalCountAfter, 1)
    })


    it('happy case - second submitted proposal returns incremented proposalId', async () => {
      const emittedLogs1 = await submitter.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      const proposalId1 = emittedLogs1.logs[0].args.proposalId
      assert.equal(proposalId1, 0)

      const emittedLogs2 = await submitter.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        0, // skip tribute
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      const proposalId2 = emittedLogs2.logs[0].args.proposalId
      assert.equal(+proposalId2.toString(), 1)
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
        newToken.address,
        'whitelist me!',
        { from: proposal1.applicant }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
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
      ).should.be.rejectedWith(revertMessages.submitWhitelistProposalMustProvideTokenAddress)
    })

    it('require fail - cannot add already have whitelisted the token', async () => {
      await moloch.submitWhitelistProposal(
        tokenAlpha.address,
        'whitelist me!',
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitWhitelistProposalAlreadyHaveWhitelistedToken)
    })

    it('happy case - second submitted proposal returns incremented proposalId', async () => {
      const emittedLogs1 = await submitter.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: summoner }
      )

      const proposalId1 = emittedLogs1.logs[0].args.proposalId
      assert.equal(proposalId1, 0)

      tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const emittedLogs2 = await submitter.submitWhitelistProposal(
        tokenBeta.address,
        'whitelist me!',
        { from: summoner }
      )

      const proposalId2 = emittedLogs2.logs[0].args.proposalId
      assert.equal(+proposalId2.toString(), 1)
    })
  })

  describe('submitGuildKickProposal', () => {
    let proposer, applicant
    beforeEach(async () => {
      // cant kick the summoner, so we have to vote in a new member
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
        proposal1.lootRequested,
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

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })
    })

    it('happy case', async () => {
      const proposer = proposal1.applicant
      const guildKickProposal = {
        applicant: proposal1.applicant,
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
        moloch: moloch,
        proposal: guildKickProposal,
        proposalId: secondProposalIndex,
        proposer: proposer,
        expectedProposalCount: 2,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
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
        expectedBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT
      })

      await verifyInternalBalance({
        moloch: moloch,
        token: depositToken,
        user: ESCROW,
        expectedBalance: 0
      })

      await verifyInternalBalance({
        moloch: moloch,
        token: depositToken,
        user: GUILD,
        expectedBalance: proposal1.tributeOffered
      })
    })

    it('require fail - member must have at least one share', async () => {
      await moloch.submitGuildKickProposal(
        zeroAddress,
        'kick me!',
        { from: proposal1.applicant }
      ).should.be.rejectedWith(revertMessages.submitGuildKickProposalMemberMustHaveAtLeastOneShare)
    })

    it('happy case - second submitted proposal returns incremented proposalId', async () => {
      const guildKickProposal = {
        applicant: proposal1.applicant,
        proposer: summoner,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: zeroAddress,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'kick me!'
      }

      const emittedLogs1 = await submitter.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: summoner }
      )

      const proposalId1 = emittedLogs1.logs[0].args.proposalId
      assert.equal(proposalId1, 1) // 0th proposal is for new membership

      const emittedLogs2 = await submitter.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: summoner }
      )

      const proposalId2 = emittedLogs2.logs[0].args.proposalId
      assert.equal(+proposalId2.toString(), 2)
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
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // not sponsored yet...
      })

      // sponsorship sent by a delegate
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1, // sponsoring moves the period on
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1 // we have one in the queue post sponsorship
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false] // sponsored flag set
      })

      // deposit has moved
      await verifyBalance({
        moloch: moloch,
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      // moloch has the deposit
      await verifyBalance({
        moloch: moloch,
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

    describe('with a second member besides the summoner', () => {
      let proposer, applicant
      // summoner can not be kicked so we have to vote in a second member
      beforeEach(async () => {
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
          proposal1.lootRequested,
          proposal1.tributeOffered,
          proposal1.tributeToken,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details,
          { from: proposer }
        )

        await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
        await moveForwardPeriods(1)
        await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
        await moloch.processProposal(firstProposalIndex, { from: processor })

        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested,
          expectedLoot: proposal1.lootRequested,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        // need more deposit since we used it on the membership proposal
        await fundAndApproveToMoloch({
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })
      })

      it('happy path - sponsor guildKick proposal', async () => {
        const proposer = proposal1.applicant
        const guildKickProposal = {
          applicant: proposal1.applicant,
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
          moloch: moloch,
          proposal: guildKickProposal,
          proposalId: secondProposalIndex,
          proposer: proposer,
          sponsor: zeroAddress,
          expectedStartingPeriod: 0,
          expectedProposalCount: 2,
          expectedProposalQueueLength: 1
        })

        await verifyFlags({
          moloch: moloch,
          proposalId: secondProposalIndex,
          expectedFlags: [false, false, false, false, false, true] // not sponsored yet...
        })

        let proposedToKick = await moloch.proposedToKick(proposal1.applicant)
        assert.equal(proposedToKick, false)

        // sponsor send by a delegate
        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        proposedToKick = await moloch.proposedToKick(proposal1.applicant)
        assert.equal(proposedToKick, true)

        await verifyProposal({
          moloch: moloch,
          proposal: guildKickProposal,
          proposalId: secondProposalIndex,
          proposer: proposer,
          sponsor: summoner,
          expectedStartingPeriod: 72, // sponsoring moves the period on
          expectedProposalCount: 2,
          expectedProposalQueueLength: 2 // we have one in the queue post sponsorship
        })

        await verifyFlags({
          moloch: moloch,
          proposalId: secondProposalIndex,
          expectedFlags: [true, false, false, false, false, true] // sponsored flag set
        })

        // deposit has moved - still have remaining deposit from membership
        await verifyBalance({
          token: depositToken,
          address: summoner,
          expectedBalance: initSummonerBalance
        })

        // moloch has the deposit
        await verifyBalance({
          token: depositToken,
          address: moloch.address,
          expectedBalance: (deploymentConfig.PROPOSAL_DEPOSIT * 2) + proposal1.tributeOffered
        })

        await verifyInternalBalance({
          moloch: moloch,
          token: depositToken,
          user: ESCROW,
          expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await verifyInternalBalance({
          moloch: moloch,
          token: depositToken,
          user: GUILD,
          expectedBalance: proposal1.tributeOffered
        })

        await verifyAllowance({
          token: depositToken,
          owner: summoner,
          spender: moloch.address,
          expectedAllowance: 0
        })
      })

      it('failure - sponsor kick proposal already proposed', async () => {
        const proposer = proposal1.applicant

        await moloch.submitGuildKickProposal(
          proposal1.applicant,
          'kick',
          { from: proposer }
        )

        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        let proposedToKick = await moloch.proposedToKick(proposal1.applicant)
        assert.equal(proposedToKick, true)

        // duplicate proposal
        await moloch.submitGuildKickProposal(
          proposal1.applicant,
          'kick',
          { from: proposer }
        )

        // add another deposit to sponsor proposal 1
        await tokenAlpha.transfer(summoner, deploymentConfig.PROPOSAL_DEPOSIT, { from: creator })
        await tokenAlpha.approve(moloch.address, deploymentConfig.PROPOSAL_DEPOSIT, { from: summoner })

        await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })
          .should.be.rejectedWith(revertMessages.sponsorProposalAlreadyProposedToKick)
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      // sponsor send by a delegate
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      // ensure period and queue length at zero
      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
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

      await verifyInternalBalance({
        moloch: moloch,
        token: depositToken,
        user: ESCROW,
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
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.sponsorProposalProposalHasAlreadyBeenSponsored)
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
        .should.be.rejectedWith(revertMessages.sponsorProposal)
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
        .should.be.rejectedWith(revertMessages.sponsorProposalAlreadyProposedToWhitelist)
    })

    it('require fail - insufficient deposit token', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: summoner })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.sponsorProposal(invalidPropsalIndex, { from: summoner })
        .should.be.rejectedWith(SolRevert)
    })

    it('require fail - sponsor non-existant proposal fails', async () => {
      await moloch.sponsorProposal(invalidPropsalIndex, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitProposalProposalMustHaveBeenProposed)
    })
  })

  describe('having submitted two whitelist proposals for the same token, with one sponsored...', () => {
    let newToken, whitelistProposal
    beforeEach(async () => {
      newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      whitelistProposal = {
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
        newToken.address,
        'whitelist me!',
        { from: proposal1.applicant }
      )

      const proposer = proposal1.applicant

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: proposer,
        expectedProposalCount: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // whitelist flag set to true after proposal
      })

      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: proposal1.applicant }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: secondProposalIndex,
        proposer: proposer,
        expectedProposalCount: 2
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // whitelist flag set to true after proposal
      })

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // need to sponsor again after this
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false] // sponsor & whitelist flags both true
      })

      await moveForwardPeriods(1)
    })

    it('when the first whitelist proposal **passes**, the second can no longer be sponsored', async () => {
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner }) // vote YES

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processWhitelistProposal(firstProposalIndex, { from: summoner })
      const isWhitelisted = await moloch.tokenWhitelist.call(newToken.address)
      assert.equal(isWhitelisted, true)

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
        .should.be.rejectedWith(revertMessages.sponsorProposalAlreadyWhitelisted)

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // sponsored is still false
      })
    })

    it('when the first whitelist proposal **fails**, the second can still be sponsored', async () => {
      await moloch.submitVote(firstProposalIndex, no, { from: summoner }) // vote NO

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processWhitelistProposal(firstProposalIndex, { from: summoner })
      const isWhitelisted = await moloch.tokenWhitelist.call(newToken.address)
      assert.equal(isWhitelisted, false)

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, true, false] // sponsor & whitelist flags both true
      })
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
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 1,
        expectedProposalCount: 1,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: yes,
        expectedMaxSharesAndLootAtYesVote: 1
      })
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, no, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: no,
        expectedMaxSharesAndLootAtYesVote: 0
      })
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitVoteProposalDoesNotExist)
    })

    it('require fail - vote must be less than 3', async () => {
      await moloch.submitVote(firstProposalIndex, 3, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitVoteMustBeLessThan3)
    })

    it('require fail - voting period has not started', async () => {
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitVoteVotingPeriodHasNotStarted)
    })

    describe('voting period boundary', () => {
      it('require fail - voting period has expired', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS + 1)
        await moloch
          .submitVote(firstProposalIndex, yes, { from: summoner })
          .should.be.rejectedWith(revertMessages.submitVoteVotingPeriodHasExpired)
      })

      it('success - vote 1 period before voting period expires', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

        await verifySubmitVote({
          moloch: moloch,
          proposalIndex: firstProposalIndex,
          memberAddress: summoner,
          expectedVote: yes,
          expectedMaxSharesAndLootAtYesVote: 1
        })
      })
    })

    it('require fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch
        .submitVote(firstProposalIndex, yes, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitVoteMemberHasAlreadyVoted)
    })

    it('require fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch
        .submitVote(firstProposalIndex, 0, { from: summoner })
        .should.be.rejectedWith(revertMessages.submitVoteVoteMustBeEitherYesOrNo)
    })

    it('modifier - delegate', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: creator })
        .should.be.rejectedWith('not a delegate')
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
          proposal2.lootRequested,
          proposal2.tributeOffered,
          proposal2.tributeToken,
          proposal2.paymentRequested,
          proposal2.paymentToken,
          proposal2.details,
          { from: proposal2.applicant }
        )

        await verifyProposal({
          moloch: moloch,
          proposal: proposal2,
          proposalId: secondProposalIndex,
          proposer: proposer,
          sponsor: zeroAddress,
          expectedStartingPeriod: 0,
          expectedProposalCount: 2,
          expectedProposalQueueLength: 1
        })

        await verifyFlags({
          moloch: moloch,
          proposalId: secondProposalIndex,
          expectedFlags: [false, false, false, false, false, false]
        })

        await fundAndApproveToMoloch({
          to: summoner,
          from: creator,
          value: deploymentConfig.PROPOSAL_DEPOSIT
        })

        await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

        await verifyProposal({
          moloch: moloch,
          proposal: proposal2,
          proposalId: secondProposalIndex,
          proposer: proposer,
          sponsor: summoner,
          expectedStartingPeriod: 2,
          expectedProposalCount: 2,
          expectedProposalQueueLength: 2
        })

        await verifyFlags({
          moloch: moloch,
          proposalId: secondProposalIndex,
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
          .should.be.rejectedWith(revertMessages.submitVoteVotingPeriodHasNotStarted)
      })

      it('happy case - yes vote, highestIndexYesVote is updated', async () => {
        await moveForwardPeriods(2)
        await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

        await verifySubmitVote({
          moloch: moloch,
          proposalIndex: secondProposalIndex,
          memberAddress: summoner,
          expectedVote: yes,
          expectedMaxSharesAndLootAtYesVote: 1
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
          moloch: moloch,
          proposalIndex: secondProposalIndex,
          memberAddress: summoner,
          expectedVote: no,
          expectedMaxSharesAndLootAtYesVote: 0
        })

        // no change
        memberData = await moloch.members(summoner)
        assert.equal(memberData.highestIndexYesVote, 0, 'highestIndexYesVote does not match')
      })
    })
  })

  describe('processProposal', () => {
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + summonerShares, // add the 1 the summoner has
        expectedTotalLoot: proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      // Make sure the guild bank tokens are accounted for
      const totalGuildBankTokens = await moloch.totalGuildBankTokens()
      assert.equal(+totalGuildBankTokens, 1)

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
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

    it('happy path - fail - no wins (proposer gets funds back)', async () => {
      proposer = proposal2.applicant // need to test that funds go back to proposer, not applicant

      await fundAndApproveToMoloch({
        to: proposer, // approve funds from proposer, not applicant
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, no, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 0,
        expectedVote: no
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedShares: 0,
        expectedLoot: 0,
        expectedExists: false
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 0,
        expectedNoVotes: 1,
        expectedTotalShares: 1, // just the summoner still in
        expectedMaxSharesAndLootAtYesVote: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered, // tribute is still in moloch
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [proposer]: proposal1.tributeOffered,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: zeroAddress,
        expectedShares: 0,
        expectedLoot: 0,
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
        proposal1.lootRequested,
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(2)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedShares: 0,
        expectedLoot: 0,
        expectedExists: false
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: (deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered) * 2,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: (deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered) * 2,
          [summoner]: 0,
          [processor]: 0
        }
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedShares: proposal1.sharesRequested + proposal1.sharesRequested, // two lots of shares
        expectedLoot: proposal1.lootRequested + proposal1.lootRequested, // two lots of loot
        expectedExists: true,
        expectedDelegateKey: proposal1.applicant,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: (proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT) * 2,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered * 2,
          [ESCROW]: 0,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
          [processor]: deploymentConfig.PROCESSING_REWARD * 2
        }
      })
    })

    it('happy path  - applicant is used as a delegate key so delegate key is reset', async () => {
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: proposer })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      // using a delegate
      let summonerMemberData = await moloch.members(summoner)
      assert.equal(summonerMemberData.delegateKey, proposer)

      let summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(proposer)
      assert.equal(summonerAddressByDelegateKey, summoner)

      await verifyMember({
        moloch: moloch,
        member: summoner,
        expectedDelegateKey: proposer,
        expectedShares: 1, // summoner already has one share
        expectedLoot: 0,
        expectedExists: true,
        expectedMemberAddressByDelegateKey: summoner
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT,
          [summoner]: 0,
          [processor]: 0
        }
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + summonerShares, // add the 1 the summoner has
        expectedTotalLoot: proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      // delegate reset to summoner
      summonerMemberData = await moloch.members(summoner)
      assert.equal(summonerMemberData.delegateKey, summoner)

      summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(summoner)
      assert.equal(summonerAddressByDelegateKey, summoner)

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT, // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      // delegate reset
      await verifyMember({
        moloch: moloch,
        member: summoner,
        expectedDelegateKey: summoner,
        expectedShares: 1, // summoner already has one share
        expectedLoot: 0,
        expectedExists: true,
        expectedMemberAddressByDelegateKey: summoner
      })

      // applicant has approved shares
      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedExists: true,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })
    })

    it('happy path - auto-fail if shares exceed limit', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // 2 proposals
      })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        _1e18, // max shares
        0, // skip loot
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      await moloch.submitProposal(
        applicant,
        _1e18Minus1, // 1 less than max shares
        0, // skip loot
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // two proposals
      })

      // sponsor and vote on both proposals
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
      await moveForwardPeriods(2)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      // first proposal should fail
      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: summonerShares, // no more shares added
        expectedTotalLoot: 0, // no loot
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false] // didPass is false
      })

      // second proposal should pass
      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: new BN(summonerShares).add(_1e18Minus1), // maximum possible shares
        expectedTotalLoot: 0, // no loot
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false] // didPass is false
      })
    })

    it('happy path - auto-fail if loot & shares exceed limit', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // 2 proposals
      })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        _1e18.sub(new BN(10)), // almost max shares
        10, // enough loot to cross max
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      await moloch.submitProposal(
        applicant,
        _1e18Minus1.sub(new BN(10)), // almost max shares
        9, // 1 less loot than last time
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // two proposals
      })

      // sponsor and vote on both proposals
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
      await moveForwardPeriods(2)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      // first proposal should fail
      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: summonerShares, // no more shares added
        expectedTotalLoot: 0, // no loot
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false] // didPass is false
      })

      // second proposal should pass
      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: _1e18.sub(new BN(10)), // maximum possible shares
        expectedTotalLoot: 9, // no loot
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false] // didPass is false
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

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT, // deposit solely as whitelisting has no tribute
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      const emittedLogs = await moloch.processWhitelistProposal(firstProposalIndex, { from: processor })

      const newApprovedToken = await moloch.approvedTokens(1) // second token to be added
      assert.equal(newApprovedToken, newToken.address)

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: 1, // no more shares added so still 1
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, true, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT, // deposit solely as whitelisting has no tribute
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      // Verify process proposal event
      const { logs } = emittedLogs
      const log = logs[0]
      const { proposalIndex, proposalId, didPass } = log.args
      assert.equal(log.event, 'ProcessWhitelistProposal')
      assert.equal(proposalIndex, 0)
      assert.equal(proposalId, 0)
      assert.equal(didPass, true)
    })

    it('happy path - guild kick member', async () => {
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // sponsor
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, true] // kick flag set
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      const emittedLogs = await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: 1, // no more shares added so still 1
        expectedTotalLoot: proposal1.sharesRequested + proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: proposal1.sharesRequested + summonerShares + proposal1.lootRequested
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, true]
      })

      // Verify process proposal event
      const { logs } = emittedLogs
      const log = logs[0]
      const { proposalIndex, proposalId, didPass } = log.args
      assert.equal(log.event, 'ProcessGuildKickProposal')
      assert.equal(proposalIndex, secondProposalIndex)
      assert.equal(proposalId, 1)
      assert.equal(didPass, true)
    })

    it('edge case - paymentRequested more than funds in the bank', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant

      // can be 1 because payment is calculated before tribute is accepted
      // (guild bank is 0)
      proposal1.paymentRequested = 1
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        member: applicant,
        expectedExists: false,
        expectedShares: 0,
        expectedLoot: 0
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedExists: false,
        expectedShares: 0,
        expectedLoot: 0
      })

      // now processed
      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, false, false]
      })
    })

    it('edge case - dilution bound is exceeded', async () => {

      /////////////////////////////////////////////////////
      // Setup Proposal 1 so we have shares to play with //
      /////////////////////////////////////////////////////

      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
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

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: yes,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + summonerShares, // add the 1 the summoner has
        expectedTotalLoot: proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      //////////////////////////////////////////////////////////////
      // Setup Proposal 2 so we can rage quit during the proposal //
      //////////////////////////////////////////////////////////////

      await fundAndApproveToMoloch({
        to: proposal2.applicant,
        from: creator,
        value: proposal2.tributeOffered
      })

      const proposer = proposal2.applicant
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal1.lootRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: proposal2.applicant }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: proposal2,
        proposalId: secondProposalIndex,
        proposer: proposer,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 2,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: proposal2,
        proposalId: secondProposalIndex,
        proposer: proposer,
        sponsor: summoner,
        expectedStartingPeriod: 72,
        expectedProposalCount: 2,
        expectedProposalQueueLength: 2
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // moloch has the deposit
      await verifyBalance({
        token: depositToken,
        address: moloch.address,
        expectedBalance: (deploymentConfig.PROPOSAL_DEPOSIT * 2) + proposal1.tributeOffered + proposal2.tributeOffered
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      /////////////////////////////////////////////////////////////
      // Rage quit majority of shares below dilution bound value //
      /////////////////////////////////////////////////////////////

      const proposalData = await moloch.proposals(secondProposalIndex)
      assert.equal(+proposalData.maxTotalSharesAndLootAtYesVote, 174)

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.ragequit(100, 20, { from: proposal1.applicant }) // 120 total

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: (proposal1.sharesRequested + summonerShares) - 100, // add the 1 the summoner, minus the 68 rage quit
        expectedTotalLoot: proposal1.lootRequested - 20,
        expectedMaxSharesAndLootAtYesVote: 174
      })

      // Ensure didPass=false and processed=True
      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, false, false, false, false]
      })
    })

    it('require fail - proposal does not exist', async () => {
      await moloch.processProposal(invalidPropsalIndex, { from: processor })
        .should.be.rejectedWith(revertMessages.processProposalProposalDoesNotExist)
    })

    it('require fail - proposal is not ready to be processed', async () => {
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
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.processProposalProposalIsNotReadyToBeProcessed)
    })

    it('require fail - proposal has already been processed', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, { from: proposal1.applicant })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.processProposalProposalHasAlreadyBeenProcessed)
    })

    it('require fail - previous proposal must be processed', async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered * 2, { from: creator })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered * 2, { from: proposal1.applicant })

      // submit
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.processProposalPreviousProposalMustBeProcessed)
    })

    it('require fail - must be a whitelist proposal', async () => {
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
        proposal1.lootRequested,
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
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processWhitelistProposal(firstProposalIndex, { from: applicant })
        .should.be.rejectedWith(revertMessages.processWhitelistProposalMustBeAWhitelistProposal)
    })

    it('require fail - must be a guild kick proposal', async () => {
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

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT, // deposit solely as whitelisting has no tribute
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await moloch.processGuildKickProposal(firstProposalIndex, { from: applicant })
        .should.be.rejectedWith(revertMessages.processGuildKickProposalMustBeAGuildKickProposal)
    })

    it('require fail - must be a standard process not a whitelist proposal', async () => {
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

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT, // deposit solely as whitelisting has no tribute
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await moloch.processProposal(firstProposalIndex, { from: processor })
        .should.be.rejectedWith(revertMessages.processProposalMustBeAStandardProposal)
    })

    it('require fail - must be a standard process not a guild kick proposal', async () => {
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

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, true, false]
      })

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT, // deposit solely as whitelisting has no tribute
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await moloch.processProposal(firstProposalIndex, { from: applicant })
        .should.be.rejectedWith(revertMessages.processProposalMustBeAStandardProposal)
    })
  })

  describe('rageQuit + withdrawBalance', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
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
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 1,
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
        expectedTotalLoot: proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT, // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
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

    describe('full ragequit - ', () => {
      let emittedLogs

      beforeEach(async () => {
        const { logs } = await moloch.ragequit(proposal1.sharesRequested, proposal1.lootRequested, { from: proposal1.applicant })
        emittedLogs = logs
      })

      it('happy path', async () => {
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: 0,
          expectedLoot: 0,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        const totalShares = await moloch.totalShares()
        assert.equal(totalShares, 1)

        const totalLoot = await moloch.totalLoot()
        assert.equal(totalLoot, 0)

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: 1, // because 1 summonr share other than applicant
            [ESCROW]: 0,
            [proposal1.applicant]: proposal1.tributeOffered - 1,
            [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
            [processor]: deploymentConfig.PROCESSING_REWARD
          }
        })
      })

    })

    describe('partial shares', () => {
      let emittedLogs

      let partialRageQuitShares

      beforeEach(async () => {
        partialRageQuitShares = 20
        const { logs } = await moloch.ragequit(partialRageQuitShares, 0, { from: proposal1.applicant })
        emittedLogs = logs
      })

      it('happy path', async () => {
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested - partialRageQuitShares,
          expectedLoot: proposal1.lootRequested,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        const totalShares = await moloch.totalShares()
        // your remaining shares plus the summoners 1 share
        assert.equal(totalShares, (proposal1.sharesRequested - partialRageQuitShares) + summonerShares)

        const amountToRagequit = Math.floor(partialRageQuitShares * proposal1.tributeOffered / (proposal1.sharesRequested + proposal1.lootRequested + 1))

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: proposal1.tributeOffered - amountToRagequit,
            [ESCROW]: 0,
            [proposal1.applicant]: amountToRagequit,
            [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
            [processor]: deploymentConfig.PROCESSING_REWARD
          }
        })
      })

    })

    describe('require fail - ', () => {
      it('not a member', async () => {
        await moloch.ragequit(1, 0, { from: nonMemberAccount })
          .should.be.rejectedWith(revertMessages.molochNotAMember)
      })

      it('requesting more shares than you own', async () => {
        await moloch.ragequit(proposal1.sharesRequested + 1, 0, { from: proposal1.applicant })
          .should.be.rejectedWith(revertMessages.molochRageQuitInsufficientShares)
      })

      it('requesting more loot than you own', async () => {
        await moloch.ragequit(0, proposal1.lootRequested + 1, { from: proposal1.applicant })
          .should.be.rejectedWith(revertMessages.molochRageQuitInsufficientLoot)
      })

      describe('when a proposal is in flight', () => {
        beforeEach(async () => {
          await fundAndApproveToMoloch({
            to: proposal2.applicant,
            from: creator,
            value: proposal1.tributeOffered
          })

          await moloch.submitProposal(
            proposal2.applicant,
            proposal2.sharesRequested,
            proposal1.lootRequested,
            proposal2.tributeOffered,
            proposal2.tributeToken,
            proposal2.paymentRequested,
            proposal2.paymentToken,
            proposal2.details,
            { from: proposal2.applicant }
          )

          await fundAndApproveToMoloch({
            to: summoner,
            from: creator,
            value: deploymentConfig.PROPOSAL_DEPOSIT
          })

          await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

          await verifyFlags({
            moloch: moloch,
            proposalId: secondProposalIndex,
            expectedFlags: [true, false, false, false, false, false]
          })

          await moveForwardPeriods(1)
          await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

          await verifySubmitVote({
            moloch: moloch,
            proposalIndex: secondProposalIndex,
            memberAddress: summoner,
            expectedMaxSharesAndLootAtYesVote: proposal1.sharesRequested + proposal1.lootRequested + 1,
            expectedVote: yes
          })
        })

        it('unable to quit when proposal in flight', async () => {
          await moloch.ragequit(1, 0, { from: summoner })
            .should.be.rejectedWith(revertMessages.rageQuitUntilHighestIndex)
        })
      })
    })

    describe('withdraw balance', async () => {
      beforeEach(async () => {
        await moloch.ragequit(proposal1.sharesRequested, proposal1.lootRequested, { from: proposal1.applicant })

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: 1, // because 1 summoner share other than applicant
            [ESCROW]: 0,
            [proposal1.applicant]: proposal1.tributeOffered - 1,
            [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
            [processor]: deploymentConfig.PROCESSING_REWARD
          }
        })
      })

      it('withdraw full balance (applicant, sponsor, processor)', async () => {
        await moloch.withdrawBalance(depositToken.address, proposal1.tributeOffered - 1, { from: proposal1.applicant })
        await moloch.withdrawBalance(depositToken.address, deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, { from: summoner })
        await moloch.withdrawBalance(depositToken.address, deploymentConfig.PROCESSING_REWARD, { from: processor })

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: 1, // because 1 summoner share other than applicant
            [ESCROW]: 0,
            [proposal1.applicant]: 0,
            [summoner]: 0,
            [processor]: 0
          }
        })

        await verifyBalance({
          token: depositToken,
          address: proposal1.applicant,
          expectedBalance: proposal1.tributeOffered - 1
        })

        await verifyBalance({
          token: depositToken,
          address: summoner,
          expectedBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD
        })

        await verifyBalance({
          token: depositToken,
          address: processor,
          expectedBalance: deploymentConfig.PROCESSING_REWARD
        })
      })

      it('withdraw some balance (applicant)', async () => {
        await moloch.withdrawBalance(depositToken.address, 10, { from: proposal1.applicant })

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: 1, // because 1 summoner share other than applicant
            [ESCROW]: 0,
            [proposal1.applicant]: proposal1.tributeOffered - 11,
            [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
            [processor]: deploymentConfig.PROCESSING_REWARD
          }
        })

        await verifyBalance({
          token: depositToken,
          address: proposal1.applicant,
          expectedBalance: 10
        })
      })

      it('withdraw 0 balance (applicant)', async () => {
        await moloch.withdrawBalance(depositToken.address, 0, { from: proposal1.applicant })

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: 1, // because 1 summoner share other than applicant
            [ESCROW]: 0,
            [proposal1.applicant]: proposal1.tributeOffered - 1,
            [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
            [processor]: deploymentConfig.PROCESSING_REWARD
          }
        })

        await verifyBalance({
          token: depositToken,
          address: proposal1.applicant,
          expectedBalance: 0
        })
      })

      it('require fail - insufficient balance', async () => {
        await moloch.withdrawBalance(depositToken.address, proposal1.tributeOffered, { from: proposal1.applicant })
          .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
      })
    })
  })


  describe('cancelProposal', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
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
    })

    it('happy case', async () => {
      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      let proposerBalance = await tokenAlpha.balanceOf(proposal1.applicant)

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, true, false, false]
      })

      await verifyBalance({
        token: depositToken,
        address: moloch.address,
        expectedBalance: proposal1.tributeOffered
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [proposal1.applicant]: proposal1.tributeOffered,
        }
      })
    })

    it('failure - already sponsored', async () => {
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })
        .should.be.rejectedWith(revertMessages.cancelProposalProposalHasAlreadyBeenSponsored)
    })

    it('failure - already cancelled', async () => {
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, true, false, false]
      })

      await moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })
        .should.be.rejectedWith(revertMessages.cancelProposalProposalHasAlreadyBeenCancelled)
    })

    it('failure - solely the proposer can cancel', async () => {
      await moloch.cancelProposal(firstProposalIndex, { from: creator })
        .should.be.rejectedWith(revertMessages.cancelProposalSolelyTheProposerCanCancel)
    })

  })

  describe('updateDelegateKey', () => {
    it('happy case', async () => {
      await moloch.updateDelegateKey(processor, { from: summoner })

      await verifyMember({
        moloch: moloch,
        member: summoner,
        expectedDelegateKey: processor,
        expectedShares: 1,
        expectedMemberAddressByDelegateKey: summoner
      })
    })

    it('failure - can not be zero address', async () => {
      await moloch.updateDelegateKey(zeroAddress, { from: summoner })
        .should.be.rejectedWith(revertMessages.updateDelegateKeyNewDelegateKeyCannotBe0)
    })

    it('failure - cant overwrite existing members', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await moloch.updateDelegateKey(applicant, { from: summoner })
        .should.be.rejectedWith(revertMessages.updateDelegateKeyCantOverwriteExistingMembers)
    })

    it('failure - cant overwrite existing delegate keys', async () => {
      await moloch.updateDelegateKey(processor, { from: summoner })

      await moloch.updateDelegateKey(processor, { from: summoner })
        .should.be.rejectedWith(revertMessages.updateDelegateKeyCantOverwriteExistingDelegateKeys)
    })
  })

  describe('canRageQuit', () => {
    it('happy case', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.canRageQuitProposalDoesNotExist)
    })
  })

  describe('ragekick', () => {
    it('failure - member must be in jail', async () => {
      await moloch.ragekick(summoner)
        .should.be.rejectedWith(revertMessages.ragekickMustBeInJail)
    })
  })

  describe('ragekick - member has never voted', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered // submitting 1 membership proposal
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // 1 membership + 1 guild kick proposal (to be sponsored)
      })

      // complete membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // complete guild kick proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: processor })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })
    })

    it('ragekick - happy case - can ragekick immediately after guild kick', async () => {
      const initialGuildBankBalance = new BN(proposal1.tributeOffered)
      const initialTotalSharesAndLoot = new BN(proposal1.lootRequested + proposal1.sharesRequested + 1)
      const lootToRageQuit = new BN(proposal1.lootRequested + proposal1.sharesRequested) // ragequit 100% of loot + shares
      const tokensToRageQuit = initialGuildBankBalance.mul(lootToRageQuit).div(initialTotalSharesAndLoot)

      await moloch.ragekick(proposal1.applicant)

      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: 0, // no more loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered + (deploymentConfig.PROPOSAL_DEPOSIT * 2),
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: initialGuildBankBalance.sub(tokensToRageQuit),
          [ESCROW]: 0,
          [proposal1.applicant]: tokensToRageQuit,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
          [processor]: deploymentConfig.PROCESSING_REWARD * 2
        }
      })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const totalLoot = await moloch.totalLoot()
      assert.equal(totalLoot, 0)
    })

    it('ragekick - failure - member must have some loot', async () => {
      await moloch.ragekick(proposal1.applicant)

      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: 0, // no more loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      await moloch.ragekick(proposal1.applicant)
        .should.be.rejectedWith(revertMessages.ragekickMustHaveSomeLoot)
    })
  })

  describe('ragekick - member voted on later proposal', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // submitting 2 membership proposal
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 3 // 2 membership + 1 guild kick proposal (to be sponsored)
      })

      // complete membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // submit a second proposal for more shares
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // sponsor second membership proposal
      await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })

      // vote yes on guild kick
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      // applicant votes yes on the second membership proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(thirdProposalIndex, yes, { from: proposal1.applicant })

      // complete guild kick proposal
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: processor })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedHighestIndexYesVote: thirdProposalIndex, // applicant voted on second membership proposal
        expectedMemberAddressByDelegateKey: applicant
      })
    })

    it('happy case - can ragekick after second membership proposal is processed', async () => {
      await moloch.processProposal(thirdProposalIndex, { from: processor }) // process the second membership proposal

      // should fail bc it adds shares to a jailed member
      await verifyFlags({
        moloch: moloch,
        proposalId: thirdProposalIndex,
        expectedFlags: [true, true, false, false, false, false]
      })

      // tribute returned to applicant (for second proposal)
      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: proposal1.tributeOffered,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 3,
          [processor]: deploymentConfig.PROCESSING_REWARD * 3
        }
      })

      // now we can ragekick
      await moloch.ragekick(proposal1.applicant)

      // loot removed from jailed member
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: 0, // no more loot
        expectedJailed: 1,
        expectedHighestIndexYesVote: thirdProposalIndex, // applicant voted on second membership proposal
        expectedMemberAddressByDelegateKey: applicant
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 1, // 1 bc summoner share
          [ESCROW]: 0,
          [proposal1.applicant]: (proposal1.tributeOffered * 2) - 1,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 3,
          [processor]: deploymentConfig.PROCESSING_REWARD * 3
        }
      })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const totalLoot = await moloch.totalLoot()
      assert.equal(totalLoot, 0)
    })

    it('ragekick - boundary condition - must wait for highestIndexYesVote propopsal to be processed', async () => {
      await moloch.ragekick(proposal1.applicant)
        .should.be.rejectedWith(revertMessages.ragekickPendingProposals)

      await moloch.processProposal(thirdProposalIndex) // process the second membership proposal

      // now we can ragekick
      await moloch.ragekick(proposal1.applicant)

      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: 0, // no more loot
        expectedJailed: 1,
        expectedHighestIndexYesVote: thirdProposalIndex,
        expectedMemberAddressByDelegateKey: applicant
      })
    })
  })

  describe('getMemberProposalVote', () => {
    it('happy case', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      const proposer = proposal1.applicant
      const applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        .should.be.rejectedWith(revertMessages.getMemberProposalVoteMemberDoesntExist)
    })

    it('failure - proposal does not exist', async () => {
      await moloch.getMemberProposalVote(summoner, invalidPropsalIndex)
        .should.be.rejectedWith(revertMessages.getMemberProposalVoteProposalDoesntExist)
    })
  })

  describe('as a member with solely loot and no shares...', () => {
    beforeEach(async () => {
      proposal1.sharesRequested = 0 // NO SHARES
      proposal1.lootRequested = 2 // SOME LOOT

      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit
      const proposer = proposal1.applicant
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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

      // vote
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      memberVote = await moloch.getMemberProposalVote(summoner, firstProposalIndex)
      assert.equal(memberVote, 1)

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant, // important for testing delegate key functions
        expectedShares: 0, // check 0 shares
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant // important for testing delegate key functions
      })
    })

    it('can still ragequit (justMember modifier)', async () => {
      const initialGuildBankBalance = new BN(proposal1.tributeOffered)
      const initialTotalSharesAndLoot = new BN(proposal1.lootRequested + proposal1.sharesRequested + 1)
      const lootToRageQuit = new BN(proposal1.lootRequested) // ragequit 100% of loot
      const tokensToRageQuit = initialGuildBankBalance.mul(lootToRageQuit).div(initialTotalSharesAndLoot)

      await moloch.ragequit(0, lootToRageQuit, { from: proposal1.applicant })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: 0,
        expectedLoot: 0,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: initialGuildBankBalance.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT)),
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: initialGuildBankBalance.sub(tokensToRageQuit),
          [ESCROW]: 0,
          [proposal1.applicant]: tokensToRageQuit,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const totalLoot = await moloch.totalLoot()
      assert.equal(totalLoot, 0)
    })

    it('can still partial ragequit (justMember modifier)', async () => {
      const initialGuildBankBalance = new BN(proposal1.tributeOffered)
      const initialTotalSharesAndLoot = new BN(proposal1.lootRequested + proposal1.sharesRequested + 1)
      const lootToRageQuit = new BN(proposal1.lootRequested - 1)
      const tokensToRageQuit = initialGuildBankBalance.mul(lootToRageQuit).div(initialTotalSharesAndLoot) // ragequit 1 less than total loot

      await moloch.ragequit(0, lootToRageQuit, { from: proposal1.applicant })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: 0,
        expectedLoot: 1,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: initialGuildBankBalance.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT)),
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: initialGuildBankBalance.sub(tokensToRageQuit),
          [ESCROW]: 0,
          [proposal1.applicant]: tokensToRageQuit,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const totalLoot = await moloch.totalLoot()
      assert.equal(totalLoot, 1)
    })

    it('unable to update delegateKey (justShareholder modifier)', async () => {
      await moloch.updateDelegateKey(applicant2, { from: proposal1.applicant })
      .should.be.rejectedWith(revertMessages.notAShareholder)
    })

    it('unable to use delegate key to sponsor (justShareholder modifier)', async () => {
      await fundAndApproveToMoloch({
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

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: secondProposalIndex,
        proposer: proposal1.applicant,
        sponsor: zeroAddress,
        expectedStartingPeriod: 0,
        expectedProposalCount: 2,
        expectedProposalQueueLength: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: proposal1.applicant })
        .should.be.rejectedWith('not a delegate')

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      // should still work - testing to make sure nothing is wrong with the proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: secondProposalIndex,
        proposer: proposal1.applicant,
        sponsor: summoner,
        expectedStartingPeriod: 72, // 1 + 70 + 1
        expectedProposalCount: 2,
        expectedProposalQueueLength: 2
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })
    })

    it('unable to use delegate key to vote (justDelegate modifier)', async () => {
      await fundAndApproveToMoloch({
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
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: secondProposalIndex,
        proposer: proposal1.applicant,
        sponsor: summoner,
        expectedStartingPeriod: 72, // 1 + 70 + 1
        expectedProposalCount: 2,
        expectedProposalQueueLength: 2
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)

      await moloch.submitVote(secondProposalIndex, yes, { from: proposal1.applicant })
        .should.be.rejectedWith('not a delegate')

      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedVote: yes,
        expectedMaxSharesAndLootAtYesVote: 1 + proposal1.sharesRequested + proposal1.lootRequested
      })
    })
  })

  describe('jail effects', () => {
    let proposer, applicant

    it('cant process proposals for a jailed applicant', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // two membership proposals
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 3 // two membership + 1 guild kick proposals
      })

      // complete first membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // also submit proposal for more shares
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // sponsor proposal for more shares
      await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })

      // vote YES on both guild kick + more shares proposals
      await moveForwardPeriods(2) // move 2 periods bc 2 proposals pending
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moloch.submitVote(thirdProposalIndex, yes, { from: summoner })

      // complete guild kick proposal
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      await moloch.processProposal(thirdProposalIndex, { from: processor })

      // proposal must have failed, despite passing votes
      await verifyFlags({
        moloch: moloch,
        proposalId: thirdProposalIndex,
        expectedFlags: [true, true, false, false, false, false] // didPass is false
      })

      // member must not have received more shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })
    })

    it('cant sponsor proposals for a jailed applicant', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // two membership proposals
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 3 // two membership + 1 guild kick proposals
      })

      // complete first membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // also submit proposal for more shares
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // complete guild kick proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      // sponsor proposal for more shares
      await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })
        .should.be.rejectedWith(revertMessages.sponsorProposalApplicantIsJailed)
    })

    it('cant sponsor guild kick proposals for a jailed applicant', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 3 // 1 membership + 2 guild kick proposals
      })

      // complete first membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // submit a second guild kick proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // sponsor first guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // complete first guild kick proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      // sponsor second guild kick proposal
      await moloch.sponsorProposal(thirdProposalIndex, { from: summoner })
        .should.be.rejectedWith(revertMessages.sponsorProposalApplicantIsJailed)
    })

    it('cant submit proposals for a jailed applicant', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered * 2 // submitting 2 membership proposals
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // 1 membership + 1 guild kick proposal (to be sponsored)
      })

      // complete membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // complete guild kick proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      // try to submit second membership proposal - fails b/c jail
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposer }
      ).should.be.rejectedWith(revertMessages.submitProposalApplicantIsJailed)
    })

    it('cant submit guild kick proposals for a jailed applicant', async () => {
      await fundAndApproveToMoloch({
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered // submitting 1 membership proposals
      })

      // submit membership proposal
      proposer = proposal1.applicant
      applicant = proposal1.applicant
      await moloch.submitProposal(
        applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
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
        value: deploymentConfig.PROPOSAL_DEPOSIT * 2 // 1 membership + 1 guild kick proposal (to be sponsored)
      })

      // complete membership proposal
      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })
      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(firstProposalIndex, { from: processor })

      // proposal 1 has given applicant shares
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
        expectedMemberAddressByDelegateKey: applicant
      })

      // raise the kick applicant proposal
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      )

      // sponsor guild kick proposal
      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      // complete guild kick proposal
      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processGuildKickProposal(secondProposalIndex, { from: applicant })

      // shares removed
      await verifyMember({
        moloch: moloch,
        member: applicant,
        expectedDelegateKey: applicant,
        expectedShares: 0,
        expectedLoot: proposal1.lootRequested + proposal1.sharesRequested, // convert shares to loot
        expectedJailed: 1,
        expectedMemberAddressByDelegateKey: applicant
      })

      // try to submit second membership proposal - fails b/c jail
      await moloch.submitGuildKickProposal(
        applicant,
        'kick',
        { from: proposer }
      ).should.be.rejectedWith(revertMessages.submitGuildKickProposalMemberMustNotBeJailed)
    })
  })
})
