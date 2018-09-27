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
  return await web3.eth.getBlock('latest').timestamp
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

contract('verify up to deployment', accounts => {
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
    
    let totalVotingShares = 0
    for (let i=0; i < foundersJSON.votingShares.length; i++) {
      totalVotingShares += foundersJSON.votingShares[i]
    }
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

/*
contract('donate', accounts => {
  let moloch, guildBank, guildBankAddress

  before('deploy Moloch', async () => {
    moloch = await Moloch.deployed()
    guildBankAddress = await moloch.guildBank.call()
    guildBank = await GuildBank.at(guildBankAddress)
  })

  it('donate ETH', async () => {
    await guildBank.sendTransaction({ from: accounts[0], value: 100 })
    const balance = await web3.eth.getBalance(guildBankAddress)
    assert.equal(
      100,
      balance.toNumber(),
      'transaction sent does not equal balance in Guild Bank'
    )
  })

  it('donate tokens', async () => {
    const token = await TestCoin.deployed()
    await token.approve(guildBank.address, 10000000, {
      from: accounts[0]
    })
    await guildBank.offerTokens(accounts[0], token.address, 10000000, {
      from: accounts[0]
    })
    const tokenBalance = await token.balanceOf(guildBankAddress)
    assert.equal(
      tokenBalance,
      10000000,
      'token donation amount does not equal guild bank balance'
    )
    const tokenAddresses = await guildBank.getTokenAddresses.call()
    assert.equal(
      tokenAddresses[0],
      token.address,
      'token address not added to guild bank list'
    )
  })
})
*/

/*
contract('member application', accounts => {
  let moloch, guildBank, guildBankAddress, founders, lootTokenAddress, lootToken
  const PROSPECTIVE_MEMBERS = [accounts[9], accounts[8]]
  const VOTING_SHARES_REQUESTED = 1000
  const TRIBUTE = 10000
  const PROPOSAL_PHASES = {
    Done: 0,
    Proposed: 1,
    Voting: 2,
    GracePeriod: 3
  }
  const PROPOSAL_TYPES = {
    Membership: 0,
    Project: 1
  }
  const BALLOT_ITEMS = {
    Reject: 0,
    Accept: 1
  }
  const QUORUM_DENOMINATOR = 2

  before('deploy Moloch', async () => {
    moloch = await Moloch.deployed()
    guildBankAddress = await moloch.guildBank.call()
    guildBank = await GuildBank.at(guildBankAddress)
    lootTokenAddress = await moloch.lootToken.call()
    lootToken = await LootToken.at(lootTokenAddress)
    founders = foundersJSON
  })

  it('member application ETH', async () => {
    await moloch.createMemberProposal(
      PROSPECTIVE_MEMBERS[0],
      [],
      [],
      VOTING_SHARES_REQUESTED,
      {
        from: founders.addresses[0],
        value: TRIBUTE
      }
    )

    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    const [
      proposer,
      proposalType,
      votingSharesRequested,
      phase
    ] = await moloch.getProposalCommonDetails.call(currentProposalIndex)
    assert.equal(
      proposer,
      founders.addresses[0],
      `proposer is not ${founders.addresses[0]}`
    )
    assert.equal(
      proposalType,
      PROPOSAL_TYPES.Membership,
      `proposal types is not "Membership"`
    )
    assert.equal(
      votingSharesRequested,
      VOTING_SHARES_REQUESTED,
      `voting shares requested is not ${VOTING_SHARES_REQUESTED}`
    )
    assert.equal(
      phase,
      PROPOSAL_PHASES.Proposed,
      `proposal phase is not "Proposed"`
    )

    const [
      prospectiveMemberAddress,
      ethTributeAmount,
      tokenTributeAddresses,
      tokenTributeAmounts
    ] = await moloch.getProposalMemberDetails.call(currentProposalIndex)
    assert.equal(
      prospectiveMemberAddress,
      PROSPECTIVE_MEMBERS[0],
      `Prospective member address not correct`
    )
    assert.equal(ethTributeAmount, TRIBUTE, `eth tribute amount incorrect`)
    assert.equal(
      tokenTributeAddresses,
      false,
      `should not be any token tribute`
    )
    assert.equal(tokenTributeAmounts, false, `should not be any token tribute`)
  })

  it('member application tokens', async () => {
    const token = await TestCoin.deployed()
    await token.approve(guildBank.address, TRIBUTE, {
      from: PROSPECTIVE_MEMBERS[1]
    })
    await token.allowance(PROSPECTIVE_MEMBERS[1], guildBank.address)

    await moloch.createMemberProposal(
      PROSPECTIVE_MEMBERS[1],
      [token.address],
      [TRIBUTE],
      VOTING_SHARES_REQUESTED,
      {
        from: founders.addresses[0]
      }
    )

    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    const [
      proposer,
      proposalType,
      votingSharesRequested,
      phase
    ] = await moloch.getProposalCommonDetails.call(currentProposalIndex.plus(1))
    assert.equal(
      proposer,
      founders.addresses[0],
      `proposer is not ${founders.addresses[0]}`
    )
    assert.equal(
      proposalType,
      PROPOSAL_TYPES.Membership,
      `proposal types is not "Membership"`
    )
    assert.equal(
      votingSharesRequested,
      VOTING_SHARES_REQUESTED,
      `voting shares requested is not ${VOTING_SHARES_REQUESTED}`
    )
    assert.equal(
      phase,
      PROPOSAL_PHASES.Proposed,
      `proposal phase is not "Proposed"`
    )

    const [
      prospectiveMemberAddress,
      ethTributeAmount,
      tokenTributeAddresses,
      tokenTributeAmounts
    ] = await moloch.getProposalMemberDetails.call(currentProposalIndex.plus(1))
    assert.equal(
      prospectiveMemberAddress,
      PROSPECTIVE_MEMBERS[1],
      `Prospective member address not correct`
    )
    assert.equal(ethTributeAmount, 0, `eth tribute amount incorrect`)
    assert.equal(
      tokenTributeAddresses.length,
      1,
      `token tribute should have 1 address`
    )
    assert.equal(
      tokenTributeAddresses[0],
      token.address,
      `token tribute address not in contract`
    )
    assert.equal(
      tokenTributeAmounts[0],
      TRIBUTE,
      `token tribute not recognized`
    )
  })

  it('start member proposal vote', async () => {
    await moloch.startProposalVote()

    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    const proposal = await moloch.getProposalCommonDetails.call(
      currentProposalIndex
    )
    assert.equal(
      proposal[3],
      PROPOSAL_PHASES.Voting,
      `proposal phase did not transition to 'Voting'`
    )

    const totalFounderShares = founders.shares.reduce((acc, shares) => {
      return (acc += shares)
    }, 0)
    const minVotesRequired = Math.trunc(totalFounderShares / QUORUM_DENOMINATOR)
    const ballot = await moloch.getProposalBallot(currentProposalIndex)
    assert.equal(
      ballot[1],
      minVotesRequired,
      `min votes required should be total founder shares divided by QUORUM_DENOMINATOR`
    )
  })

  it('vote on member proposal, accept', async () => {
    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    await founders.addresses.map(async founder => {
      await moloch.voteOnCurrentProposal(BALLOT_ITEMS.Accept, { from: founder })
    })
    const ballot = await moloch.getProposalBallot(currentProposalIndex)
    assert.equal(
      ballot[2],
      BALLOT_ITEMS.Accept,
      `leading ballot item is not 'Accept'`
    )
  })

  it('transition member proposal to grace period', async () => {
    await new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, (configJSON.PROPOSAL_VOTE_TIME_SECONDS + 1) * 1000)
    })
    await moloch.transitionProposalToGracePeriod({
      from: founders.addresses[0]
    })
    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    const proposal = await moloch.getProposalCommonDetails.call(
      currentProposalIndex
    )
    assert.equal(
      proposal[3],
      PROPOSAL_PHASES.GracePeriod,
      `proposal phase did not transition to 'GracePeriod'`
    )
  })

  it('finish member proposal', async () => {
    await new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, (configJSON.GRACE_PERIOD_SECONDS + 1) * 1000)
    })
    const startingLootTokenBalance = await lootToken.balanceOf(moloch.address)
    await moloch.finishProposal({ from: founders.addresses[0] })
    const currentProposalIndex = await moloch.getCurrentProposalIndex.call()
    const proposal = await moloch.getProposalCommonDetails.call(
      currentProposalIndex
    )
    assert.equal(
      proposal[3],
      PROPOSAL_PHASES.Done,
      `proposal phase did not transition to 'Done'`
    )

    const member = await moloch.getMember(PROSPECTIVE_MEMBERS[0])
    assert.equal(member, true, `member was not accepted after vote`)
    const memberVotingShares = await moloch.getVotingShares(
      PROSPECTIVE_MEMBERS[0]
    )
    assert.equal(
      memberVotingShares,
      VOTING_SHARES_REQUESTED,
      `member was not granted voting shares`
    )

    const endingLootTokenBalance = await lootToken.balanceOf(moloch.address)
    assert.equal(
      endingLootTokenBalance.minus(startingLootTokenBalance),
      VOTING_SHARES_REQUESTED,
      `loot tokens were not created`
    )
  })
})
*/

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
