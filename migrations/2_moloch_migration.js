/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')

module.exports = function (deployer, network, accounts) {
  deployer.deploy(Moloch, { from: accounts[0] })
}
