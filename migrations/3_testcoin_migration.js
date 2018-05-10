/* global artifacts */
const TestCoin = artifacts.require('./TestCoin.sol')

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {
    await deployer.deploy(TestCoin, { from: accounts[0] })
    const testCoin = await TestCoin.at(TestCoin.address)
    const balance = await testCoin.balanceOf(accounts[0])
    const transferAmt = balance.div(accounts.length)
    await accounts.map(async account => {
      testCoin.transfer(account, transferAmt, { from: accounts[0] })
    })
  })
}
