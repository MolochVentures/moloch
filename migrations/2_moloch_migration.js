/* global artifacts */
const fse = require('fs-extra')

const Moloch = artifacts.require('./Moloch.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')

const foundersJSON = require('./founders.json')
const configJSON = require('./config.json')

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {
    await deployer.deploy(LootToken)
    await deployer.deploy(GuildBank, LootToken.address)
    await deployer.deploy(
      Moloch,
      LootToken.address,
      GuildBank.address,
      foundersJSON.addresses,
      foundersJSON.votingShares,
      configJSON.PERIOD_DURATION_IN_SECONDS,
      configJSON.VOTING_DURATON_IN_PERIODS,
      configJSON.GRACE_DURATON_IN_PERIODS,
      configJSON.MIN_PROPOSAL_DEPOSIT_IN_WEI
    )
  })
}
