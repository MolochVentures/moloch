/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const TownHallLib = artifacts.require('./TownHallLib.sol')
const VotingLib = artifacts.require('./VotingLib.sol')

const foundersJSON = require('./founders.json')
const configJSON = require('./config.json')

module.exports = (deployer, network, accounts) => {
  deployer.deploy(VotingLib)
    .then(() => {
      deployer.link(VotingLib, TownHallLib)
      return deployer.deploy(TownHallLib)
    })
    .then(() => {
      deployer.link(TownHallLib, Moloch)
      return deployer.deploy(
        Moloch,
        foundersJSON.addresses,
        foundersJSON.shares,
        configJSON.PROPOSAL_VOTE_TIME_SECONDS,
        configJSON.GRACE_PERIOD_SECONDS,
        configJSON.MIN_PROPOSAL_CREATION_DEPOSIT_WEI
      )
    })
}
