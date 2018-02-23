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
    const votingSharesAddr = await moloch.votingSharesAddr.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const balance = await votingShares.balanceOf.call(moloch.address)

    assert.equal(
      web3.fromWei(balance.toNumber(), 'ether'),
      INITIAL_VOTING_SHARES
    )
  })

  it('should take founding members', async () => {
    const TRIBUTE = web3.toWei(10, 'ether')
    const VOTING_SHARES = 100
    const simpleToken = await SimpleToken.new({ from: accounts[9] })
    const FOUNDING_MEMBERS = [
      {
        memberAddress: accounts[8],
        votingShares: VOTING_SHARES,
        ethTributeAmount: TRIBUTE,
        tokenTributeAddr: '0x0',
        tokenTributeAmount: 0
      },
      {
        memberAddress: accounts[9],
        votingShares: VOTING_SHARES,
        ethTributeAmount: 0,
        tokenTributeAddr: simpleToken.address,
        tokenTributeAmount: TRIBUTE
      }
    ]

    const moloch = await Moloch.deployed()
    const promises = FOUNDING_MEMBERS.map(member => {
      return moloch.addFoundingMember(
        member.memberAddress,
        member.votingShares,
        member.tokenTributeAddr,
        member.tokenTributeAmount,
        { from: accounts[0], value: member.ethTributeAmount }
      )
    })
    const results = await Promise.all(promises)
    results.forEach((result, index) => {
      const approved = result.logs.find(log => {
        return log.event === 'MemberApproved'
      })
      assert.equal(approved.memberAddress, FOUNDING_MEMBERS.memberAddress)
    })
  })

  it('should submit application with eth', async () => {
    const ETH_TRIBUTE = web3.toWei(10, 'ether')
    const VOTING_SHARES = 100

    const moloch = await Moloch.deployed()
    const result = await moloch.submitApplication(VOTING_SHARES, 0x0, 0, {
      value: ETH_TRIBUTE,
      from: accounts[1]
    })
    const log = result.logs.find(log => {
      return log.event === 'MemberApplied'
    })

    assert.equal(log.args.memberAddress, accounts[1])
    assert.equal(log.args.ethTributeAmount.toNumber(), ETH_TRIBUTE)
  })

  it('should submit application with tokens', async () => {
    const TOKEN_TRIBUTE = web3.toWei(10, 'ether')
    const VOTING_SHARES = 100

    const simpleToken = await SimpleToken.new({ from: accounts[1] })
    const balance = await simpleToken.balanceOf.call(accounts[1])
    assert.equal(balance.toNumber(), web3.toWei(10000, 'ether'))

    const moloch = await Moloch.deployed()
    const result = await moloch.submitApplication(
      VOTING_SHARES,
      simpleToken.address,
      TOKEN_TRIBUTE,
      {
        from: accounts[1]
      }
    )
    const log = result.logs.find(log => {
      return log.event === 'MemberApplied'
    })

    assert.equal(log.args.tokenTributeAmount.toNumber(), TOKEN_TRIBUTE)
  })
})
