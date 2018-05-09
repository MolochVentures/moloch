/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const TownHallLib = artifacts.require('./TownHallLib.sol')
const VotingLib = artifacts.require('./VotingLib.sol')
const VotingShares = artifacts.require('./VotingShares.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')

const foundersJSON = require('./founders.json')
const configJSON = require('./config.json')

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {
    await deployer.deploy(VotingLib)
    deployer.link(VotingLib, TownHallLib)
    await deployer.deploy(TownHallLib)
    await deployer.deploy(VotingShares)
    await deployer.deploy(LootToken)
    await deployer.deploy(GuildBank, LootToken.address)
    deployer.link(TownHallLib, Moloch)
    await deployer.deploy(
      Moloch,
      VotingShares.address,
      LootToken.address,
      GuildBank.address,
      configJSON.PROPOSAL_VOTE_TIME_SECONDS,
      configJSON.GRACE_PERIOD_SECONDS,
      configJSON.MIN_PROPOSAL_CREATION_DEPOSIT_WEI,
      { gas: 4000000 }
    )
    const votingShares = await VotingShares.at(VotingShares.address)
    await votingShares.transferOwnership(Moloch.address)
    const lootToken = await LootToken.at(LootToken.address)
    await lootToken.transferOwnership(Moloch.address)
    const guildBank = await GuildBank.at(GuildBank.address)
    await guildBank.transferOwnership(Moloch.address)
    const moloch = await Moloch.at(Moloch.address)
    await moloch.addFoundingMembers(
      [accounts[0], accounts[1]],
      foundersJSON.shares
    )
  })
}
