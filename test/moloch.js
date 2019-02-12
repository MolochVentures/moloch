/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

// TODO
// 1. processProposal if branches
//   - aborted
//     - summoner votes YES, but proposal still fails b/c abort
//   - dilutionBound (mass ragequit)
//     - 1 share, summoner ragequits
//   - success -> new member (happy case)
//     - force reset existing delegateKey
//       1. summoner submits
//       2. summoner votes
//       3. summoner updates delegate key to applicant
//       4. fast forward -> processProposal
//       5. verify force reset
//   - success -> existing member
//     - summoner submits proposal for themselves
//   - failure
//     - summoner votes no
// 2. boundary conditions (can all be tested as part of function unit tests)
//   - submitVote on first / last possible period (error, first, last, error)
//   - abort on first / last possible period
//   - attempt to process proposal 1 period before ready
//   - attempt to ragequit 1 period before ready
// 3. helper functions
//   - add members
//     - member (# shares, address, tribute)
//     - sends tokens from creator to each member
//     - sends enough tokens to summoner for deposits
//     - submits all proposals
//     - fast forwards periods on a loop
//       - if the proposal just entered voting period, vote yes
//       - if proposal can be processed, process it
//       - if the last proposal has been processed, exit
// 4. dilution bound with multiple members / boundary condition
//   - 4 shares (could be 2 members with 1 and 3)
//     - 3 ragequit
// 5. test gaps in the queue (starting period for submitProposal)
// 6. wETH externally deposited to guild bank can still be withdrawn
// 7. events
// 8. simulation
//   - 100 proposals
//     - X new members w/ tribute
//     - Y existing members
//     - Z pure grants
//   - everyone ragequits
//   - maybe add verifications for abort / ragequit
// 9. old gnosis multisig
//   - as delegateKey
//   - as memberAddress

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const GnosisSafe = artifacts.require("./GnosisSafePersonalEdition.sol")
const ProxyFactory = artifacts.require("./ProxyFactory.sol")

const utils = require('./utils')
const safeUtils = require('./utilsPersonalSafe')

const config = require('../migrations/config.json')

const abi = require('web3-eth-abi')

const HttpProvider = require(`ethjs-provider-http`)
const EthRPC = require(`ethjs-rpc`)
const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'))

const BigNumber = web3.BigNumber

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const SolRevert = 'VM Exception while processing transaction: revert'
const InvalidOpcode = 'VM Exception while processing transaction: invalid opcode'

const zeroAddress = '0x0000000000000000000000000000000000000000'

async function blockTime() {
  return (await web3.eth.getBlock('latest')).timestamp
}

function getEventParams(tx, event) {
  if (tx.logs.length > 0) {
    for (let idx=0; idx < tx.logs.length; idx++) {
      if (tx.logs[idx].event == event) {
        return tx.logs[idx].args
      }
    }
  }
  return false
}

