const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

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

contract('GuildBank', ([creator, ...otherAccounts]) => {
  let guildBank, tokenAlpha, tokenBeta
  let snapshotId

  before('deploy contracts', async () => {
    guildBank = await GuildBank.new();
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
  })
});