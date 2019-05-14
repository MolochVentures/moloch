/* global artifacts */
const fse = require('fs-extra')

const Moloch = artifacts.require('./Moloch')
const CurvedGuildBank = artifacts.require('./CurvedGuildBank')

const config = process.env.target != 'mainnet' ? require('./config.json').test : require('./config.json').mainnet

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {

    await deployer.deploy(
      Moloch,
      accounts[0],
      config.TOKEN_NAME,
      config.TOKEN_SYMBOL,
      config.PERIOD_DURATION_IN_SECONDS,
      config.VOTING_DURATON_IN_PERIODS,
      config.GRACE_DURATON_IN_PERIODS,
      config.ABORT_WINDOW_IN_PERIODS,
      config.DILUTION_BOUND,
      config.SLOPE_NUMERATOR,
      config.SLOPE_DENOMINATOR,
      config.SELL_PERCENTAGE,
      { gas: 6000000 }
    )
  })
}
