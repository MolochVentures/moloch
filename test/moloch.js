/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const VotingShares = artifacts.require('./VotingShares')
const SimpleToken = artifacts.require('./SimpleToken')
const MemberApplicationBallot = artifacts.require('./MemberApplicationBallot')

contract('Moloch', accounts => {
  beforeEach('create moloch with founders', async () => {
    const TRIBUTE = web3.toWei(10, 'ether')
    const VOTING_SHARES = 100
    this.simpleToken = await SimpleToken.new({ from: accounts[9] })
    this.FOUNDING_MEMBERS = [
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
        tokenTributeAddr: this.simpleToken.address,
        tokenTributeAmount: TRIBUTE
      }
    ]

    const moloch = await Moloch.deployed()
    const promises = this.FOUNDING_MEMBERS.map(member => {
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
      assert.equal(approved.memberAddress, this.FOUNDING_MEMBERS.memberAddress)
    })
  })

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

  it('should take an application and collect votes for membership', async () => {
    const TOKEN_TRIBUTE = web3.toWei(10, 'ether')
    const VOTING_SHARES = 100
    const APPLICANT_ADDRESS = accounts[1]

    const simpleToken = await SimpleToken.new({ from: APPLICANT_ADDRESS })
    const balance = await simpleToken.balanceOf.call(APPLICANT_ADDRESS)
    assert.equal(balance.toNumber(), web3.toWei(10000, 'ether'))

    const moloch = await Moloch.deployed()

    // submit application
    const result = await moloch.submitApplication(
      VOTING_SHARES,
      simpleToken.address,
      TOKEN_TRIBUTE,
      {
        from: APPLICANT_ADDRESS
      }
    )
    let log = result.logs.find(log => {
      return log.event === 'MemberApplied'
    })
    assert.equal(log.args.tokenTributeAmount.toNumber(), TOKEN_TRIBUTE)

    // verify ballot
    const ballot = await MemberApplicationBallot.at(log.args.ballotAddress)
    let requiredVoters = await ballot.howManyVoters.call()
    console.log(requiredVoters.toNumber())
    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (foundingMember, index) => {
        let voter = await ballot.requiredVoters.call(index)
        assert.equal(voter, foundingMember.memberAddress)

        // submit votes
        let vote = await moloch.voteOnMemberApplication(
          APPLICANT_ADDRESS,
          true,
          {
            from: foundingMember.memberAddress
          }
        ) // vote for acceptance
        log = vote.logs.find(log => {
          return log.event === 'VotedForMember'
        })
        assert.equal(log.args.votingMember, foundingMember.memberAddress)
        assert.equal(log.args.votedFor, APPLICANT_ADDRESS)
        assert.equal(log.args.accepted, true)

        voter = await ballot.getVoter(foundingMember.memberAddress)
        assert.equal(voter[1], true)
        assert.equal(voter[2].toNumber(), 1)
      })
    )
    const isAccepted = await ballot.isAccepted()
    console.log(isAccepted)
    assert.equal(isAccepted, true)
  })
})
