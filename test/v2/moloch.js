// v2 test spec

const { artifacts, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

// const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

async function blockTime () {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
}

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const initSummonerBalance = 100

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

contract('Moloch V2', ([creator, summoner, applicant1, applicant2, processor, delegateKey, ...otherAccounts]) => {
  let moloch, guildBank, token

  before('deploy contracts', async () => {
    token = await Token.new(deploymentConfig.TOKEN_SUPPLY)

    moloch = await Moloch.new(
      deploymentConfig.SUMMONER,
      [token.address], // FIXME handle multiple tokens
      deploymentConfig.PERIOD_DURATION_IN_SECONDS,
      deploymentConfig.VOTING_DURATON_IN_PERIODS,
      deploymentConfig.GRACE_DURATON_IN_PERIODS,
      deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    // const guildBankAddress = await moloch.guildBank()
    // guildBank = await GuildBank.at(guildBankAddress)

    // proxyFactory = await ProxyFactory.new()
    // gnosisSafeMasterCopy = await GnosisSafe.new()
    //
    // await gnosisSafeMasterCopy.setup([notOwnedAddress], 1, zeroAddress, '0x', zeroAddress, 0, zeroAddress)
  })

  // beforeEach(async () => {
  //   snapshotId = await snapshot()
  //
  //   proposal1 = {
  //     applicant: applicant1,
  //     tokenTribute: 100,
  //     sharesRequested: 1,
  //     details: 'all hail moloch'
  //   }
  //
  //   token.transfer(summoner, initSummonerBalance, { from: creator })
  // })
  //
  // afterEach(async () => {
  //   await restore(snapshotId)
  // })

  it('verify deployment parameters', async () => {
    // eslint-disable-next-line no-unused-vars
    const now = await blockTime()

    const guildBankAddress = await moloch.guildBank()
    assert.equal(guildBankAddress, guildBank.address)

    // const guildBankOwner = await guildBank.owner()
    // assert.equal(guildBankOwner, moloch.address)
    //
    // const guildBankToken = await guildBank.approvedToken()
    // assert.equal(guildBankToken, token.address)
    //
    // const periodDuration = await moloch.periodDuration()
    // assert.equal(+periodDuration, deploymentConfig.PERIOD_DURATION_IN_SECONDS)
    //
    // const votingPeriodLength = await moloch.votingPeriodLength()
    // assert.equal(+votingPeriodLength, deploymentConfig.VOTING_DURATON_IN_PERIODS)
    //
    // const gracePeriodLength = await moloch.gracePeriodLength()
    // assert.equal(+gracePeriodLength, deploymentConfig.GRACE_DURATON_IN_PERIODS)
    //
    // const emergencyExitWait = await moloch.emergencyExitWait()
    // assert.equal(+emergencyExitWait, deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS)
    //
    // const proposalDeposit = await moloch.proposalDeposit()
    // assert.equal(+proposalDeposit, deploymentConfig.PROPOSAL_DEPOSIT)
    //
    // const dilutionBound = await moloch.dilutionBound()
    // assert.equal(+dilutionBound, deploymentConfig.DILUTION_BOUND)
    //
    // const processingReward = await moloch.processingReward()
    // assert.equal(+processingReward, deploymentConfig.PROCESSING_REWARD)
    //
    // const currentPeriod = await moloch.getCurrentPeriod()
    // assert.equal(+currentPeriod, 0)
    //
    // const summonerData = await moloch.members(deploymentConfig.SUMMONER)
    // assert.equal(summonerData.delegateKey.toLowerCase(), deploymentConfig.SUMMONER) // delegateKey matches
    // assert.equal(summonerData.shares, 1)
    // assert.equal(summonerData.exists, true)
    // assert.equal(summonerData.highestIndexYesVote, 0)
    //
    // const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(
    //   deploymentConfig.SUMMONER
    // )
    // assert.equal(summonerAddressByDelegateKey.toLowerCase(), deploymentConfig.SUMMONER)
    //
    // const totalShares = await moloch.totalShares()
    // assert.equal(+totalShares, 1)
    //
    // // confirm initial token supply and summoner balance
    // const tokenSupply = await token.totalSupply()
    // assert.equal(+tokenSupply.toString(), deploymentConfig.TOKEN_SUPPLY)
    // const summonerBalance = await token.balanceOf(summoner)
    // assert.equal(+summonerBalance.toString(), initSummonerBalance)
    // const creatorBalance = await token.balanceOf(creator)
    // assert.equal(creatorBalance, deploymentConfig.TOKEN_SUPPLY - initSummonerBalance)
  })
})
