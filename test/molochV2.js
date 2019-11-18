// v2 test spec
//
// Process
// 0. Read the Guide
//  - https://github.com/MolochVentures/moloch/blob/master/test/README.md DONE
// 1. Remove obviated code - WIP
// 2. Update tests in logical order (constructor, submitProposal, etc..)
//  - update test code based on changelog to get each test passing
// 3. Add tests for new functions
// 4. Add tests for new edge cases
//
// Cleanup
// - remove abort tests DONE
// - update to new proposal mapping data structure WIP - needs testing
// - update to new proposal.flags data structure WIP - needs testing
// - update to using a base token instead of default moloch.approvedToken - WIP - using TokenAlpha
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
const safeUtils = require('./utilsPersonalSafe')
const utils = require('./utils')

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')
const ProxyFactory = artifacts.require('./ProxyFactory')
const GnosisSafe = artifacts.require('./GnosisSafe')

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

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const notOwnedAddress = '0x0000000000000000000000000000000000000002'
const _1e18 = new BN('1000000000000000000') // 1e18

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

let moloch, guildBank, tokenAlpha, tokenBeta, proxyFactory, gnosisSafeMasterCopy, gnosisSafe
let proposal1, proposal2

// used by gnosis safe
const CALL = 0

const initSummonerBalance = 100

