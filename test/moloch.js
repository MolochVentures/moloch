/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

// TODO
// 6.
// 7. events

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
// const BN = web3.utils.BN

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const SolRevert = 'VM Exception while processing transaction: revert'
const InvalidOpcode = 'VM Exception while processing transaction: invalid opcode'

const zeroAddress = '0x0000000000000000000000000000000000000000'

async function blockTime() {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
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
let proposal1, proposal2

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

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (proposal, proposalIndex, proposer, processor, options) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested ? options.initialTotalSharesRequested : 0
    const initialTotalShares = options.initialTotalShares ? options.initialTotalShares : 0
    const initialApplicantShares = options.initialApplicantShares ? options.initialApplicantShares : 0 // 0 means new member, > 0 means existing member
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
    assert.equal(totalShares, didPass && !aborted ? initialTotalShares + proposal.sharesRequested : initialTotalShares)

    const molochBalance = await token.balanceOf(moloch.address)
    assert.equal(molochBalance, initialMolochBalance - proposal.tokenTribute - config.PROPOSAL_DEPOSIT)

    const guildBankBalance = await token.balanceOf(guildBank.address)
    assert.equal(guildBankBalance, didPass && !aborted ? initialGuildBankBalance + proposal.tokenTribute : initialGuildBankBalance)

    // proposer and applicant are different
    if (proposer != proposal.applicant) {
      const applicantBalance = await token.balanceOf(proposal.applicant)
      assert.equal(applicantBalance, didPass && !aborted ? initialApplicantBalance : initialApplicantBalance + proposal.tokenTribute)

      const proposerBalance = await token.balanceOf(proposer)
      assert.equal(proposerBalance, initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD)

    // proposer is applicant
    } else {
      const proposerBalance = await token.balanceOf(proposer)
      const expectedBalance = didPass && !aborted
        ? initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD
        : initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD  + proposal.tokenTribute
      assert.equal(proposerBalance, expectedBalance)
    }

    const processorBalance = await token.balanceOf(processor)
    assert.equal(processorBalance, initialProcessorBalance + config.PROCESSING_REWARD)

    if (didPass && !aborted) {
      // existing member
      if (initialApplicantShares > 0) {
        const memberData = await moloch.members(proposal.applicant)
        assert.equal(memberData.shares, proposal.sharesRequested + initialApplicantShares)

      // new member
      } else {
        const newMemberData = await moloch.members(proposal.applicant)
        assert.equal(newMemberData.delegateKey, proposal.applicant)
        assert.equal(newMemberData.shares, proposal.sharesRequested)
        assert.equal(newMemberData.isActive, true)
        assert.equal(newMemberData.highestIndexYesVote, 0)

        const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(proposal.applicant)
        assert.equal(newMemberAddressByDelegateKey, proposal.applicant)
      }
    }
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
      details: "all hail moloch"
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

    const summonerData = await moloch.members(config.SUMMONER)
    assert.equal(summonerData.delegateKey.toLowerCase(), config.SUMMONER) // delegateKey matches
    assert.equal(summonerData.shares, 1)
    assert.equal(summonerData.isActive, true)
    assert.equal(summonerData.highestIndexYesVote, 0)

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

    // TODO - get uint limit in js
    describe.skip('uint overflow boundary', () => {
      it('require fail - uint overflow', async () => {
        proposal1.sharesRequested = new BN('...')
        await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner }).should.be.rejectedWith(SolRevert)
      })

      it('success - request 1 less share than the overflow limit', async () => {
        proposal1.sharesRequested = new BN('...') // 1 less
        await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
        await verifySubmitProposal(proposal1, 0, summoner, {
          initialTotalShares: 1,
          initialApplicantBalance: proposal1.tokenTribute,
          initialProposerBalance: initSummonerBalance
        })
      })
    })

    it('require fail - insufficient proposal deposit', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: summoner })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })

    it('require fail - insufficient applicant tokens', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: proposal1.applicant })

      // SafeMath reverts in ERC20.transferFrom
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })

    it('modifier - delegate', async () => {
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: creator }).should.be.rejectedWith('not a delegate')
    })

    it('edge case - proposal tribute is 0', async () => {
      const unspentTribute = proposal1.tokenTribute
      proposal1.tokenTribute = 0
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: unspentTribute, // should still have all tribute funds
        initialProposerBalance: initSummonerBalance
      })
    })

    it('edge case - shares requested is 0', async () => {
      proposal1.sharesRequested = 0
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
      await verifySubmitProposal(proposal1, 0, summoner, {
        initialTotalShares: 1,
        initialApplicantBalance: proposal1.tokenTribute,
        initialProposerBalance: initSummonerBalance
      })
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

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from: summoner }).should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - voting period has not started', async () => {
      // don't move the period forward
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('voting period has not started')
    })

    describe('voting period boundary', () => {
      it('require fail - voting period has expired', async () => {
        await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS + 1)
        await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('voting period has expired')
      })

      it('success - vote 1 period before voting period expires', async () => {
        await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
        await moloch.submitVote(0, 1, { from: summoner })
        await verifySubmitVote(proposal1, 0, summoner, 1, {
          expectedMaxSharesAtYesVote: 1
        })
      })
    })

    it('require fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith('member has already voted on this proposal')
    })

    it('require fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)
      // vote null
      await moloch.submitVote(0, 0, { from: summoner }).should.be.rejectedWith('vote must be either Yes or No')
      // vote out of bounds
      await moloch.submitVote(0, 3, { from: summoner }).should.be.rejectedWith(InvalidOpcode)
    })

    it('require fail - proposal has been aborted', async () => {
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

    it('happy case', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1).should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - proposal is not ready to be processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS - 1)
      await moloch.processProposal(0).should.be.rejectedWith('proposal is not ready to be processed')
    })

    it('require fail - proposal has already been processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await moloch.processProposal(0).should.be.rejectedWith('proposal has already been processed')
    })
  })

  describe('processProposal - edge cases', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
      await moveForwardPeriods(1)
    })

    it('proposal fails when no votes > yes votes', async () => {
      await moloch.submitVote(0, 2, { from: summoner })
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedNoVotes: 1,
        expectedMaxSharesAtYesVote: 0,
        didPass: false // proposal should not pass
      })
    })

    it('force resets members delegate key if assigned to newly admitted applicant', async () => {
      await moloch.submitVote(0, 1, { from: summoner })

      const newDelegateKey = proposal1.applicant
      await moloch.updateDelegateKey(newDelegateKey, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })

      // verify that the summoner delegate key has been reset
      const summonerData = await moloch.members(summoner)
      assert.equal(summonerData.delegateKey, summoner)

      const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(summoner)
      assert.equal(summonerAddressByDelegateKey, summoner)
    })
  })

  describe('processProposal - more edge cases', () => {
    beforeEach(async () => {
      proposal1.applicant = summoner

      await token.transfer(summoner, 10, { from: creator }) // summoner has 100 init, add 10 for deposit + tribute
      await token.approve(moloch.address, 110, { from: summoner }) // approve enough for deposit + tribute

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
      await moveForwardPeriods(1)
    })

    it('when applicant is an existing member, adds to their shares', async () => {
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
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
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
    })

    it('proposal passes when applicant does not abort', async () => {
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('proposal fails when applicant aborts', async () => {
      await moloch.abort(0, { from: proposal1.applicant })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })
      await verifyProcessProposal(proposal1, 0, summoner, processor, {
        initialTotalSharesRequested: 1,
        initialTotalShares: 1,
        initialMolochBalance: 110,
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 1,
        didPass: false, // false because aborted
        aborted: true // proposal was aborted
      })
    })
  })

  describe('ragequit', () => {
    beforeEach(async () => {
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
      assert.equal(summonerData.shares, 0)
      assert.equal(summonerData.isActive, true)
      assert.equal(summonerData.highestIndexYesVote, 0)

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

    it('require fail - insufficient shares', async () => {
      await moloch.processProposal(0)
      await moloch.ragequit(2, { from: summoner }).should.be.rejectedWith('insufficient shares')
    })

    it('require fail - cant ragequit yet', async () => {
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

    it('edge case - weth sent to guild bank can be withdrawn via ragequit', async () => {
      await moloch.processProposal(0)

      await token.transfer(guildBank.address, 100, { from: creator })
      const guildBankBalance1 = await token.balanceOf(guildBank.address)
      assert.equal(guildBankBalance1, proposal1.tokenTribute + 100)

      await moloch.ragequit(1, { from: summoner })

      const summonerBalance = await token.balanceOf(summoner)
      const expectedBalance = initSummonerBalance - config.PROCESSING_REWARD + (guildBankBalance1 / 2)
      assert.equal(+summonerBalance.toString(), expectedBalance)

      const guildBankBalance2 = await token.balanceOf(guildBank.address)
      assert.equal(guildBankBalance2, guildBankBalance1 / 2)
    })

    // TODO how might guildbank withdrawal fail?
    // - it could uint256 overflow
  })

  describe('abort', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
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

    it('require fail - proposal does not exist', async () => {
      await moloch.abort(1, { from: proposal1.applicant }).should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - msg.sender must be applicant', async () => {
      await moloch.abort(0, { from: summoner }).should.be.rejectedWith('msg.sender must be applicant')
    })

    describe('abort window boundary', () => {
      it('require fail - abort window must not have passed', async () => {
        await moveForwardPeriods(config.ABORT_WINDOW_IN_PERIODS + 1)
        await moloch.abort(0, { from: proposal1.applicant }).should.be.rejectedWith('abort window must not have passed')
      })

      it('success - abort 1 period before abort window expires', async () => {
        await moveForwardPeriods(config.ABORT_WINDOW_IN_PERIODS)
        await moloch.abort(0, { from: proposal1.applicant })

        const proposal = await moloch.proposalQueue.call(0)
        assert.equal(proposal.tokenTribute, 0)
        assert.equal(proposal.aborted, true)

        const applicantBalance = await token.balanceOf(proposal1.applicant)
        assert.equal(applicantBalance, proposal1.tokenTribute)
      })
    })
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

    it('require fail - newDelegateKey cannot be 0', async () => {
      await moloch.updateDelegateKey(zeroAddress, { from: summoner }).should.be.rejectedWith('newDelegateKey cannot be 0')
    })

    it('require fail - cant overwrite existing members', async () => {
      await moloch.updateDelegateKey(proposal1.applicant, { from: summoner }).should.be.rejectedWith('cant overwrite existing members')
    })

    it('require fail - cant overwrite existing delegate keys', async () => {
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
      proposal2 = {
        applicant: accounts[3],
        tokenTribute: 200,
        sharesRequested: 2,
        details: ""
      }

      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await token.transfer(proposal2.applicant, proposal2.tokenTribute, { from: creator })
      await token.approve(moloch.address, proposal2.tokenTribute, { from: proposal2.applicant })

      await token.approve(moloch.address, 20, { from: summoner })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
    })

    it('processProposal require fail - previous proposal must be processed', async () => {
      await moloch.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details, { from: summoner })
      await moveForwardPeriods(2)
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1).should.be.rejectedWith('previous proposal must be processed')

      // works after the first proposal is processed
      await moloch.processProposal(0)
      await moloch.processProposal(1)
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.processed, true)
    })

    it('submit proposal - starting period is correctly set with gaps in proposal queue', async () => {
      await moveForwardPeriods(4) // 0 -> 4
      await moloch.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details, { from: summoner })
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.startingPeriod, 5)
    })

    it('submit proposal - starting period is correctly set when another proposal is ahead in the queue', async () => {
      await moveForwardPeriods(1) // 0 -> 1
      await moloch.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details, { from: summoner })
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.startingPeriod, 2)
    })

    it('submitVote - yes - dont update highestIndexYesVote', async () => {
      await moloch.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details, { from: summoner })
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

      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })

      proposal2 = {
        applicant: accounts[3],
        tokenTribute: 200,
        sharesRequested: 2,
        details: ""
      }

      await token.transfer(proposal2.applicant, proposal2.tokenTribute, { from: creator })
      await token.approve(moloch.address, proposal2.tokenTribute, { from: proposal2.applicant })

      await token.approve(moloch.address, 10, { from: summoner })

      await moloch.submitProposal(proposal2.applicant, proposal2.tokenTribute, proposal2.sharesRequested, proposal2.details, { from: summoner })
      await moveForwardPeriods(1)
    })

    it('proposal fails when dilution bound is exceeded', async () => {
      const member1 = proposal1.applicant

      await moloch.submitVote(1, 1, { from: summoner})
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.maxTotalSharesAtYesVote, 4)

      await moloch.ragequit(3, { from: member1 })
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1, { from: processor })

      await verifyProcessProposal(proposal2, 1, summoner, processor, {
        initialTotalSharesRequested: 2,
        initialTotalShares: 1, // 4 -> 1
        initialMolochBalance: 210,
        initialGuildBankBalance: 25, // 100 -> 25
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD,
        initialProcessorBalance: 1,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 4,
        didPass: false
      })
    })

    it('proposal passes when dilution bound is not exceeded', async () => {
      const member1 = proposal1.applicant

      await moloch.submitVote(1, 1, { from: summoner})
      const proposalData = await moloch.proposalQueue(1)
      assert.equal(proposalData.maxTotalSharesAtYesVote, 4)

      await moloch.ragequit(2, { from: member1 })
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1, { from: processor })

      await verifyProcessProposal(proposal2, 1, summoner, processor, {
        initialTotalSharesRequested: 2,
        initialTotalShares: 2, // 4 -> 2
        initialMolochBalance: 210,
        initialGuildBankBalance: 50, // 100 -> 50
        initialProposerBalance: initSummonerBalance - config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD,
        initialProcessorBalance: 1,
        expectedYesVotes: 1,
        expectedMaxSharesAtYesVote: 4,
        didPass: true
      })
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
