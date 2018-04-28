/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const VotingShares = artifacts.require('./VotingShares.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')
const TownHallLib = artifacts.require('./TownHallLib.sol')
const VotingLib = artifacts.require('./VotingLib.sol')

module.exports = (deployer, network, accounts) => {
  deployer.deploy(VotingShares)
    .then(() => {
      return deployer.deploy(VotingLib)
    })
    .then(() => {
      deployer.link(VotingLib, TownHallLib)
      return deployer.deploy(TownHallLib)
    })
    .then(() => {
      return deployer.deploy(LootToken)
    })
    .then(() => {
      return deployer.deploy(GuildBank, LootToken.address)
    })
    .then(() => {
      deployer.link(TownHallLib, Moloch)
      return deployer.deploy(
        Moloch,
        VotingShares.address,
        LootToken.address,
        GuildBank.address,
        ["0xb93d509ee94531c17695c315e833a133b014e5e6", "0x789c38380d8c431b3ab70cb578b6566e8e4f6684"],
        [123, 456]
      )
    })
}