contract('Moloch', ([creator, summoner, applicant1, applicant2, processor, delegateKey, ...otherAccounts]) => {
  let snapshotId

  // VERIFY SUBMIT PROPOSAL
  const verifySubmitProposal = async (
    proposal,
    proposalIndex,
    proposer,
    options
  ) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested
      ? options.initialTotalSharesRequested
      : 0
    const initialTotalShares = options.initialTotalShares
      ? options.initialTotalShares
      : 0
    const initialProposalLength = options.initialProposalLength
      ? options.initialProposalLength
      : 0
    const initialMolochBalance = options.initialMolochBalance
      ? options.initialMolochBalance
      : 0
    const initialApplicantBalance = options.initialApplicantBalance
      ? options.initialApplicantBalance
      : 0
    const initialProposerBalance = options.initialProposerBalance
      ? options.initialProposerBalance
      : 0

    const expectedStartingPeriod = options.expectedStartingPeriod
      ? options.expectedStartingPeriod
      : 1

    const proposalData = await moloch.proposalQueue.call(proposalIndex)

    assert.equal(proposalData.applicant, proposal.applicant)
    assert.equal(proposalData.proposer, proposer)
    assert.equal(proposalData.sponsor, proposal.sponsor)

    if (typeof proposal.sharesRequested === 'number') {
      assert.equal(proposalData.sharesRequested, proposal.sharesRequested)
    } else {
      // for testing overflow boundary with BNs
      assert(proposalData.sharesRequested.eq(proposal.sharesRequested))
    }
    assert.equal(proposalData.tributeOffered, proposal.tributeOffered)
    assert.equal(proposalData.tributeToken, proposal.tributeToken)

    assert.equal(proposalData.paymentRequested, proposal.paymentRequested)
    assert.equal(proposalData.paymentToken, proposal.paymentToken)

    assert.equal(proposalData.startingPeriod, expectedStartingPeriod)
    assert.equal(proposalData.yesVotes, 0)
    assert.equal(proposalData.noVotes, 0)

    // 0. sponsored - true only if the proposal has been submitted by a member
    // 1. processed - true only if the proposal has been processed
    // 2. didPass - true only if the proposal passed
    // 3. cancelled - true only if the proposer called cancelProposal before a member sponsored the proposal
    // 4. whitelist - true only if this is a whitelist proposal, NOTE - tributeToken is target of whitelist
    // 5. guildkick - true only if this is a guild kick proposal, NOTE - applicant is target of guild kick

    assert.equal(proposalData.flags[0], proposal.flags[0])
    assert.equal(proposalData.flags[1], proposal.flags[1])
    assert.equal(proposalData.flags[2], proposal.flags[2])
    assert.equal(proposalData.flags[3], proposal.flags[3])
    assert.equal(proposalData.flags[4], proposal.flags[4])
    assert.equal(proposalData.flags[5], proposal.flags[5])

    assert.equal(proposalData.details, proposal.details)
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0)

    const totalSharesRequested = await moloch.totalSharesRequested()
    if (typeof proposal.sharesRequested === 'number') {
      assert.equal(
        totalSharesRequested,
        proposal.sharesRequested + initialTotalSharesRequested
      )
    } else {
      // for testing overflow boundary with BNs
      assert(
        totalSharesRequested.eq(
          proposal.sharesRequested.add(new BN(initialTotalSharesRequested))
        )
      )
    }

    const totalShares = await moloch.totalShares()
    assert.equal(totalShares, initialTotalShares)

    const proposalQueueLength = await moloch.getProposalQueueLength()
    assert.equal(proposalQueueLength, initialProposalLength + 1)

    const molochBalance = await tokenAlpha.balanceOf(moloch.address)
    assert.equal(
      molochBalance,
      initialMolochBalance + proposal.tokenTribute + deploymentConfig.PROPOSAL_DEPOSIT
    )

    const applicantBalance = await tokenAlpha.balanceOf(proposal.applicant)
    assert.equal(
      applicantBalance,
      initialApplicantBalance - proposal.tokenTribute
    )

    const proposerBalance = await tokenAlpha.balanceOf(proposer)
    assert.equal(
      proposerBalance,
      initialProposerBalance - deploymentConfig.PROPOSAL_DEPOSIT
    )
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (
    proposal,
    proposalIndex,
    memberAddress,
    expectedVote,
    options
  ) => {
    const initialYesVotes = options.initialYesVotes
      ? options.initialYesVotes
      : 0
    const initialNoVotes = options.initialNoVotes ? options.initialNoVotes : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote
      ? options.expectedMaxSharesAtYesVote
      : 0

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(
      proposalData.yesVotes,
      initialYesVotes + (expectedVote === 1 ? 1 : 0)
    )
    assert.equal(
      proposalData.noVotes,
      initialNoVotes + (expectedVote === 1 ? 0 : 1)
    )
    assert.equal(
      proposalData.maxTotalSharesAtYesVote,
      expectedMaxSharesAtYesVote
    )

    const memberVote = await moloch.getMemberProposalVote(
      memberAddress,
      proposalIndex
    )
    assert.equal(memberVote, expectedVote)
  }

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (
    proposal,
    proposalIndex,
    proposer,
    processor,
    options
  ) => {
    // eslint-disable-next-line no-unused-vars
    const initialTotalSharesRequested = options.initialTotalSharesRequested
      ? options.initialTotalSharesRequested
      : 0
    const initialTotalShares = options.initialTotalShares
      ? options.initialTotalShares
      : 0
    const initialApplicantShares = options.initialApplicantShares
      ? options.initialApplicantShares
      : 0 // 0 means new member, > 0 means existing member
    const initialMolochBalance = options.initialMolochBalance
      ? options.initialMolochBalance
      : 0
    const initialGuildBankBalance = options.initialGuildBankBalance
      ? options.initialGuildBankBalance
      : 0
    const initialApplicantBalance = options.initialApplicantBalance
      ? options.initialApplicantBalance
      : 0
    const initialProposerBalance = options.initialProposerBalance
      ? options.initialProposerBalance
      : 0
    const initialProcessorBalance = options.initialProcessorBalance
      ? options.initialProcessorBalance
      : 0
    const expectedYesVotes = options.expectedYesVotes
      ? options.expectedYesVotes
      : 0
    const expectedNoVotes = options.expectedNoVotes
      ? options.expectedNoVotes
      : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote
      ? options.expectedMaxSharesAtYesVote
      : 0
    const expectedFinalTotalSharesRequested = options.expectedFinalTotalSharesRequested
      ? options.expectedFinalTotalSharesRequested
      : 0
    const didPass =
      typeof options.didPass === 'boolean' ? options.didPass : true
    const aborted =
      typeof options.aborted === 'boolean' ? options.aborted : false

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.yesVotes, expectedYesVotes)
    assert.equal(proposalData.noVotes, expectedNoVotes)
    assert.equal(
      proposalData.maxTotalSharesAtYesVote,
      expectedMaxSharesAtYesVote
    )
    assert.equal(proposalData.processed, true)
    assert.equal(proposalData.didPass, didPass)
    assert.equal(proposalData.aborted, aborted)

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(totalSharesRequested, expectedFinalTotalSharesRequested)

    const totalShares = await moloch.totalShares()
    assert.equal(
      totalShares,
      didPass && !aborted
        ? initialTotalShares + proposal.sharesRequested
        : initialTotalShares
    )

    const molochBalance = await tokenAlpha.balanceOf(moloch.address)
    assert.equal(
      molochBalance,
      initialMolochBalance - proposal.tokenTribute - deploymentConfig.PROPOSAL_DEPOSIT
    )

    const guildBankBalance = await tokenAlpha.balanceOf(guildBank.address)
    assert.equal(
      guildBankBalance,
      didPass && !aborted
        ? initialGuildBankBalance + proposal.tokenTribute
        : initialGuildBankBalance
    )

    // proposer and applicant are different
    if (proposer !== proposal.applicant) {
      const applicantBalance = await tokenAlpha.balanceOf(proposal.applicant)
      assert.equal(
        applicantBalance,
        didPass && !aborted
          ? initialApplicantBalance
          : initialApplicantBalance + proposal.tokenTribute
      )

      const proposerBalance = await tokenAlpha.balanceOf(proposer)
      assert.equal(
        proposerBalance,
        initialProposerBalance +
        deploymentConfig.PROPOSAL_DEPOSIT -
        deploymentConfig.PROCESSING_REWARD
      )

      // proposer is applicant
    } else {
      const proposerBalance = await tokenAlpha.balanceOf(proposer)
      const expectedBalance =
        didPass && !aborted
          ? initialProposerBalance +
          deploymentConfig.PROPOSAL_DEPOSIT -
          deploymentConfig.PROCESSING_REWARD
          : initialProposerBalance +
          deploymentConfig.PROPOSAL_DEPOSIT -
          deploymentConfig.PROCESSING_REWARD +
          proposal.tokenTribute
      assert.equal(proposerBalance, expectedBalance)
    }

    const processorBalance = await tokenAlpha.balanceOf(processor)
    assert.equal(
      processorBalance,
      initialProcessorBalance + deploymentConfig.PROCESSING_REWARD
    )

    if (didPass && !aborted) {
      // existing member
      if (initialApplicantShares > 0) {
        const memberData = await moloch.members(proposal.applicant)
        assert.equal(
          memberData.shares,
          proposal.sharesRequested + initialApplicantShares
        )

        // new member
      } else {
        const newMemberData = await moloch.members(proposal.applicant)
        assert.equal(newMemberData.delegateKey, proposal.applicant)
        assert.equal(newMemberData.shares, proposal.sharesRequested)
        assert.equal(newMemberData.exists, true)
        assert.equal(newMemberData.highestIndexYesVote, 0)

        const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(
          proposal.applicant
        )
        assert.equal(newMemberAddressByDelegateKey, proposal.applicant)
      }
    }
  }

  // VERIFY UPDATE DELEGATE KEY
  const verifyUpdateDelegateKey = async (
    memberAddress,
    oldDelegateKey,
    newDelegateKey
  ) => {
    const member = await moloch.members(memberAddress)
    assert.equal(member.delegateKey, newDelegateKey)
    const memberByOldDelegateKey = await moloch.memberAddressByDelegateKey(
      oldDelegateKey
    )
    assert.equal(memberByOldDelegateKey, zeroAddress)
    const memberByNewDelegateKey = await moloch.memberAddressByDelegateKey(
      newDelegateKey
    )
    assert.equal(memberByNewDelegateKey, memberAddress)
  }

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

    proxyFactory = await ProxyFactory.new()
    gnosisSafeMasterCopy = await GnosisSafe.new()

    await gnosisSafeMasterCopy.setup([notOwnedAddress], 1, zeroAddress, '0x', zeroAddress, 0, zeroAddress)
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
      details: 'all hail moloch'
    }

    tokenAlpha.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  it('verify deployment parameters', async () => {
    // eslint-disable-next-line no-unused-vars
    const now = await blockTime()

    const depositTokenAddress = await moloch.depositTokenAddress()
    assert.equal(depositTokenAddress, tokenAlpha.address)

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

    const abortWindow = await moloch.abortWindow()
    assert.equal(+abortWindow, deploymentConfig.ABORT_WINDOW_IN_PERIODS)

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
  })

  describe('submitProposal', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tokenTribute, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tokenTribute, {
        from: proposal1.applicant
      })
    })

    it('happy case', async () => {
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: proposal1.tributeOffered,
        initialProposerBalance: initSummonerBalance
      })
    })

    describe('uint overflow boundary', () => {
      it('require fail - uint overflow', async () => {
        proposal1.sharesRequested = _1e18
        await moloch
          .submitProposal(
            proposal1.applicant,
            proposal1.sharesRequested,
            proposal1.tributeOffered,
            proposal1.tributeToken,
            proposal1.paymentRequested,
            proposal1.paymentToken,
            proposal1.details,
            { from: summoner }
          )
          .should.be.rejectedWith('too many shares requested')
      })

      it('success - request 1 less share than the overflow limit', async () => {
        proposal1.sharesRequested = _1e18.sub(new BN(1)) // 1 less
        await moloch.submitProposal(
          proposal1.applicant,
          proposal1.sharesRequested,
          proposal1.tributeOffered,
          proposal1.tributeToken,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details,
          { from: summoner }
        )
        await verifySubmitProposal(proposal1, 0, summoner, {
          initialTotalShares: 1,
          initialApplicantBalance: proposal1.tributeOffered,
          initialProposerBalance: initSummonerBalance
        })
      })
    })

    it('require fail - insufficient proposal deposit', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, { from: summoner })

      // SafeMath reverts in ERC20.transferFrom
      await moloch
        .submitProposal(
          proposal1.applicant,
          proposal1.sharesRequested,
          proposal1.tributeOffered,
          proposal1.tributeToken,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details
        )
        .should.be.rejectedWith(SolRevert)
    })

    it('require fail - insufficient applicant tokens', async () => {
      await tokenAlpha.decreaseAllowance(moloch.address, 1, {
        from: proposal1.applicant
      })

      // SafeMath reverts in ERC20.transferFrom
      await moloch
        .submitProposal(
          proposal1.applicant,
          proposal1.sharesRequested,
          proposal1.tributeOffered,
          proposal1.tributeToken,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details
        )
        .should.be.rejectedWith(SolRevert)
    })

    it('modifier - delegate', async () => {
      await moloch
        .submitProposal(
          proposal1.applicant,
          proposal1.sharesRequested,
          proposal1.tributeOffered,
          proposal1.tributeToken,
          proposal1.paymentRequested,
          proposal1.paymentToken,
          proposal1.details,
          { from: creator }
        )
        .should.be.rejectedWith('not a delegate')
    })

    it('edge case - proposal tribute is 0', async () => {
      const unspentTribute = proposal1.tokenTribute
      proposal1.tributeOffered = 0
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: unspentTribute, // should still have all tribute funds
        initialProposerBalance: initSummonerBalance
      })
    })

    it('edge case - shares requested is 0', async () => {
      proposal1.sharesRequested = 0
      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: proposal1.tokenTribute,
        initialProposerBalance: initSummonerBalance
      })
    })
  })

  describe('submitVote', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
      await verifySubmitVote(proposal1, 0, summoner, 1, {
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 2, { from: summoner })
      await verifySubmitVote(proposal1, 0, summoner, 2, {})
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch
        .submitVote(1, 1, { from: summoner })
        .should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - voting period has not started', async () => {
      // don't move the period forward
      await moloch
        .submitVote(0, 1, { from: summoner })
        .should.be.rejectedWith('voting period has not started')
    })

    describe('voting period boundary', () => {
      it('require fail - voting period has expired', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS + 1)
        await moloch
          .submitVote(0, 1, { from: summoner })
          .should.be.rejectedWith('voting period has expired')
      })

      it('success - vote 1 period before voting period expires', async () => {
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moloch.submitVote(0, 1, { from: summoner })
        await verifySubmitVote(proposal1, 0, summoner, 1, {
          expectedMaxSharesAtYesVote: 1
        })
      })
    })

    it('require fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
      await moloch
        .submitVote(0, 1, { from: summoner })
        .should.be.rejectedWith('member has already voted on this proposal')
    })

    it('require fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch
        .submitVote(0, 0, { from: summoner })
        .should.be.rejectedWith('vote must be either Yes or No')
      // vote out of bounds
      await moloch
        .submitVote(0, 3, { from: summoner })
        .should.be.rejectedWith('uintVote must be less than 3')
    })

    it('modifier - delegate', async () => {
      await moveForwardPeriods(1)
      await moloch
        .submitVote(0, 1, { from: creator })
        .should.be.rejectedWith('not a delegate')
    })
  })

  describe('processProposal', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
    })

    it('happy case', async () => {
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - deploymentConfig.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch
        .processProposal(1)
        .should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - proposal is not ready to be processed', async () => {
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS - 1)
      await moloch
        .processProposal(0)
        .should.be.rejectedWith('proposal is not ready to be processed')
    })

    it('require fail - proposal has already been processed', async () => {
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await moloch
        .processProposal(0)
        .should.be.rejectedWith('proposal has already been processed')
    })
  })

  describe('processProposal - edge cases', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
      await moveForwardPeriods(1)
    })

    it('proposal fails when no votes > yes votes', async () => {
      await moloch.submitVote(0, 2, { from: summoner })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - deploymentConfig.PROPOSAL_DEPOSIT,
        expectedNoVotes: 1,
        expectedMaxSharesAtYesVote: 0,
        didPass: false // proposal should not pass
      })
    })

    it('force resets members delegate key if assigned to newly admitted applicant', async () => {
      await moloch.submitVote(0, 1, { from: summoner })

      const newDelegateKey = proposal1.applicant
      await moloch.updateDelegateKey(newDelegateKey, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - deploymentConfig.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })

      // verify that the summoner delegate key has been reset
      const summonerData = await moloch.members(summoner)
      assert.equal(summonerData.delegateKey, summoner)

      const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(
        summoner
      )
      assert.equal(summonerAddressByDelegateKey, summoner)
    })
  })

  describe('processProposal - more edge cases', () => {
    beforeEach(async () => {
      proposal1.applicant = summoner

      await tokenAlpha.transfer(summoner, 10, { from: creator }) // summoner has 100 init, add 10 for deposit + tribute
      await tokenAlpha.approve(moloch.address, 110, { from: summoner }) // approve enough for deposit + tribute

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
      await moveForwardPeriods(1)
    })

    it('when applicant is an existing member, adds to their shares', async () => {
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialApplicantShares: 1, // existing member with 1 share
        initialMolochBalance: 110,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })
  })

  describe('processProposal + abort', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
    })

    it('proposal passes when applicant does not abort', async () => {
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - deploymentConfig.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('proposal fails when applicant aborts', async () => {
      await moloch.abort(0, { from: proposal1.applicant })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - deploymentConfig.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1,
        didPass: false, // false because aborted
        aborted: true // proposal was aborted
      })
    })
  })

  describe('ragequit', () => {
    beforeEach(async () => {
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tokenTribute, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tokenTribute, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
    })

    it('happy case', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(1, { from: summoner })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, proposal1.sharesRequested)

      const summonerData = await moloch.members(summoner)
      assert.equal(summonerData.shares, 0)
      assert.equal(summonerData.exists, true)
      assert.equal(summonerData.highestIndexYesVote, 0)

      // can divide tokenTribute by 2 because 2 shares
      const summonerBalance = await tokenAlpha.balanceOf(summoner)
      const expectedBalance =
        initSummonerBalance -
        deploymentConfig.PROCESSING_REWARD +
        proposal1.tokenTribute / 2
      assert.equal(+summonerBalance.toString(), expectedBalance)

      const molochBalance = await tokenAlpha.balanceOf(moloch.address)
      assert.equal(molochBalance, 0)

      // guild bank has the other half of the funds
      const guildBankBalance = await tokenAlpha.balanceOf(guildBank.address)
      assert.equal(guildBankBalance, proposal1.tokenTribute / 2)
    })

    it('require fail - insufficient shares', async () => {
      await moloch.processProposal(0)
      await moloch
        .ragequit(2, { from: summoner })
        .should.be.rejectedWith('insufficient shares')
    })

    it('require fail - cant ragequit yet', async () => {
      // skip processing the proposal
      await moloch
        .ragequit(1, { from: summoner })
        .should.be.rejectedWith(
          'cant ragequit until highest index proposal member voted YES on is processed'
        )
    })

    it('modifier - member - non-member', async () => {
      await moloch.processProposal(0)
      await moloch
        .ragequit(1, { from: creator })
        .should.be.rejectedWith('not a member')
    })

    it('modifier - member - member ragequit', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(1, { from: summoner })
      await moloch
        .ragequit(1, { from: summoner })
        .should.be.rejectedWith('not a member')
    })

    it('edge case - weth sent to guild bank can be withdrawn via ragequit', async () => {
      await moloch.processProposal(0)

      await tokenAlpha.transfer(guildBank.address, 100, { from: creator })
      const guildBankBalance1 = await tokenAlpha.balanceOf(guildBank.address)
      assert.equal(guildBankBalance1, proposal1.tokenTribute + 100)

      await moloch.ragequit(1, { from: summoner })

      const summonerBalance = await tokenAlpha.balanceOf(summoner)
      const expectedBalance =
        initSummonerBalance - deploymentConfig.PROCESSING_REWARD + guildBankBalance1 / 2
      assert.equal(+summonerBalance.toString(), expectedBalance)

      const guildBankBalance2 = await tokenAlpha.balanceOf(guildBank.address)
      assert.equal(guildBankBalance2, guildBankBalance1 / 2)
    })

    // TODO how might guildbank withdrawal fail?
    // - it could uint256 overflow
  })

  describe('updateDelegateKey', () => {
    beforeEach(async () => {
      // vote in a new member to test failing requires
      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
    })

    it('happy case', async () => {
      await moloch.updateDelegateKey(creator, { from: summoner })
      await verifyUpdateDelegateKey(summoner, summoner, creator)
    })

    it('require fail - newDelegateKey cannot be 0', async () => {
      await moloch
        .updateDelegateKey(zeroAddress, { from: summoner })
        .should.be.rejectedWith('newDelegateKey cannot be 0')
    })

    it('require fail - cant overwrite existing members', async () => {
      await moloch
        .updateDelegateKey(proposal1.applicant, { from: summoner })
        .should.be.rejectedWith('cant overwrite existing members')
    })

    it('require fail - cant overwrite existing delegate keys', async () => {
      // first set the p1 applicant delegate key to the creator
      await moloch.updateDelegateKey(creator, { from: proposal1.applicant })
      // then try to overwrite it
      await moloch
        .updateDelegateKey(creator, { from: summoner })
        .should.be.rejectedWith('cant overwrite existing delegate keys')
    })

    it('modifier - member', async () => {
      await moloch
        .updateDelegateKey(creator, { from: creator })
        .should.be.rejectedWith('not a member')
    })

    it('edge - can reset the delegatekey to your own member address', async () => {
      // first set the delegate key to the creator
      await moloch.updateDelegateKey(creator, { from: summoner })
      await verifyUpdateDelegateKey(summoner, summoner, creator)
      // then reset it to the summoner
      await moloch.updateDelegateKey(summoner, { from: summoner })
      await verifyUpdateDelegateKey(summoner, creator, summoner)
    })
  })

  describe('guildbank.withdraw', () => {
    it('modifier - owner', async () => {
      await guildBank
        .withdraw(summoner, 1, 1)
        .should.be.rejectedWith(SolRevert)
    })
  })

  describe('two proposals', () => {
    beforeEach(async () => {
      proposal2 = {
        applicant: applicant2,
        sharesRequested: 2,
        tributeOffered: 200,
        tributeToken: tokenAlpha.address,
        paymentRequested: 0,
        paymentToken: tokenAlpha.address,
        details: ''
      }

      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await tokenAlpha.transfer(proposal2.applicant, proposal2.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, proposal2.tributeOffered, {
        from: proposal2.applicant
      })

      await tokenAlpha.approve(moloch.address, 20, { from: summoner })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )
    })

    it('processProposal require fail - previous proposal must be processed', async () => {
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: summoner }
      )
      await moveForwardPeriods(2)
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch
        .processProposal(1)
        .should.be.rejectedWith('previous proposal must be processed')

      // works after the first proposal is processed
      await moloch.processProposal(0)
      await moloch.processProposal(1)
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.processed, true)
    })

    it('submit proposal - starting period is correctly set with gaps in proposal queue', async () => {
      await moveForwardPeriods(4) // 0 -> 4
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: summoner }
      )
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.startingPeriod, 5)
    })

    it('submit proposal - starting period is correctly set when another proposal is ahead in the queue', async () => {
      await moveForwardPeriods(1) // 0 -> 1
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: summoner }
      )
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.startingPeriod, 2)
    })

    it('submitVote - yes - dont update highestIndexYesVote', async () => {
      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: summoner }
      )
      await moveForwardPeriods(2)

      // vote yes on proposal 2
      await moloch.submitVote(1, 1, { from: summoner })
      const memberData1 = await moloch.members(summoner)
      assert.equal(memberData1.highestIndexYesVote, 1)
      await verifySubmitVote(proposal2, 1, summoner, 1, {
        expectedMaxSharesAtYesVote: 1
      })

      // vote yes on proposal 1
      await moloch.submitVote(0, 1, { from: summoner })
      await verifySubmitVote(proposal1, 0, summoner, 1, {
        expectedMaxSharesAtYesVote: 1
      })

      // highestIndexYesVote should stay the same
      const memberData2 = await moloch.members(summoner)
      assert.equal(memberData2.highestIndexYesVote, 1)
    })
  })

  describe('two members', () => {
    beforeEach(async () => {
      // 3 so total shares is 4 and we can test ragequit + dilution boundary
      proposal1.sharesRequested = 3

      await tokenAlpha.transfer(proposal1.applicant, proposal1.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      await tokenAlpha.approve(moloch.address, proposal1.tributeOffered, {
        from: proposal1.applicant
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: summoner }
      )

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })

      proposal2 = {
        applicant: applicant2,
        tokenTribute: 200,
        sharesRequested: 2,
        details: ''
      }

      await tokenAlpha.transfer(proposal2.applicant, proposal2.tributeOffered, {
        from: creator
      })
      await tokenAlpha.approve(moloch.address, proposal2.tributeOffered, {
        from: proposal2.applicant
      })

      await tokenAlpha.approve(moloch.address, 10, { from: summoner })

      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: summoner }
      )
      await moveForwardPeriods(1)
    })

    it('proposal fails when dilution bound is exceeded', async () => {
      const member1 = proposal1.applicant

      await moloch.submitVote(1, 1, { from: summoner })
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.maxTotalSharesAtYesVote, 4)

      await moloch.ragequit(3, { from: member1 })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1, { from: processor })

      await verifyProcessProposal(proposal2, 1, summoner, processor, {
        initialTotalSharesRequested: 2,
        initialTotalShares: 1, // 4 -> 1
        initialMolochBalance: 210,
        initialGuildBankBalance: 25, // 100 -> 25
        initialProposerBalance:
          initSummonerBalance -
          deploymentConfig.PROPOSAL_DEPOSIT -
          deploymentConfig.PROCESSING_REWARD,
        initialProcessorBalance: 1,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 4,
        didPass: false
      })
    })

    it('proposal passes when dilution bound is not exceeded', async () => {
      const member1 = proposal1.applicant

      await moloch.submitVote(1, 1, { from: summoner })
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.maxTotalSharesAtYesVote, 4)

      await moloch.ragequit(2, { from: member1 })
      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1, { from: processor })

      await verifyProcessProposal(proposal2, 1, summoner, processor, {
        initialTotalSharesRequested: 2,
        initialTotalShares: 2, // 4 -> 2
        initialMolochBalance: 210,
        initialGuildBankBalance: 50, // 100 -> 50
        initialProposerBalance:
          initSummonerBalance -
          deploymentConfig.PROPOSAL_DEPOSIT -
          deploymentConfig.PROCESSING_REWARD,
        initialProcessorBalance: 1,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 4,
        didPass: true
      })
    })
  })

  describe('Gnosis Safe Integration', () => {
    // These tests fail when running solidity-coverage
    if (process.env.RUNNING_COVERAGE) {
      return
    }

    let executor
    let lw

    beforeEach(async () => {
      executor = creator // used to execute gnosis safe transactions

      // Create lightwallet
      lw = await utils.createLightwallet()
      // Create Gnosis Safe

      let gnosisSafeData = await gnosisSafeMasterCopy.contract.methods.setup([lw.accounts[0], lw.accounts[1], lw.accounts[2]], 2, zeroAddress, '0x', zeroAddress, 0, zeroAddress).encodeABI()

      gnosisSafe = await utils.getParamFromTxEvent(
        await proxyFactory.createProxy(gnosisSafeMasterCopy.address, gnosisSafeData),
        'ProxyCreation', 'proxy', proxyFactory.address, GnosisSafe, 'create Gnosis Safe'
      )

      // Transfer Tokens to Gnosis Safe
      await tokenAlpha.transfer(gnosisSafe.address, 100, { from: creator })

      // Transfer ETH to Gnosis Safe (because safe pays executor for gas)
      await web3.eth.sendTransaction({
        from: creator,
        to: gnosisSafe.address,
        value: web3.utils.toWei('1', 'ether')
      })

      proposal1.applicant = gnosisSafe.address
    })

    it('sends ether', async () => {
      const initSafeBalance = await web3.eth.getBalance(gnosisSafe.address)
      assert.equal(initSafeBalance, 1000000000000000000)
      await safeUtils.executeTransaction(lw, gnosisSafe, 'executeTransaction withdraw 1 ETH', [lw.accounts[0], lw.accounts[2]], creator, web3.utils.toWei('1', 'ether'), '0x', CALL, summoner)
      const safeBalance = await web3.eth.getBalance(gnosisSafe.address)
      assert.equal(safeBalance, 0)
    })

    it('token approval', async () => {
      let data = await tokenAlpha.contract.methods.approve(moloch.address, 100).encodeABI()
      await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)
      const approvedAmount = await tokenAlpha.allowance(gnosisSafe.address, moloch.address)
      assert.equal(approvedAmount, 100)
    })

    it('abort', async () => {
      // approve 100 eth from safe to moloch
      let data = await tokenAlpha.contract.methods.approve(moloch.address, 100).encodeABI()
      await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)

      // summoner approve for proposal deposit
      await tokenAlpha.approve(moloch.address, 10, { from: summoner })
      // summoner submits proposal for safe
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      // ABORT - gnosis safe aborts
      const abortData = await moloch.contract.methods.abort(0).encodeABI()
      await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, abortData, CALL, executor)
      const abortedProposal = await moloch.proposalQueue.call(0)
      assert.equal(abortedProposal.tokenTribute, 0)
    })

    describe('as a member, can execute all functions', async () => {
      beforeEach(async () => {
        // approve 100 eth from safe to moloch
        let data = await tokenAlpha.contract.methods.approve(moloch.address, 100).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)

        // summoner approves tokens and submits proposal for safe
        await tokenAlpha.approve(moloch.address, 10, { from: summoner })
        await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

        // summoner votes yes for safe
        await moveForwardPeriods(1)
        await moloch.submitVote(0, 1, { from: summoner })

        // fast forward until safe is a member
        await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)
        await moloch.processProposal(0, { from: processor })
      })

      it('submit proposal -> vote -> update delegate -> ragequit', async () => {
        // confirm that the safe is a member
        const safeMemberData = await moloch.members(gnosisSafe.address)
        assert.equal(safeMemberData.exists, true)

        // create a new proposal
        proposal2 = {
          applicant: applicant1,
          sharesRequested: 2,
          tributeOffered: 100,
          tributeToken: tokenAlpha.address,
          paymentRequested: 0,
          paymentToken: tokenAlpha.address,
          details: ''
        }

        // send the applicant 100 tokens and have them do the approval
        await tokenAlpha.transfer(proposal2.applicant, proposal2.tributeOffered, { from: creator })
        await tokenAlpha.approve(moloch.address, proposal2.tributeOffered, { from: proposal2.applicant })

        // safe needs to approve 10 for the deposit (get 10 more from creator)
        await tokenAlpha.transfer(gnosisSafe.address, 10, { from: creator })
        let data = await tokenAlpha.contract.methods.approve(moloch.address, 10).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], tokenAlpha.address, 0, data, CALL, executor)

        // safe submits proposal
        let submitProposalData = await moloch.contract.methods.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'submit proposal to moloch', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, submitProposalData, CALL, executor)

        const expectedStartingPeriod = (await moloch.getCurrentPeriod()).toNumber() + 1
        await verifySubmitProposal(proposal2, 1, gnosisSafe.address, {
          initialTotalShares: 2,
          initialProposalLength: 1,
          initialApplicantBalance: proposal2.tributeOffered,
          initialProposerBalance: 10,
          expectedStartingPeriod: expectedStartingPeriod
        })

        // safe submits vote
        await moveForwardPeriods(1)
        let voteData = await moloch.contract.methods.submitVote(1, 2).encodeABI() // vote no so we can ragequit easier
        await safeUtils.executeTransaction(lw, gnosisSafe, 'submit vote to moloch', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, voteData, CALL, executor)
        await verifySubmitVote(proposal1, 1, gnosisSafe.address, 2, {})

        const newDelegateKey = delegateKey

        // safe updates delegate key
        const updateDelegateData = await moloch.contract.methods.updateDelegateKey(newDelegateKey).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'update delegate key', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, updateDelegateData, CALL, executor)
        await verifyUpdateDelegateKey(gnosisSafe.address, gnosisSafe.address, newDelegateKey)

        // safe ragequits
        const ragequitData = await moloch.contract.methods.ragequit(1).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'ragequit the guild', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, ragequitData, CALL, executor)
        const safeMemberDataAfterRagequit = await moloch.members(gnosisSafe.address)
        assert.equal(safeMemberDataAfterRagequit.exists, true)
        assert.equal(safeMemberDataAfterRagequit.shares, 0)

        const safeBalanceAfterRagequit = await tokenAlpha.balanceOf(gnosisSafe.address)
        assert.equal(safeBalanceAfterRagequit, 50) // 100 eth & 2 shares at time of ragequit
      })
    })
  })
})
