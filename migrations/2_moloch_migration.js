/* global artifacts */

const Moloch = artifacts.require('./Moloch.sol')
const VotingShares = artifacts.require('./VotingShares.sol')
const LootToken = artifacts.require('./LootToken.sol')
const GuildBank = artifacts.require('./GuildBank.sol')
const TownHall = artifacts.require('./TownHall.sol')

module.exports = (deployer, network, accounts) => {
  deployer.deploy(VotingShares)
  .then(() => {
    return deployer.deploy(LootToken)
  })
  .then(() => {
    return deployer.deploy(GuildBank, LootToken.address)
  })
  .then(() => {
    // uint constant PROPOSAL_VOTE_TIME_SECONDS = 5;
    // uint constant GRACE_PERIOD_SECONDS = 5;
    // uint constant MIN_PROPOSAL_CREATION_DEPOSIT = 10 ether;
    // uint constant LOSING_PROPOSAL_INDEX = 0;
    // uint constant WINNING_PROPOSAL_INDEX = 1;
    return deployer.deploy(TownHall, 5, 5, 10, 0, 1, 
      VotingShares.address, 
      GuildBank.address,
      LootToken.address
    )
  })
  .then(() => {
    return deployer.deploy(Moloch, TownHall.address, VotingShares.address, LootToken.address, GuildBank.address)
  })
}
