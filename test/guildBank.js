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

contract('GuildBank', ([creator, shareHolder, random, ...otherAccounts]) => {
  let guildBank, tokens, tokenAlpha
  let snapshotId

  const fromCreator = {from: creator};

  before('deploy contracts', async () => {
    tokens = [
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
      await Token.new(deploymentConfig.TOKEN_SUPPLY),
    ];

    guildBank = await GuildBank.new();

    tokenAlpha = tokens[0];
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
    // Withdrawal scenario
    const sharesToWithdraw = 10;
    const totalDAOShares = 100;

    it('happy case', async () => {
      const contractTokenBalancesBefore = {};
      for(let i = 0; i < tokens.length; i++) {
        contractTokenBalancesBefore[tokens[i].address] = await tokens[i].balanceOf(guildBank.address);
      }

      await guildBank.withdraw(
        shareHolder,
        sharesToWithdraw,
        totalDAOShares,
        tokens.map(token => token.address),
        fromCreator
      );

      await verifyWithdraw(shareHolder, sharesToWithdraw, totalDAOShares, tokens, contractTokenBalancesBefore);
    });

    it('require revert - asking to withdraw a share amount that exceeds the token balance', async function () {
      // This causes the transfer in the method to fail
      await guildBank.withdraw(
        shareHolder,
        totalDAOShares + 1,
        totalDAOShares,
        tokens.map(token => token.address),
        fromCreator
      ).should.be.rejectedWith(SolRevert);
    });

    it('modifier - onlyOwner', async function () {
      await guildBank.withdraw(
        shareHolder,
        sharesToWithdraw,
        totalDAOShares,
        tokens.map(token => token.address),
        { from: random }
      ).should.be.rejectedWith(SolRevert);
    });
  });

  describe('withdrawToken', () => {
    it('happy path', async function () {
      const withdrawalAmount = 50;
      await guildBank.withdrawToken(
        tokenAlpha.address,
        shareHolder,
        withdrawalAmount,
        fromCreator
      );
      await verifyWithdrawToken(tokenAlpha, shareHolder, withdrawalAmount);
    });

    it('require revert - withdrawing an amount of token that exceeds the contract balance', async function () {
      let guildBankTokenAlphaBalance = await tokenAlpha.balanceOf(guildBank.address);
      guildBankTokenAlphaBalance = Number(guildBankTokenAlphaBalance.toString());

      const withdrawalAmount = guildBankTokenAlphaBalance + 1;

      await guildBank.withdrawToken(
        tokenAlpha.address,
        shareHolder,
        withdrawalAmount,
        fromCreator
      ).should.be.rejectedWith(SolRevert);
    });

    it('modifier - onlyOwner', async function () {
      await guildBank.withdrawToken(
        tokenAlpha.address,
        shareHolder,
        25,
        { from: random }
      ).should.be.rejectedWith(SolRevert);
    });
  });

  const verifyWithdraw = async (receiver, shares, totalShares, tokens, contractTokenBalancesBefore) => {
    for(let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const contractTokenBalanceBefore = contractTokenBalancesBefore[token.address];
      const amountReceiverShouldHaveReceived = contractTokenBalanceBefore.mul(new BN(shares.toString())).div(new BN(totalShares.toString()));
      const actualReceiverBalance = await token.balanceOf(receiver);
      assert.equal(actualReceiverBalance.toString(), amountReceiverShouldHaveReceived.toString());
      //todo: check for event emitted
    }
  };

  const verifyWithdrawToken = async (token, receiver, amount) => {
    const receiverBalance = await token.balanceOf(receiver);
    assert.equal(receiverBalance.toString(), amount.toString());
  };
});