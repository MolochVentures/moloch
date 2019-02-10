/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

// TODO
// - events
// - processProposal if branches
//   - aborted
//   - dilutionBound (mass ragequit)
//   - success -> new member
//     - force reset existing delegateKey
//   - success -> existing member
//   - failure
// - simulation
//   - 100 proposals
//     - X new members w/ tribute
//     - Y existing members
//     - Z pure grants
//   - everyone ragequits
// - gnosis safe multisig
//   - as delegateKey
//   - as memberAddress
// - old gnosis multisig
//   - as delegateKey
//   - as memberAddress
// - test gaps in the queue (starting period for submitProposal)
// - boundary conditions
//   - submitVote on first / last possible period (error, first, last, error)
//   - abort on first / last possible period
//   - attempt to process proposal 1 period before ready
//   - attempt to ragequit 1 period before ready
// - wETH externally deposited to guild bank can still be withdrawn

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')
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

const initSummonerBalance = 100

contract('Moloch', accounts => {
  let snapshotId

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

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.proposer, summoner)
      assert.equal(proposal.applicant, proposal1.applicant)
      assert.equal(proposal.sharesRequested, proposal1.sharesRequested)
      assert.equal(proposal.startingPeriod, 1)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.processed, false)
      assert.equal(proposal.didPass, false)
      assert.equal(proposal.aborted, false)
      assert.equal(proposal.tokenTribute, proposal1.tokenTribute)
      assert.equal(proposal.details, proposal1.details)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, proposal1.sharesRequested)

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(proposalQueueLength, 1)

      const molochBalance = await token.balanceOf(moloch.address)
      assert.equal(molochBalance, proposal1.tokenTribute + config.PROPOSAL_DEPOSIT)

      const summonerBalance = await token.balanceOf(summoner)
      assert.equal(summonerBalance, initSummonerBalance - config.PROPOSAL_DEPOSIT)

      const applicantBalance = await token.balanceOf(proposal1.applicant)
      assert.equal(applicantBalance, 0)
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

  describe.only('submitVote', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: creator })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: summoner })
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 1)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 1)

      const memberVote = await moloch.getMemberProposalVote(summoner, 0)
      assert.equal(memberVote, 1)
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 2, { from: summoner })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 1)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)

      const memberVote = await moloch.getMemberProposalVote(summoner, 0)
      assert.equal(memberVote, 2)
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

    it('happy case', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: processor })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 1)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 1)
      assert.equal(proposal.processed, true)
      assert.equal(proposal.didPass, true)
      assert.equal(proposal.aborted, false)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, 0)

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, proposal1.sharesRequested + 1)

      const processorBalance = await token.balanceOf(processor)
      assert.equal(processorBalance, config.PROCESSING_REWARD)

      const guildBankBalance = await token.balanceOf(guildBank.address)
      assert.equal(guildBankBalance, proposal1.tokenTribute)

      const molochBalance = await token.balanceOf(moloch.address)
      assert.equal(molochBalance, 0)

      const summonerBalance = await token.balanceOf(summoner)
      assert.equal(summonerBalance, initSummonerBalance - config.PROCESSING_REWARD)
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
      assert.equal(proposal.sharesRequested, 0)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)
      assert.equal(proposal.processed, false)
      assert.equal(proposal.didPass, false)
      assert.equal(proposal.aborted, true)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, 0)

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

    it('fail - proposal must not have entered grace period', async () => {
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.abort(0, { from: proposal1.applicant }).should.be.rejectedWith('proposal must not have entered grace period')
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

  describe('guildbank.deposit', () => {
    it('modifier - owner', async () => {
      await guildBank.deposit(1).should.be.rejectedWith(SolRevert)
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
})
