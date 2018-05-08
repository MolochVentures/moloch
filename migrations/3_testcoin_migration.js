/* global artifacts */
const fse = require('fs-extra')
const TestCoin = artifacts.require('./TestCoin.sol')

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {
    let testJSON = {addresses:[]}
    for (let i=0; i < 3; i++) {
      await deployer.deploy(TestCoin)
      testJSON.addresses.push(TestCoin.address)
    }
    await fse.writeJson('./test/testcoins.json', testJSON)
  })
}