async function snapshot() {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_snapshot`}, (err, result)=> {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function restore(snapshotId) {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_revert`, params: [snapshotId]}, (err, result) => {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function forceMine() {
  return await ethRPC.sendAsync({method: `evm_mine`}, (err)=> {});
}

async function blockTime() {
  return await web3.eth.getBlock('latest').timestamp
}

async function moveForwardPeriods(periods) {
  const blocktimestamp = await blockTime()
  const goToTime = config.PERIOD_DURATION_IN_SECONDS * periods
  await ethRPC.sendAsync({
    jsonrpc:'2.0', method: `evm_increaseTime`,
    params: [goToTime],
    id: 0
  }, (err)=> {`error increasing time`});
  await forceMine()
  const updatedBlocktimestamp = await blockTime()
  return true
}

let moloch, guildBank, token
let proxyFactory, gnosisSafeMasterCopy, gnosisSafe, lw, executor
let proposal1

// used by gnosis safe
const CALL = 0

const initSummonerBalance = 100

contract('Moloch', accounts => {
  let snapshotId

  // VERIFY SUBMIT PROPOSAL
  const verifySubmitProposal = async (proposal, proposalIndex, proposer, options) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested ? options.initialTotalSharesRequested : 0
    const initialTotalShares = options.initialTotalShares ? options.initialTotalShares : 0
    const initialProposalLength = options.initialProposalLength ? options.initialProposalLength : 0
    const initialMolochBalance = options.initialMolochBalance ? options.initialMolochBalance : 0
    const initialApplicantBalance = options.initialApplicantBalance ? options.initialApplicantBalance : 0
    const initialProposerBalance = options.initialProposerBalance ? options.initialProposerBalance : 0

    const expectedStartingPeriod = options.expectedStartingPeriod ? options.expectedStartingPeriod : 1

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.proposer, proposer)
    assert.equal(proposalData.applicant, proposal.applicant)
    assert.equal(proposalData.sharesRequested, proposal.sharesRequested)
    assert.equal(proposalData.startingPeriod, expectedStartingPeriod)
    assert.equal(proposalData.yesVotes, 0)
    assert.equal(proposalData.noVotes, 0)
    assert.equal(proposalData.processed, false)
    assert.equal(proposalData.didPass, false)
    assert.equal(proposalData.aborted, false)
    assert.equal(proposalData.tokenTribute, proposal.tokenTribute)
    assert.equal(proposalData.details, proposal.details)
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0)

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(totalSharesRequested, proposal.sharesRequested + initialTotalSharesRequested)

    const totalShares = await moloch.totalShares()
    assert.equal(totalShares, initialTotalShares)

    const proposalQueueLength = await moloch.getProposalQueueLength()
    assert.equal(proposalQueueLength, initialProposalLength + 1)

    const molochBalance = await token.balanceOf(moloch.address)
    assert.equal(molochBalance, initialMolochBalance + proposal.tokenTribute + config.PROPOSAL_DEPOSIT)

    const applicantBalance = await token.balanceOf(proposal.applicant)
    assert.equal(applicantBalance, initialApplicantBalance - proposal.tokenTribute)

    const proposerBalance = await token.balanceOf(proposer)
    assert.equal(proposerBalance, initialProposerBalance - config.PROPOSAL_DEPOSIT)
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (proposal, proposalIndex, memberAddress, expectedVote, options) => {
    const initialYesVotes = options.initialYesVotes ? options.initialYesVotes : 0
    const initialNoVotes = options.initialNoVotes ? options.initialNoVotes : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote ? options.expectedMaxSharesAtYesVote : 0

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.yesVotes, initialYesVotes + (expectedVote == 1 ? 1 : 0))
    assert.equal(proposalData.noVotes, initialNoVotes + (expectedVote == 1 ? 0 : 1))
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)

    const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
    assert.equal(memberVote, expectedVote)
  }

  // VERIFY PROCESS PROPOSAL
  const verifyProcessProposal = async (proposal, proposalIndex, proposer, options) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested ? options.initialTotalSharesRequested : 0
    const initialTotalShares = options.initialTotalShares ? options.initialTotalShares : 0
    const initialMolochBalance = options.initialMolochBalance ? options.initialMolochBalance : 0
    const initialGuildBankBalance = options.initialGuildBankBalance ? options.initialGuildBankBalance : 0
    const initialApplicantBalance = options.initialApplicantBalance ? options.initialApplicantBalance : 0
    const initialProposerBalance = options.initialProposerBalance ? options.initialProposerBalance : 0
    const initialProcessorBalance = options.initialProcessorBalance ? options.initialProcessorBalance : 0
    const expectedYesVotes = options.expectedYesVotes ? options.expectedYesVotes : 0
    const expectedNoVotes = options.expectedNoVotes ? options.expectedNoVotes : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote ? options.expectedMaxSharesAtYesVote : 0
    const expectedFinalTotalSharesRequested = options.expectedFinalTotalSharesRequested ? options.expectedFinalTotalSharesRequested : 0
    const didPass = typeof options.didPass == 'boolean' ? options.didPass : true
    const aborted = typeof options.aborted == 'boolean' ? options.aborted : false

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.yesVotes, expectedYesVotes)
    assert.equal(proposalData.noVotes, expectedNoVotes)
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)
    assert.equal(proposalData.processed, true)
    assert.equal(proposalData.didPass, didPass)
    assert.equal(proposalData.aborted, aborted)

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(totalSharesRequested, expectedFinalTotalSharesRequested)

    const totalShares = await moloch.totalShares()
    assert.equal(totalShares, didPass ? initialTotalShares + proposal.sharesRequested : initialTotalShares)

    const processorBalance = await token.balanceOf(processor)
    assert.equal(processorBalance, initialProcessorBalance + config.PROCESSING_REWARD)

    const guildBankBalance = await token.balanceOf(guildBank.address)
    assert.equal(guildBankBalance, didPass ? initialGuildBankBalance + proposal.tokenTribute : initialGuildBankBalance)

    const molochBalance = await token.balanceOf(moloch.address)
    assert.equal(molochBalance, initialMolochBalance - proposal.tokenTribute - config.PROPOSAL_DEPOSIT)

    const proposerBalance = await token.balanceOf(proposer)
    assert.equal(proposerBalance, initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD)
  }

  // VERIFY UPDATE DELEGATE KEY
  const verifyUpdateDelegateKey = async (memberAddress, oldDelegateKey, newDelegateKey) => {
    const member = await moloch.members(memberAddress)
    assert.equal(member.delegateKey, newDelegateKey)
    const memberByOldDelegateKey = await moloch.memberAddressByDelegateKey(oldDelegateKey)
    assert.equal(memberByOldDelegateKey, zeroAddress)
    const memberByNewDelegateKey = await moloch.memberAddressByDelegateKey(newDelegateKey)
    assert.equal(memberByNewDelegateKey, memberAddress)
  }

  before('deploy contracts', async () => {
    moloch = await Moloch.deployed()
    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)
    token = await Token.deployed()

    proxyFactory = await ProxyFactory.deployed()
    gnosisSafeMasterCopy = await GnosisSafe.deployed()
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    creator = accounts[0]
    summoner = accounts[1]

    proposal1 = {
      applicant: accounts[2],
      tokenTribute: 100,
      sharesRequested: 1,
      details: ""
    }

    processor = accounts[9]

    token.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  it('verify deployment parameters', async () => {
    const now = await blockTime()

    const approvedTokenAddress = await moloch.approvedToken()
    assert.equal(approvedTokenAddress, token.address)

    const guildBankAddress = await moloch.guildBank()
    assert.equal(guildBankAddress, guildBank.address)

    const guildBankOwner = await guildBank.owner()
    assert.equal(guildBankOwner, moloch.address)

    const guildBankToken = await guildBank.approvedToken()
    assert.equal(guildBankToken, token.address)

    const periodDuration = await moloch.periodDuration()
    assert.equal(+periodDuration, config.PERIOD_DURATION_IN_SECONDS)

    const votingPeriodLength = await moloch.votingPeriodLength()
    assert.equal(+votingPeriodLength, config.VOTING_DURATON_IN_PERIODS)

    const gracePeriodLength = await moloch.gracePeriodLength()
    assert.equal(+gracePeriodLength, config.GRACE_DURATON_IN_PERIODS)

    const abortWindow = await moloch.abortWindow()
    assert.equal(+abortWindow, config.ABORT_WINDOW_IN_PERIODS)

    const proposalDeposit = await moloch.proposalDeposit()
    assert.equal(+proposalDeposit, config.PROPOSAL_DEPOSIT)

    const dilutionBound = await moloch.dilutionBound()
    assert.equal(+dilutionBound, config.DILUTION_BOUND)

    const processingReward = await moloch.processingReward()
    assert.equal(+processingReward, config.PROCESSING_REWARD)

    const currentPeriod = await moloch.getCurrentPeriod()
    assert.equal(+currentPeriod, 0)

    // TODO check the summoning time = last blocktime

    const summonerData = await moloch.members(config.SUMMONER)
    assert.equal(summonerData[0].toLowerCase(), config.SUMMONER) // delegateKey matches
    assert.equal(+summonerData[1], 1)
    assert.equal(summonerData[2], true)
    assert.equal(+summonerData[3], 0)

    const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(config.SUMMONER)
    assert.equal(summonerAddressByDelegateKey.toLowerCase(), config.SUMMONER)

    const totalShares = await moloch.totalShares()
    assert.equal(+totalShares, 1)

    // confirm initial token supply and summoner balance
    const tokenSupply = await token.totalSupply()
    assert.equal(+tokenSupply.toString(), config.TOKEN_SUPPLY)
    const summonerBalance = await token.balanceOf(summoner)
    assert.equal(+summonerBalance.toString(), initSummonerBalance)
    const creatorBalance = await token.balanceOf(creator)
    assert.equal(creatorBalance, config.TOKEN_SUPPLY - initSummonerBalance)
  })

  describe('submitProposal', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })
    })

    it('happy case', async () => {
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: proposal1.tokenTribute,
        initialProposerBalance: initSummonerBalance
      })
    })

    // TODO trigger the uint overflow

    it('fail - insufficient proposal deposit', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: summoner })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })

    it('fail - insufficient applicant tokens', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: proposal1.applicant })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })

    it('modifier - delegate', async () => {
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: creator }).should.be.rejectedWith('not a delegate')
    })
  })

  describe('submitVote', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
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

    it('fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from: summoner }).should.be.rejectedWith('proposal does not exist')
    })

    it('fail - voting period has not started', async () => {
      // don't move the period forward
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('voting period has not started')
    })

    it('fail - voting period has expired', async () => {
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS + 1)
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('voting period has expired')
    })

    it('fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('member has already voted on this proposal')
    })

    it('fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch.submitVote(0, 0, { from: summoner }).should.be.rejectedWith('vote must be either Yes or No')
      // vote out of bounds
      await moloch.submitVote(0, 3, { from: summoner }).should.be.rejectedWith(InvalidOpcode)
    })

    it('fail - proposal has been aborted', async () => {
      await moloch.abort(0, { from: proposal1.applicant })
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('proposal has been aborted')
    })

    it('modifier - delegate', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: creator }).should.be.rejectedWith('not a delegate')
    })
  })

  describe('processProposal', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
    })

    it.only('happy case', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('fail - proposal does not exist', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1).should.be.rejectedWith('proposal does not exist')
    })

    it('fail - proposal is not ready to be processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS - 1)
      await moloch.processProposal(0).should.be.rejectedWith('proposal is not ready to be processed')
    })

    it('fail - proposal has already been processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0)
      await moloch.processProposal(0).should.be.rejectedWith('proposal has already been processed')
    })

    it('fail - previous proposal must be processed', async () => {
      // TODO two proposals back to back
    })
  })

  describe('processProposal + abort', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
    })

    it('passes when applicant does not abort', async () => {
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0)
    })

    it('fails when applicant aborts', async () => {
      await moloch.submitVote(0, 1, { from: summoner })
      await moloch.abort(0, { from: proposal1.applicant })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0)
    })
  })

  // 1. processProposal if branches
  //   - dilutionBound (mass ragequit)
  //     - 1 share, summoner ragequits
  //   - success -> new member (happy case)
  //     - force reset existing delegateKey
  //       1. summoner submits
  //       2. summoner votes
  //       3. summoner updates delegate key to applicant
  //       4. fast forward -> processProposal
  //       5. verify force reset
  //   - success -> existing member
  //     - summoner submits proposal for themselves
  //   - failure
  //     - summoner votes no

  describe('ragequit', () => {
    beforeEach(async () => {
      proposal1.sharesRequested = 1 // make it so total shares is 2

      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
    })

    it('happy case', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(1, { from: summoner })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, proposal1.sharesRequested)

      const summonerData = await moloch.members(summoner)
      assert.equal(+summonerData[1], 0)
      assert.equal(summonerData[2], true)
      assert.equal(+summonerData[3], 0)

      // can divide tokenTribute by 2 because 2 shares
      const summonerBalance = await token.balanceOf(summoner)
      const expectedBalance = initSummonerBalance - config.PROCESSING_REWARD + (proposal1.tokenTribute / 2)
      assert.equal(+summonerBalance.toString(), expectedBalance)

      const molochBalance = await token.balanceOf(moloch.address)
      assert.equal(molochBalance, 0)

      // guild bank has the other half of the funds
      const guildBankBalance = await token.balanceOf(guildBank.address)
      assert.equal(guildBankBalance, proposal1.tokenTribute / 2)
    })

    it('fail - insufficient shares', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(2, { from: summoner }).should.be.rejectedWith('insufficient shares')
    })

    it('fail - cant ragequit yet', async () => {
      // skip processing the proposal
      await moloch.ragequit(1, { from: summoner }).should.be.rejectedWith('cant ragequit until highest index proposal member voted YES on is processed')
    })

    it('modifier - member - non-member', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(1, { from: creator }).should.be.rejectedWith('not a member')
    })

    it('modifier - member - member ragequit', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(1, { from: summoner })
      await moloch.ragequit(1, { from: summoner }).should.be.rejectedWith('not a member')
    })

    // TODO how might guildbank withdrawal fail?
  })

  describe('abort', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
    })

    it('happy case', async () => {
      await moloch.abort(0, { from: proposal1.applicant })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.tokenTribute, 0)
      assert.equal(proposal.sharesRequested, 1)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)
      assert.equal(proposal.processed, false)
      assert.equal(proposal.didPass, false)
      assert.equal(proposal.aborted, true)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, 1)

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const molochBalance = await token.balanceOf(moloch.address)
      assert.equal(molochBalance, config.PROPOSAL_DEPOSIT)

      const summonerBalance = await token.balanceOf(summoner)
      assert.equal(summonerBalance, initSummonerBalance - config.PROPOSAL_DEPOSIT)

      const applicantBalance = await token.balanceOf(proposal1.applicant)
      assert.equal(applicantBalance, proposal1.tokenTribute)
    })

    it('fail - proposal does not exist', async () => {
      await moloch.abort(1, { from: proposal1.applicant }).should.be.rejectedWith('proposal does not exist')
    })

    it('fail - msg.sender must be applicant', async () => {
      await moloch.abort(0, { from: summoner }).should.be.rejectedWith('msg.sender must be applicant')
    })

    it('fail - abort window must not have passed', async () => {
      await moveForwardPeriods(config.ABORT_WINDOW_IN_PERIODS)
      await moloch.abort(0, { from: proposal1.applicant }).should.be.rejectedWith('abort window must not have passed')
    })

    // TODO how can token transfer to applicant fail?
  })

  describe('updateDelegateKey', () => {
    beforeEach(async () => {
      // vote in a new member to test failing requires
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
    })

    it('happy case', async () => {
      await moloch.updateDelegateKey(creator, { from: summoner })
      await verifyUpdateDelegateKey(summoner, summoner, creator)
    })

    it('fail - newDelegateKey cannot be 0', async () => {
      await moloch.updateDelegateKey(zeroAddress, { from: summoner }).should.be.rejectedWith('newDelegateKey cannot be 0')
    })

    it('fail - cant overwrite existing members', async () => {
      await moloch.updateDelegateKey(proposal1.applicant, { from: summoner }).should.be.rejectedWith('cant overwrite existing members')
    })

    it('fail - cant overwrite existing delegate keys', async () => {
      // first set the p1 applicant delegate key to the creator
      await moloch.updateDelegateKey(creator, { from: proposal1.applicant })
      // then try to overwrite it
      await moloch.updateDelegateKey(creator, { from: summoner }).should.be.rejectedWith('cant overwrite existing delegate keys')
    })

    it('modifier - member', async () => {
      await moloch.updateDelegateKey(creator, { from: creator }).should.be.rejectedWith('not a member')
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
      await guildBank.withdraw(summoner, 1, 1).should.be.rejectedWith(SolRevert)
    })
  })

  describe('two proposals', () => {
    beforeEach(async () => {

    })

    it('submitVote - yes - dont update highestIndexYesVote', async () => {
      // vote on p2 -> 2
      // vote on p1 -> 2
    })

    it('submitVote - yes - dont update maxTotalSharesAtYesVote', async () => {
      // 2. maxShares are higher (n -> n+)
      // 3. maxShares are the same (n -> n)
      // 4. maxShares are the lower (n -> n-)
    })
  })

  describe('Gnosis Safe Integration', () => {
    beforeEach(async () => {
      executor = creator // used to execute gnosis safe transactions

      // Create lightwallet
      lw = await utils.createLightwallet()
      // Create Gnosis Safe

      let gnosisSafeData = await gnosisSafeMasterCopy.contract.methods.setup([lw.accounts[0], lw.accounts[1], lw.accounts[2]], 2, 0, "0x").encodeABI()

      gnosisSafe = await utils.getParamFromTxEvent(
          await proxyFactory.createProxy(gnosisSafeMasterCopy.address, gnosisSafeData),
          'ProxyCreation', 'proxy', proxyFactory.address, GnosisSafe, 'create Gnosis Safe',
      )

      // Transfer Tokens to Gnosis Safe
      await token.transfer(gnosisSafe.address, 100, { from: creator })

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
      await safeUtils.executeTransaction(lw, gnosisSafe, 'executeTransaction withdraw 1 ETH', [lw.accounts[0], lw.accounts[2]], creator, web3.utils.toWei('1', 'ether'), "0x", CALL, summoner)
      const safeBalance = await web3.eth.getBalance(gnosisSafe.address)
      assert.equal(safeBalance, 0)
    })

    it('token approval', async () => {
      let data = await token.contract.methods.approve(moloch.address, 100).encodeABI()
      await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)
      const approvedAmount = await token.allowance(gnosisSafe.address, moloch.address)
      assert.equal(approvedAmount, 100)
    })

    it('abort', async () => {
      // approve 100 eth from safe to moloch
      let data = await token.contract.methods.approve(moloch.address, 100).encodeABI()
      await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)

      // summoner approve for proposal deposit
      await token.approve(moloch.address, 10, { from: summoner })
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
        let data = await token.contract.methods.approve(moloch.address, 100).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)

        // summoner approves tokens and submits proposal for safe
        await token.approve(moloch.address, 10, { from: summoner })
        await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

        // summoner votes yes for safe
        await moveForwardPeriods(1)
        await moloch.submitVote(0, 1, { from: summoner })

        // fast forward until safe is a member
        await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
        await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
        await moloch.processProposal(0, { from: processor })
      })

      it('submit proposal -> vote -> update delegate -> ragequit', async () => {
        // confirm that the safe is a member
        const safeMemberData = await moloch.members(gnosisSafe.address)
        assert.equal(safeMemberData.isActive, true)

        // create a new proposal
        proposal2 = {
          applicant: accounts[2],
          tokenTribute: 100,
          sharesRequested: 2,
          details: ""
        }

        // send the applicant 100 tokens and have them do the approval
        await token.transfer(proposal2.applicant, proposal2.tokenTribute, { from: creator })
        await token.approve(moloch.address, proposal2.tokenTribute, { from: proposal2.applicant})

        // safe needs to approve 10 for the deposit (get 10 more from creator)
        await token.transfer(gnosisSafe.address, 10, { from: creator })
        let data = await token.contract.methods.approve(moloch.address, 10).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'approve token transfer to moloch', [lw.accounts[0], lw.accounts[1]], token.address, 0, data, CALL, executor)

        // safe submits proposal
        let submitProposalData = await moloch.contract.methods.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'submit proposal to moloch', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, submitProposalData, CALL, executor)

        const expectedStartingPeriod = (await moloch.getCurrentPeriod()).toNumber() + 1
        await verifySubmitProposal(proposal2, 1, gnosisSafe.address, {
          initialTotalShares: 2,
          initialProposalLength: 1,
          initialApplicantBalance: proposal2.tokenTribute,
          initialProposerBalance: 10,
          expectedStartingPeriod: expectedStartingPeriod
        })

        // safe submits vote
        await moveForwardPeriods(1)
        let voteData = await moloch.contract.methods.submitVote(1, 2).encodeABI() // vote no so we can ragequit easier
        await safeUtils.executeTransaction(lw, gnosisSafe, 'submit vote to moloch', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, voteData, CALL, executor)
        await verifySubmitVote(proposal1, 1, gnosisSafe.address, 2, {})

        const newDelegateKey = accounts[5]

        // safe updates delegate key
        const updateDelegateData = await moloch.contract.methods.updateDelegateKey(newDelegateKey).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'update delegate key', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, updateDelegateData, CALL, executor)
        await verifyUpdateDelegateKey(gnosisSafe.address, gnosisSafe.address, newDelegateKey)

        // safe ragequits
        const ragequitData = await moloch.contract.methods.ragequit(1).encodeABI()
        await safeUtils.executeTransaction(lw, gnosisSafe, 'ragequit the guild', [lw.accounts[0], lw.accounts[1]], moloch.address, 0, ragequitData, CALL, executor)
        const safeMemberDataAfterRagequit = await moloch.members(gnosisSafe.address)
        assert.equal(safeMemberDataAfterRagequit.isActive, true)
        assert.equal(safeMemberDataAfterRagequit.shares, 0)

        const safeBalanceAfterRagequit = await token.balanceOf(gnosisSafe.address)
        assert.equal(safeBalanceAfterRagequit, 50) // 100 eth & 2 shares at time of ragequit
      })
    })
  })
})
