/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
// const TestCoin = artifacts.require('./TestCoin')
const LootToken = artifacts.require('./LootToken')
const foundersJSON = require('../migrations/founders.json')
const configJSON = require('../migrations/config.json')

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

contract('Moloch', accounts => {
  before('deploy contracts', async () => {
    moloch = await Moloch.deployed()
    guildBank = await GuildBank.deployed()
    lootAddress = await moloch.lootToken()
    lootToken = await LootToken.at(lootAddress)
  })

  it('verify deployment parameters', async () => {
    const now = await blockTime()

    const LOOT_reference = await moloch.lootToken()
    assert.equal(LOOT_reference, lootToken.address)

    const totalVotingShares = foundersJSON.votingShares.reduce((total, shares) => {
      return total + shares
    })
    totalSupply = await lootToken.totalSupply()
    assert.equal(+totalSupply, totalVotingShares)

    const GUILD_reference = await moloch.guildBank()
    assert.equal(GUILD_reference, guildBank.address)

    const periodDuration = await moloch.periodDuration()
    assert.equal(+periodDuration, configJSON.PERIOD_DURATION_IN_SECONDS)

    const votingPeriodLength = await moloch.votingPeriodLength()
    assert.equal(+votingPeriodLength, configJSON.VOTING_DURATON_IN_PERIODS)

    const gracePeriodLength = await moloch.gracePeriodLength()
    assert.equal(+gracePeriodLength, configJSON.GRACE_DURATON_IN_PERIODS)

    const proposalDeposit = await moloch.proposalDeposit()
    assert.equal(+proposalDeposit, configJSON.MIN_PROPOSAL_DEPOSIT_IN_WEI)

    const currentPeriod = await moloch.currentPeriod()
    assert.equal(+currentPeriod, 0)

    const periodData = await moloch.periods(+currentPeriod)
    assert.equal(+periodData[0], now)

    const startTime = +periodData[0]
    const endTime = +periodData[1]
    assert.equal(endTime - startTime, configJSON.PERIOD_DURATION_IN_SECONDS)

    for (let i=0; i < foundersJSON.addresses.length; i++) {
      let founderAddress = foundersJSON.addresses[i]
      let founderVotingShares = foundersJSON.votingShares[i]
      memberData = await moloch.members(founderAddress)
      assert.equal(+memberData, founderVotingShares)
    }
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
