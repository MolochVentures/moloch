/* global artifacts */
const fse = require('fs-extra')

const Moloch = artifacts.require('./Moloch.sol')
const GuildBank = artifacts.require('./GuildBank.sol')
const Token = artifacts.require('./oz/ERC20.sol')

const config = require('./config.json')

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {

    const approvedToken = await deployer.deploy(Token, config.token.totalSupply, config.token.name, config.token.decimals, config.token.symbol)

    await deployer.deploy(
      Moloch,
      config.SUMMONER,
      approvedToken.address,
      config.PERIOD_DURATION_IN_SECONDS,
      config.VOTING_DURATON_IN_PERIODS,
      config.GRACE_DURATON_IN_PERIODS,
      config.PROPOSAL_DEPOSIT_IN_WEI,
      config.DILUTION_BOUND,
      config.PROCESSING_REWARD,
      { gas: 6000000 }
    )
  })
}
