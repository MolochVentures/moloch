const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const deploymentConfig = {
  'TOKEN_SUPPLY': 10000
}

const revertMessages = {

}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'

async function snapshot () {
  return ethereum.send('evm_snapshot', [])
}

async function restore (snapshotId) {
  return ethereum.send('evm_revert', [snapshotId])
}

contract('GuildBank', ([creator, shareHolder, ...otherAccounts]) => {
  let guildBank, tokens
  let snapshotId

  const fromCreator = {from: creator};

  before('deploy contracts', async () => {
    tokens = [
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
    ];

    guildBank = await GuildBank.new();

    await tokens[0].transfer(guildBank.address, 1000, fromCreator);
    await tokens[1].transfer(guildBank.address, 450, fromCreator);
  });

  beforeEach(async () => {
    snapshotId = await snapshot()
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('constructor', () => {
    it('verify deployment parameters', async () => {
      const owner = await guildBank.owner();
      assert.equal(owner, creator);
    });
  });

  describe('withdraw', () => {
    it('happy case', async () => {
      const contractTokenBalancesBefore = {};
      for(let i = 0; i < tokens.length; i++) {
        contractTokenBalancesBefore[tokens[i].address] = await tokens[i].balanceOf(guildBank.address);
      }

      // Withdrawal scenario
      const sharesToWithdraw = 10;
      const totalDAOShares = 100;

      await guildBank.withdraw(
        shareHolder,
        sharesToWithdraw,
        totalDAOShares,
        tokens.map(token => token.address)
      );

      await verifyWithdraw(shareHolder, sharesToWithdraw, totalDAOShares, tokens, contractTokenBalancesBefore);
    });
  });

  const verifyWithdraw = async (receiver, shares, totalShares, tokens, contractTokenBalancesBefore) => {
    for(let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const contractTokenBalanceBefore = contractTokenBalancesBefore[token.address];
      const amountReceiverShouldHaveReceived = contractTokenBalanceBefore.mul(new BN(shares.toString())).div(new BN(totalShares.toString()));
      const actualReceiverBalance = await token.balanceOf(receiver);
      assert.equal(actualReceiverBalance.toString(), amountReceiverShouldHaveReceived.toString());
    }

    //todo: check for event emitted
  };
});