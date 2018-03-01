/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const VotingShares = artifacts.require('./VotingShares.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')

module.exports = function (deployer, network, accounts) {
  deployer.deploy(VotingShares, {
    from: accounts[0],
    gas: 6700000
  })
  deployer.deploy(LootToken, {
    from: accounts[0],
    gas: 6700000
  })
  deployer.deploy(GuildBank, {
    from: accounts[0],
    gas: 6700000
  })
  deployer.deploy(Moloch, {
    from: accounts[0],
    gas: 6700000
  })
}
