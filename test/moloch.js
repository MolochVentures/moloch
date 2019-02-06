/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./oz/ERC20')
const config = require('../migrations/config.json')

const abi = require('web3-eth-abi')

const HttpProvider = require(`ethjs-provider-http`)
const EthRPC = require(`ethjs-rpc`)
const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'))

const BigNumber = web3.BigNumber

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

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

contract('Moloch', accounts => {
  let snapshotId

  before('deploy contracts', async () => {
    moloch = await Moloch.deployed()
    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)
    token = await Token.deployed()
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    summoner = accounts[0]

    founder1 = {
      address: accounts[0],
      tributeTokenAddresses: []
    }

    applicant = accounts[2]
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

    const periodDuration = await moloch.periodDuration()
    assert.equal(+periodDuration, config.PERIOD_DURATION_IN_SECONDS)

    const votingPeriodLength = await moloch.votingPeriodLength()
    assert.equal(+votingPeriodLength, config.VOTING_DURATON_IN_PERIODS)

    const gracePeriodLength = await moloch.gracePeriodLength()
    assert.equal(+gracePeriodLength, config.GRACE_DURATON_IN_PERIODS)

    const proposalDeposit = await moloch.proposalDeposit()
    assert.equal(+proposalDeposit, config.PROPOSAL_DEPOSIT_IN_WEI)

    const dilutionBound = await moloch.dilutionBound()
    assert.equal(+dilutionBound, config.DILUTION_BOUND)

    const processingReward = await moloch.processingReward()
    assert.equal(+processingReward, config.PROCESSING_REWARD)

    const currentPeriod = await moloch.currentPeriod()
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
  })

  describe('submitProposal', () => {
    it('happy case', async () => {
      await moloch.submitProposal()

      // set the applicant profile
      // the founders have to be the addresses - they are
      // need to switch it up for voting
      // one of the founders needs to submit the tx
      // need to have at least 2 test tokens deployed
      // approve token transfers in advance
    })
  })

  describe('submitVote', () => {

  })

  describe('processProposal', () => {

  })

  describe('collectLootTokens', () => {

  })

  describe('GuildBank::redeemLootTokens', () => {

  })

  describe('GuildBank::safeRedeemLootTokens', () => {

  })

  // verify founding members
  // it('should save addresses from deploy', async () => {
  //   for (let i = 0; i < founders.addresses.length; i++) {
  //     let memberAddress = founders.addresses[i]
  //     const member = await moloch.getMember(memberAddress)
  //     assert.equal(member, true, 'founding member not saved correctly')
  //   }
  // })
  // // verify failure of non-founding members
  // it('should fail non deployed addresses', async () => {
  //   for (let i = 2; i < 10; i++) {
  //     let nonMemberAddress = accounts[i]
  //     const nonMember = await moloch.getMember(nonMemberAddress)
  //     assert.notEqual(nonMember, true, 'non-member added incorrectly')
  //   }
  // })
  // // verify founding member shares
  // it('should save founder shares from deploy', async () => {
  //   for (let i = 0; i < founders.addresses.length; i++) {
  //     let memberAddress = founders.addresses[i]
  //     const memberShares = await moloch.getVotingShares(memberAddress)
  //     assert.equal(
  //       founders.shares[i],
  //       memberShares.toNumber(),
  //       'founding shares not saved correctly'
  //     )
  //   }
  // })
  // // verify failure of incorrect shares
  // it('should fail on incorrect shares', async () => {
  //   for (let i = 0; i < founders.addresses.length; i++) {
  //     let memberAddress = founders.addresses[i]
  //     const memberShares = await moloch.getVotingShares(memberAddress)
  //     assert.notEqual(
  //       parseInt(Math.random() * 1000),
  //       memberShares.toNumber(),
  //       'incorrect shares saved'
  //     )
  //   }
  // })
})

// verify failure member proposal
// verify create/failure project proposal
// verify failure start proposal vote
// verify failure vote on current proposal
// verify failure transition proposal to grace period
// verify failure finish proposal

// verify shares
// verify tokens

// verify tokens/ETH on member application rejection

// verify member exit
// verify member exit burned voting tokens
// verify member exit loot tokens calculation
// verify loot tokens decremented correctly on member exit
// verify exited member no longer has voting ability

/*
  TEST STATES
  1. deploy
  2. donation
  3. membership proposal (exit at any time)
  - start voting
  - voting
  - grace period
  - membership success
  - membership failure
  - finish
  4. project proposal (exit at any time)
  - start voting
  - voting
  - grace period
  - project success
  - project failure
  - finish
  */
