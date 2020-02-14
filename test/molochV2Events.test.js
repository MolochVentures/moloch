const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
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
  molochConstructorDepositCannotBeSmallerThanProcessingReward: '_proposalDeposit cannot be smaller than _processingReward',
  molochConstructorApprovedTokenCannotBe0: '_approvedToken cannot be 0',
  molochConstructorDuplicateApprovedToken: 'revert duplicate approved token',
  submitProposalTooManySharesRequested: 'too many shares requested',
  submitProposalProposalMustHaveBeenProposed: 'proposal must have been proposed',
  submitProposalTributeTokenIsNotWhitelisted: 'tributeToken is not whitelisted',
  submitProposalPaymetTokenIsNotWhitelisted: 'payment is not whitelisted',
  submitProposalApplicantCannotBe0: 'revert applicant cannot be 0',
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

  describe('constructor events', () => {
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

    it('require success - emits SummonComplete event', async () => {

      const depToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const newContract = await Moloch.new(
        summoner,
        [depToken.address],
        deploymentConfig.PERIOD_DURATION_IN_SECONDS,
        deploymentConfig.VOTING_DURATON_IN_PERIODS,
        deploymentConfig.GRACE_DURATON_IN_PERIODS,
        deploymentConfig.PROPOSAL_DEPOSIT,
        deploymentConfig.DILUTION_BOUND,
        deploymentConfig.PROCESSING_REWARD
      ) 
      const transactionHash = newContract.transactionHash;
    
      const transactionReceipt = await web3.eth.getTransactionReceipt(transactionHash);
     
      const blockNumber = transactionReceipt.blockNumber;

      const logs = await newContract.getPastEvents("allEvents", {fromBlock: blockNumber, toBlock: blockNumber});
      
      const log = logs[0];

      //event SummonComplete(address indexed summoner, address[] tokens, uint256 summoningTime, uint256 periodDuration, uint256 votingPeriodLength, uint256 gracePeriodLength, uint256 proposalDeposit, uint256 dilutionBound, uint256 processingReward);
      assert.equal(log.event, 'SummonComplete');

      const molochSummoner = log.args.summoner;
      const {tokens,summoningTime,periodDuration,votingPeriodLength,gracePeriodLength,proposalDeposit,dilutionBound,processingReward } = log.args;
      
      assert.isNotNull(summoningTime);
      assert.equal(molochSummoner, summoner);
      assert.deepEqual(tokens, [depToken.address]);
      assert.equal(periodDuration, deploymentConfig.PERIOD_DURATION_IN_SECONDS);
      assert.equal(votingPeriodLength, deploymentConfig.VOTING_DURATON_IN_PERIODS);
      assert.equal(gracePeriodLength, deploymentConfig.GRACE_DURATON_IN_PERIODS);
      assert.equal(proposalDeposit, deploymentConfig.PROPOSAL_DEPOSIT);
      assert.equal(dilutionBound, deploymentConfig.DILUTION_BOUND);
      assert.equal(processingReward, deploymentConfig.PROCESSING_REWARD);
      
    })
  })

  describe('submitProposal events', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: applicant1,
        from: creator,
        value: proposal1.tributeOffered
      })
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: proposal1.tributeOffered
      })
      await fundAndApproveToMoloch({
        to: processor,
        from: creator,
        value: proposal1.tributeOffered
      })
    })

    it('require success - emits SubmitProposal event submitted by non-member', async () =>{
      const countBefore = await moloch.proposalCount()

      await verifyBalance({
        token: tokenAlpha,
        address: proposal1.applicant,
        expectedBalance: proposal1.tributeOffered
      })

      const proposer = proposal1.applicant
      const emittedLogs = await moloch.submitProposal(
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, proposer );
      assert.equal(sharesRequested, proposal1.sharesRequested );
      assert.equal(lootRequested, proposal1.lootRequested );
      assert.equal(tributeOffered, proposal1.tributeOffered );
      assert.equal(tributeToken, proposal1.tributeToken );
      assert.equal(paymentRequested, proposal1.paymentRequested );
      assert.equal(paymentToken, proposal1.paymentToken );
      assert.equal(details, proposal1.details );
      assert.deepEqual(flags, [false, false, false, false, false, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, proposer );
      assert.equal(memberAddress, zeroAddress );
      assert.equal(log.event, 'SubmitProposal');
    })

    it('require success - emits SubmitProposal event submitted by member', async () => {
      const countBefore = await moloch.proposalCount()

      await verifyBalance({
        token: tokenAlpha,
        address: summoner,
        expectedBalance: proposal1.tributeOffered+initSummonerBalance
      })

      const proposer = proposal1.applicant
      const emittedLogs = await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: summoner,
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
        address: summoner,
        expectedBalance: initSummonerBalance
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, proposal1.applicant );
      assert.equal(sharesRequested, proposal1.sharesRequested );
      assert.equal(lootRequested, proposal1.lootRequested );
      assert.equal(tributeOffered, proposal1.tributeOffered );
      assert.equal(tributeToken, proposal1.tributeToken );
      assert.equal(paymentRequested, proposal1.paymentRequested );
      assert.equal(paymentToken, proposal1.paymentToken );
      assert.equal(details, proposal1.details );
      assert.deepEqual(flags, [false, false, false, false, false, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, summoner );
      assert.equal(memberAddress, summoner );
      assert.equal(log.event, 'SubmitProposal');
    })

    it('require success - emits SubmitProposal event submitted by delegate', async () => {
      const countBefore = await moloch.proposalCount()

      await moloch.updateDelegateKey(processor, { from: summoner })

      await verifyMember({
        moloch: moloch,
        member: summoner,
        expectedDelegateKey: processor,
        expectedShares: 1,
        expectedMemberAddressByDelegateKey: summoner
      })

      await verifyBalance({
        token: tokenAlpha,
        address: summoner,
        expectedBalance: proposal1.tributeOffered+initSummonerBalance
      })

      await verifyBalance({
        token: tokenAlpha,
        address: processor,
        expectedBalance: proposal1.tributeOffered
      })

      const proposer = proposal1.applicant
      const emittedLogs = await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.lootRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: processor }
      )

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))
      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: processor,
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
        address: processor,
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      assert.equal(log.event, 'SubmitProposal');
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, proposal1.applicant );
      assert.equal(sharesRequested, proposal1.sharesRequested );
      assert.equal(lootRequested, proposal1.lootRequested );
      assert.equal(tributeOffered, proposal1.tributeOffered );
      assert.equal(tributeToken, proposal1.tributeToken );
      assert.equal(paymentRequested, proposal1.paymentRequested );
      assert.equal(paymentToken, proposal1.paymentToken );
      assert.equal(details, proposal1.details );
      assert.deepEqual(flags, [false, false, false, false, false, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, processor );
      assert.equal(memberAddress, summoner );
      
    })
  })

  describe('submitWhitelistProposal events', () => {
    let newToken
    beforeEach(async () => {
      newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)
    })

    it('require success - emits SubmitProposal event submitted by non-member', async () => {
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

      const emittedLogs = await moloch.submitWhitelistProposal(
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, zeroAddress );
      assert.equal(sharesRequested, 0 );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, 0 );
      assert.equal(tributeToken, newToken.address );
      assert.equal(paymentRequested, 0 );
      assert.equal(paymentToken, zeroAddress);
      assert.equal(details, whitelistProposal.details );
      assert.deepEqual(flags, [false, false, false, false, true, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, proposal1.applicant);
      assert.equal(memberAddress, zeroAddress );
      assert.equal(log.event, 'SubmitProposal');

    })

    it('require success - emits SubmitProposal event submitted by member', async () => {
      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: summoner,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!'
      }

      // no tribute value is required balance should stay the same
      await verifyBalance({
        token: tokenAlpha,
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      const emittedLogs = await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: summoner }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: summoner,
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
        address: summoner,
        expectedBalance: initSummonerBalance
      })

      // no tribute value is required so moloch will be empty
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: 0
      })

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, zeroAddress );
      assert.equal(sharesRequested, 0 );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, 0 );
      assert.equal(tributeToken, newToken.address );
      assert.equal(paymentRequested, 0 );
      assert.equal(paymentToken, zeroAddress);
      assert.equal(details, whitelistProposal.details );
      assert.deepEqual(flags, [false, false, false, false, true, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, summoner);
      assert.equal(memberAddress, summoner );
      assert.equal(log.event, 'SubmitProposal');

    })

    it('require success - emits SubmitProposal event submitted by delegate', async () => {

      await moloch.updateDelegateKey(processor, { from: summoner })

      const proposer = proposal1.applicant
      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: processor,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!'
      }

      // no tribute value is required balance should stay the same
      await verifyBalance({
        token: tokenAlpha,
        address: processor,
        expectedBalance: 0
      })

      const emittedLogs = await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: processor }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: processor,
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
        address: processor,
        expectedBalance: 0
      })

      // no tribute value is required so moloch will be empty
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: 0
      })

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, zeroAddress );
      assert.equal(sharesRequested, 0 );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, 0 );
      assert.equal(tributeToken, newToken.address );
      assert.equal(paymentRequested, 0 );
      assert.equal(paymentToken, zeroAddress);
      assert.equal(details, whitelistProposal.details );
      assert.deepEqual(flags, [false, false, false, false, true, false] );
      assert.equal(proposalId, firstProposalIndex );
      assert.equal(delegateKey, processor);
      assert.equal(memberAddress, summoner );
      assert.equal(log.event, 'SubmitProposal');

    })
  })

  describe('submitGuildKickProposal events', () => {
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

    it('require success - emits SubmitProposal event submitted by non-member', async () => {
      const nonMemberProposer = applicant2
      const guildKickProposal = {
        applicant: proposal1.applicant,
        proposer: nonMemberProposer,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: zeroAddress,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'kick him!'
      }

      // no tribute value is required
      await verifyBalance({
        token: tokenAlpha,
        address: nonMemberProposer,
        expectedBalance: 0
      })

      const emittedLogs = await moloch.submitGuildKickProposal(
        guildKickProposal.applicant,
        guildKickProposal.details,
        { from: nonMemberProposer }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: guildKickProposal,
        proposalId: secondProposalIndex,
        proposer: nonMemberProposer,
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
        address: nonMemberProposer,
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, guildKickProposal.applicant );
      assert.equal(sharesRequested, guildKickProposal.sharesRequested );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, guildKickProposal.tributeOffered );
      assert.equal(tributeToken, guildKickProposal.tributeToken );
      assert.equal(paymentRequested, guildKickProposal.paymentRequested );
      assert.equal(paymentToken, guildKickProposal.paymentToken);
      assert.equal(details, guildKickProposal.details );
      assert.deepEqual(flags, [false, false, false, false, false, true] );
      assert.equal(proposalId, secondProposalIndex );
      assert.equal(delegateKey, nonMemberProposer);
      assert.equal(memberAddress, zeroAddress );
      assert.equal(log.event, 'SubmitProposal');
    })

    it('require success - emits SubmitProposal event submitted by member', async () => {
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
        address: proposer,
        expectedBalance: 0
      })

      const emittedLogs = await moloch.submitGuildKickProposal(
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
        address: proposer,
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, guildKickProposal.applicant );
      assert.equal(sharesRequested, guildKickProposal.sharesRequested );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, guildKickProposal.tributeOffered );
      assert.equal(tributeToken, guildKickProposal.tributeToken );
      assert.equal(paymentRequested, guildKickProposal.paymentRequested );
      assert.equal(paymentToken, guildKickProposal.paymentToken);
      assert.equal(details, guildKickProposal.details );
      assert.deepEqual(flags, [false, false, false, false, false, true] );
      assert.equal(proposalId, secondProposalIndex );
      assert.equal(delegateKey, guildKickProposal.applicant );
      assert.equal(memberAddress, guildKickProposal.applicant  );
      assert.equal(log.event, 'SubmitProposal');
    })

    it('require success - emits SubmitProposal event submitted by delegate', async () => {
      await moloch.updateDelegateKey(processor, { from: proposal1.applicant })

      const proposer = processor
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
        address: proposer,
        expectedBalance: 0
      })

      const emittedLogs = await moloch.submitGuildKickProposal(
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
        address: proposer,
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      //event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress);
      const { applicant,sharesRequested,lootRequested,tributeOffered,tributeToken,paymentRequested,paymentToken,details,flags,proposalId,delegateKey,memberAddress } = log.args

      assert.equal(applicant, guildKickProposal.applicant );
      assert.equal(sharesRequested, guildKickProposal.sharesRequested );
      assert.equal(lootRequested, 0 );
      assert.equal(tributeOffered, guildKickProposal.tributeOffered );
      assert.equal(tributeToken, guildKickProposal.tributeToken );
      assert.equal(paymentRequested, guildKickProposal.paymentRequested );
      assert.equal(paymentToken, guildKickProposal.paymentToken);
      assert.equal(details, guildKickProposal.details );
      assert.deepEqual(flags, [false, false, false, false, false, true] );
      assert.equal(proposalId, secondProposalIndex );
      assert.equal(delegateKey, processor );
      assert.equal(memberAddress, guildKickProposal.applicant  );
      assert.equal(log.event, 'SubmitProposal');
    })
  })

  describe('sponsorProposal events', () => {
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered
      })
      // ensure summoner has balance
      await verifyBalance({
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered
      })

      // moloch has approval to move the funds
      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered
      })
    })

    it('require success - emits SponsorProposal event for proposal', async () => {
      const countBefore = await moloch.proposalCount()

      await verifyBalance({
        token: tokenAlpha,
        address: summoner,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT+initSummonerBalance + proposal1.tributeOffered
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
        { from: summoner }
      )

      const countAfter = await moloch.proposalCount()
      assert.equal(+countAfter, +countBefore.add(_1))

      await verifyProposal({
        moloch: moloch,
        proposal: proposal1,
        proposalId: firstProposalIndex,
        proposer: summoner,
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
        address: summoner,
        expectedBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT
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


      const emittedLogs = await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false] // sponsored flag set
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
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered
      })

      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: 0
      })

      const { logs } = emittedLogs
      const log = logs[0]
      const {delegateKey,memberAddress,proposalId,proposalIndex,startingPeriod} = log.args
      const expectedStartingPeriod = 1
      const expectedProposalQueueLength = 0

      assert.equal(log.event, 'SponsorProposal')

      assert.equal(delegateKey, summoner)
      assert.equal(memberAddress, summoner)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(proposalIndex, expectedProposalQueueLength)
      assert.equal(startingPeriod, expectedStartingPeriod)
      
    })

    it('require success - emits SponsorProposal event for whitelistProposal', async () => {
      newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: summoner,
        sharesRequested: 0,
        tributeOffered: 0,
        tributeToken: newToken.address,
        paymentRequested: 0,
        paymentToken: zeroAddress,
        details: 'whitelist me!'
      }

      // no tribute value is required balance should stay the same
      await verifyBalance({
        token: tokenAlpha,
        address: summoner,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT+initSummonerBalance + proposal1.tributeOffered
      })

      await moloch.submitWhitelistProposal(
        newToken.address,
        'whitelist me!',
        { from: summoner }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: summoner,
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
        address: summoner,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT+initSummonerBalance + proposal1.tributeOffered
      })

      // no tribute value is required so moloch will be empty
      await verifyBalance({
        token: tokenAlpha,
        address: moloch.address,
        expectedBalance: 0
      })


      const emittedLogs = await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: summoner,
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
        token: tokenAlpha,
        address: summoner,
        expectedBalance: initSummonerBalance + proposal1.tributeOffered
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
        expectedAllowance: proposal1.tributeOffered
      })


      const { logs } = emittedLogs
      const log = logs[0]
      const {delegateKey,memberAddress,proposalId,proposalIndex,startingPeriod} = log.args
      const expectedStartingPeriod = 1
      const expectedProposalQueueLength = 0

      assert.equal(log.event, 'SponsorProposal')

      assert.equal(delegateKey, summoner)
      assert.equal(memberAddress, summoner)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(proposalIndex, expectedProposalQueueLength)
      assert.equal(startingPeriod, expectedStartingPeriod)

    })

    it('require success - emits SponsorProposal event for guildKickProposal', async () => {
      // cant kick the summoner, so we have to vote in a new member
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
        address: proposer,
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
        address: proposer,
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

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })
      const emittedLogs = await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, true] // sponsored flag set
      })

      // deposit has moved
      await verifyBalance({
        moloch: moloch,
        token: depositToken,
        address: summoner,
        expectedBalance: initSummonerBalance + proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT
      })

      // moloch has the deposit
      await verifyBalance({
        moloch: moloch,
        token: depositToken,
        address: moloch.address,
        expectedBalance: deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered + deploymentConfig.PROPOSAL_DEPOSIT 
      })

      await verifyAllowance({
        token: depositToken,
        owner: summoner,
        spender: moloch.address,
        expectedAllowance: 0
      })

      const { logs } = emittedLogs
      const log = logs[0]
      const {delegateKey,memberAddress,proposalId,proposalIndex,startingPeriod} = log.args
      const expectedStartingPeriod = deploymentConfig.VOTING_DURATON_IN_PERIODS+deploymentConfig.GRACE_DURATON_IN_PERIODS+2
      const expectedProposalQueueLength = 1

      assert.equal(log.event, 'SponsorProposal')

      assert.equal(delegateKey, summoner)
      assert.equal(memberAddress, summoner)
      assert.equal(proposalId, secondProposalIndex)
      assert.equal(proposalIndex, expectedProposalQueueLength)
      assert.equal(startingPeriod, expectedStartingPeriod)
    })

  })

  describe('submitVote events', () => {
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

    it('require success - emits Vote event submitted by member', async () => {
      await moveForwardPeriods(1)
      const emittedLogs = await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: yes,
        expectedMaxSharesAndLootAtYesVote: 1
      })
     
      const { logs } = emittedLogs
      const log = logs[0]
      

      assert.equal(log.event, 'SubmitVote')
      //event SubmitVote(uint256 proposalId, uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
      
      const {proposalId,proposalIndex,delegateKey,memberAddress,uintVote} = log.args
      assert.equal(proposalId, 0)
      assert.equal(proposalIndex, 0)
      assert.equal(delegateKey, summoner)
      assert.equal(memberAddress, summoner)
      assert.equal(uintVote, 1)
      
    })

    it('require success - emits Vote event submitted by delegate', async () => {
      await moveForwardPeriods(1)
      await moloch.updateDelegateKey(processor, { from: summoner })

      const emittedLogs = await moloch.submitVote(firstProposalIndex, no, { from: processor })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedVote: no,
        expectedMaxSharesAndLootAtYesVote: 0
      })

      const { logs } = emittedLogs
      const log = logs[0]

      assert.equal(log.event, 'SubmitVote')
      //event SubmitVote(uint256 proposalId, uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote);
      
      const {proposalId,proposalIndex,delegateKey,memberAddress,uintVote} = log.args
      assert.equal(proposalId, 0)
      assert.equal(proposalIndex, 0)
      assert.equal(delegateKey, processor)
      assert.equal(memberAddress, summoner)
      assert.equal(uintVote, 2)

      
    })

  })

  describe('processProposal events', () => {
    let proposer, applicant
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

      await moveForwardPeriods(1)
    })

    it('require success - yes wins - emits ProcessProposal event', async () => {
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

      const emittedLogs = await moloch.processProposal(firstProposalIndex, { from: processor })

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
    
      const { logs } = emittedLogs
      const log = logs[0]
      assert.equal(log.event, 'ProcessProposal')
      //event ProcessProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);
      

      const proposalQueueLength = 0
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(didPass, true)
    })

    it('require success - no wins - emits ProcessProposal event', async () => {
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

      const emittedLogs = await moloch.processProposal(firstProposalIndex, { from: processor })

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
          [proposal1.applicant]: proposal1.tributeOffered,
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

      const { logs } = emittedLogs
      const log = logs[0]
      assert.equal(log.event, 'ProcessProposal')
      //event ProcessProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);
      

      const proposalQueueLength = 0
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(didPass, false)
    })

  })

  describe('processWhitelistProposal events', () => {
    let proposer, applicant
    beforeEach(async () => {
      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: proposal1.tributeOffered
      })

      newToken = await Token.new(deploymentConfig.TOKEN_SUPPLY)

      const whitelistProposal = {
        applicant: zeroAddress,
        proposer: summoner,
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
        { from: summoner }
      )

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: summoner,
        expectedProposalCount: 1
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, true, false] // whitelist flag set to true after proposal
      })

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyProposal({
        moloch: moloch,
        proposal: whitelistProposal,
        proposalId: firstProposalIndex,
        proposer: summoner,
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

      await moveForwardPeriods(1)
    })

    it('require success - yes wins - emits ProcessWhitelistProposal event', async () => {
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
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      const emittedLogs = await moloch.processWhitelistProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: summonerShares, // add the 1 the summoner has
        expectedTotalLoot: 0,
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
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })
    
      const { logs } = emittedLogs
      const log = logs[0]
      assert.equal(log.event, 'ProcessWhitelistProposal')
      //event ProcessProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);
      

      const proposalQueueLength = 0
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(didPass, true)
    })

    it('require success - no wins - emits ProcessWhitelistProposal event', async () => {
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

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      const emittedLogs = await moloch.processWhitelistProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: firstProposalIndex,
        expectedNoVotes: 1,
        expectedTotalShares: summonerShares, // add the 1 the summoner has
        expectedTotalLoot: 0,
        expectedMaxSharesAndLootAtYesVote: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [true, true, false, false, true, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: deploymentConfig.PROPOSAL_DEPOSIT,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: 0,
          [ESCROW]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })
    
      const { logs } = emittedLogs
      const log = logs[0]
      assert.equal(log.event, 'ProcessWhitelistProposal')
      //event ProcessProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);

      const proposalQueueLength = 0
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(didPass, false)
    })
  })

  describe('processGuildKickProposal events', () => {
    let proposer, applicant
    beforeEach(async () => {
      // cant kick the summoner, so we have to vote in a new member
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

      await fundAndApproveToMoloch({
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, true] // sponsored flag set
      })

      await moveForwardPeriods(1)
      
    })

    it('require success - yes wins - emits ProcessGuildKickProposal event', async () => {
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: summonerShares+proposal1.lootRequested+proposal1.sharesRequested,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 2*deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      const emittedLogs = await moloch.processGuildKickProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: summonerShares, // add the 1 the summoner has
        expectedTotalLoot: proposal1.sharesRequested + proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: summonerShares+proposal1.lootRequested+proposal1.sharesRequested
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, true]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 2*deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [summoner]: 2*(deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD),
          [processor]: 2*deploymentConfig.PROCESSING_REWARD
        }
      })
    
      const { logs } = emittedLogs
      const log = logs[0]
  
      //event ProcessGuildKickProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);
      assert.equal(log.event, 'ProcessGuildKickProposal')


      const proposalQueueLength = 1
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, secondProposalIndex)
      assert.equal(didPass, true)
      
    })

    it('require success - no wins - emits ProcessGuildKickProposal event', async () => {
      await moloch.submitVote(secondProposalIndex, no, { from: summoner })

      await verifySubmitVote({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAndLootAtYesVote: 0,
        expectedVote: no
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 2*deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      const emittedLogs = await moloch.processGuildKickProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        moloch: moloch,
        proposalIndex: secondProposalIndex,
        expectedNoVotes: 1,
        expectedTotalShares: summonerShares + proposal1.sharesRequested, // add the 1 the summoner has
        expectedTotalLoot:  proposal1.lootRequested,
        expectedMaxSharesAndLootAtYesVote: 0
      })

      await verifyFlags({
        moloch: moloch,
        proposalId: secondProposalIndex,
        expectedFlags: [true, true, false, false, false, true]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 2*deploymentConfig.PROPOSAL_DEPOSIT + proposal1.tributeOffered,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [summoner]: 2*(deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD),
          [processor]: 2*deploymentConfig.PROCESSING_REWARD
        }
      })
    
      const { logs } = emittedLogs
      const log = logs[0]
  
      //event ProcessGuildKickProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass);
      assert.equal(log.event, 'ProcessGuildKickProposal')


      const proposalQueueLength = 1
      const {proposalIndex,proposalId,didPass} = log.args
      assert.equal(proposalIndex, proposalQueueLength)
      assert.equal(proposalId, secondProposalIndex)
      assert.equal(didPass, false)
    })

  })


  describe('rageQuit events', () => {
    //NOTE: add applicant1 as a member
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

    it('require success - full ragequit - emits RageQuit event', async () => {
      const emittedLogs = await moloch.ragequit(proposal1.sharesRequested, proposal1.lootRequested, { from: proposal1.applicant })
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      assert.equal(log.event, 'Ragequit')
      //event Ragequit(address indexed memberAddress, uint256 sharesToBurn, uint256 lootToBurn);
      
      const {memberAddress,sharesToBurn,lootToBurn} = log.args
      assert.equal(memberAddress, proposal1.applicant)
      assert.equal(sharesToBurn, proposal1.sharesRequested)
      assert.equal(lootToBurn, proposal1.lootRequested)
    })

    it('require success - partial ragequit - emits RageQuit event', async () => {
      partialRageQuitShares = 20
      const emittedLogs = await moloch.ragequit(partialRageQuitShares, 0, { from: proposal1.applicant })
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

      const { logs } = emittedLogs
      const log = logs[0]
  
      assert.equal(log.event, 'Ragequit')
      //event Ragequit(address indexed memberAddress, uint256 sharesToBurn, uint256 lootToBurn);
      
      const {memberAddress,sharesToBurn,lootToBurn} = log.args
      assert.equal(memberAddress, proposal1.applicant)
      assert.equal(sharesToBurn, partialRageQuitShares)
      assert.equal(lootToBurn, 0)
    })

  })

  describe('withdraw events', async () => {
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
    it('require success - partial withdraw - emits Withdraw event', async () => {
      const withdrawAmount = 10;
      const emittedLogs = await  moloch.withdrawBalance(depositToken.address, withdrawAmount, { from: proposal1.applicant })

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
      
      const { logs } = emittedLogs
      const log = logs[0]
  
      //event Withdraw(address indexed memberAddress, address token, uint256 amount);
      const {memberAddress,token, amount } = log.args
      assert.equal(log.event, 'Withdraw')
      assert.equal(memberAddress, proposal1.applicant )
      assert.equal(token, depositToken.address)
      assert.equal(amount, withdrawAmount)
    })
    //TODO: test withdrawBalances? should still be fine since it just calls withdraw internally and is covered in other tests
  })

  describe('cancelProposal events', () => {
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
      await verifyFlags({
        moloch: moloch,
        proposalId: firstProposalIndex,
        expectedFlags: [false, false, false, false, false, false]
      })

    })

    it('require success - emits CancelProposal event by member', async () => {

      const emittedLogs = await  moloch.cancelProposal(firstProposalIndex, { from: proposal1.applicant })

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

      
      const { logs } = emittedLogs
      const log = logs[0]
  
      //event CancelProposal(uint256 indexed proposalId, address memberAddress, address applicantAddress);
      const {proposalId,applicantAddress} = log.args
      assert.equal(log.event, 'CancelProposal')
      assert.equal(proposalId, firstProposalIndex)
      assert.equal(applicantAddress, proposal1.applicant)
    })

    it('require fails -  CancelProposal reverts if cancelled by new delegate', async () => {

      await moloch.updateDelegateKey(processor, { from: summoner })

      const emittedLogs = await  moloch.cancelProposal(firstProposalIndex, { from: processor }).should.be.rejectedWith(revertMessages.cancelProposalSolelyTheProposerCanCancel)

    })
  })

  describe('updateDelegateKey', () => {
    it('require success - emits UpdateDelegateKey event', async () => {
      const emittedLogs = await  moloch.updateDelegateKey(processor, { from: summoner })

      await verifyMember({
        moloch: moloch,
        member: summoner,
        expectedDelegateKey: processor,
        expectedShares: 1,
        expectedMemberAddressByDelegateKey: summoner
      })

      
      const { logs } = emittedLogs
      const log = logs[0]
  
      //event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey);
      const {memberAddress, newDelegateKey } = log.args
      assert.equal(log.event, 'UpdateDelegateKey')
      assert.equal(memberAddress, summoner)
      assert.equal(newDelegateKey, processor)
    })

  })

})
