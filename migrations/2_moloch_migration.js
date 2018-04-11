/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const VotingShares = artifacts.require('./VotingShares.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')

module.exports = (deployer, network, accounts) => {
  deployer.deploy(VotingShares)
  .then(() => {
    return deployer.deploy(LootToken)
  })
  .then(() => {
    return deployer.deploy(GuildBank, LootToken.address)
  })
  .then(() => {
    return deployer.deploy(Moloch)
  })
}
