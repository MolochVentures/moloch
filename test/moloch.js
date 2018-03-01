/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const VotingShares = artifacts.require('./VotingShares')
const LootToken = artifacts.require('./LootToken')
const GuildBank = artifacts.require('./GuildBank')
const SimpleToken = artifacts.require('./SimpleToken')
const MemberApplicationBallot = artifacts.require('./MemberApplicationBallot')

contract('Moloch', accounts => {
  before('create moloch with founders', async () => {
    const TRIBUTE = web3.toWei(1, 'ether')
    const VOTING_SHARES = 100
    const FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR = accounts[9]
    const FOUNDING_MEMBER_ETH_TRIBUTE_ADDR = accounts[8]

    this.simpleToken = await SimpleToken.new({
      from: FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR
    })

    this.FOUNDING_MEMBERS = [
      {
        memberAddress: FOUNDING_MEMBER_ETH_TRIBUTE_ADDR,
        votingShares: VOTING_SHARES,
        ethTributeAmount: TRIBUTE,
        tokenTributeAddr: '0x0',
        tokenTributeAmount: 0
      },
      {
        memberAddress: FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR,
        votingShares: VOTING_SHARES,
        ethTributeAmount: 0,
        tokenTributeAddr: this.simpleToken.address,
        tokenTributeAmount: TRIBUTE
      }
    ]

    const moloch = await Moloch.deployed()
    const votingShares = await VotingShares.deployed()
    const lootToken = await LootToken.deployed()
    const guildBank = await GuildBank.deployed()

    // transfer ownership of dependent contracts to moloch contract
    await Promise.all([
      votingShares.transferOwnership(moloch.address),
      lootToken.transferOwnership(moloch.address),
      guildBank.transferOwnership(moloch.address)
    ])

    // set moloch addresses
    await Promise.all([
      moloch.setVotingShares(votingShares.address),
      moloch.setLootToken(lootToken.address),
      moloch.setGuildBank(guildBank.address)
    ])

    let [votingSharesAddr, lootTokenAddr, guildBankAddr] = await Promise.all([
      moloch.votingShares.call(),
      moloch.lootToken.call(),
      moloch.guildBank.call()
    ])

    assert.equal(
      votingSharesAddr,
      votingShares.address,
      'VotingShares contract address incorrect'
    )
    assert.equal(
      lootTokenAddr,
      lootToken.address,
      'LootToken contract address incorrect'
    )
    assert.equal(
      guildBankAddr,
      guildBank.address,
      'GuildBank contract address incorrect'
    )

    // transfer to moloch contract with application
    await this.simpleToken.transfer(moloch.address, TRIBUTE, {
      from: FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR
    })

    guildBankAddr = await moloch.guildBank.call()
    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (member, index) => {
        const result = await moloch.addFoundingMember(
          member.memberAddress,
          member.votingShares,
          member.tokenTributeAddr,
          member.tokenTributeAmount,
          { from: accounts[0], value: member.ethTributeAmount }
        )

        const approved = result.logs.find(log => {
          return log.event === 'MemberAccepted'
        })

        assert.equal(
          approved.args.memberAddress,
          this.FOUNDING_MEMBERS[index].memberAddress,
          'Member approval incorrectly logged'
        )
      })
    )

    // check guild bank balance
    let balance = web3.eth.getBalance(guildBankAddr)
    assert.equal(balance.toNumber(), TRIBUTE)

    balance = await this.simpleToken.balanceOf(guildBankAddr)
    assert.equal(balance.toNumber(), TRIBUTE)
  })

  it('should be owned', async () => {
    const moloch = await Moloch.deployed()
    const owner = await moloch.owner.call()
    assert.equal(owner, accounts[0])
  })

  it('should mint voting shares and loot tokens', async () => {
    const moloch = await Moloch.deployed()
    const votingSharesAddr = await moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const lootTokenAddr = await moloch.lootToken.call()
    const lootToken = await LootToken.at(lootTokenAddr)

    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (member, index) => {
        const balance = await votingShares.balanceOf.call(member.memberAddress)
        assert.equal(balance.toNumber(), member.votingShares)
      })
    )

    const lootTokens = await lootToken.balanceOf(moloch.address)
    const totalLootTokens = this.FOUNDING_MEMBERS.reduce(
      (total, member) => total + member.votingShares,
      0
    )
    assert.equal(lootTokens.toNumber(), totalLootTokens)
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
    assert.equal(requiredVoters.toNumber(), this.FOUNDING_MEMBERS.length)
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
    assert.equal(isAccepted, true)
  })
})
