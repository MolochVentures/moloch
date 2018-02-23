/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const VotingShares = artifacts.require('./VotingShares')
const SimpleToken = artifacts.require('SimpleToken')

contract('Moloch', accounts => {
  it('should be owned', async () => {
    const moloch = await Moloch.deployed()
    const owner = await moloch.owner.call()
    assert.equal(owner, accounts[0])
  })

  it('should create voting shares', async () => {
    const INITIAL_VOTING_SHARES = 10000

    const moloch = await Moloch.deployed()
    const votingSharesAddr = await moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const balance = await votingShares.balanceOf.call(moloch.address)

    assert.equal(
      web3.fromWei(balance.toNumber(), 'ether'),
      INITIAL_VOTING_SHARES
    )
  })

  it('should submit application with eth', async () => {
    const ETH_TRIBUTE = web3.toWei(10, 'ether')

    const moloch = await Moloch.deployed()
    const result = await moloch.submitApplication(100, 0x0, 0, {
      value: ETH_TRIBUTE,
      from: accounts[1]
    })
    const log = result.logs.find(log => {
      return log.event === 'MemberApplication'
    })

    assert.equal(log.args.memberAddress, accounts[1])
    assert.equal(log.args.ethTributeAmount.toNumber(), ETH_TRIBUTE)
  })

  it('should submit application with tokens', async () => {
    const TOKEN_TRIBUTE = web3.toWei(10, 'ether')

    const simpleToken = await SimpleToken.new({ from: accounts[1] })
    const balance = await simpleToken.balanceOf.call(accounts[1])
    assert.equal(balance.toNumber(), web3.toWei(10000, 'ether'))

    const moloch = await Moloch.deployed()
    const result = await moloch.submitApplication(
      100,
      simpleToken.address,
      TOKEN_TRIBUTE,
      {
        from: accounts[1]
      }
    )
    const log = result.logs.find(log => {
      return log.event === 'MemberApplication'
    })

    assert.equal(log.args.tokenTributeAmount.toNumber(), TOKEN_TRIBUTE)
  })
})
