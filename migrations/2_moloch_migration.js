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
      configJSON.PROPOSAL_VOTE_TIME_SECONDS,
      configJSON.GRACE_PERIOD_SECONDS,
      configJSON.MIN_PROPOSAL_CREATION_DEPOSIT_WEI,
      { gas: 4000000 }
    )
    const lootToken = await LootToken.at(LootToken.address)
    await lootToken.transferOwnership(Moloch.address)
    const guildBank = await GuildBank.at(GuildBank.address)
    await guildBank.transferOwnership(Moloch.address)
    const moloch = await Moloch.at(Moloch.address)
    await moloch.addFoundingMembers(
      [accounts[0], accounts[1]],
      foundersJSON.shares
    )
    foundersJSON.addresses = [accounts[0], accounts[1]]
    await fse.writeJson('./founders.json', foundersJSON)
  })
}
