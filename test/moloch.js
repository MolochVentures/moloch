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
    const MOLOCH_ADMIN = accounts[0]

    this.simpleToken = await SimpleToken.new({
      from: FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR
    })

    this.FOUNDING_MEMBERS = [
      {
        memberAddress: FOUNDING_MEMBER_ETH_TRIBUTE_ADDR,
        votingShares: VOTING_SHARES,
        ethTributeAmount: TRIBUTE,
        tokenTributeAddr: [],
        tokenTributeAmount: []
      },
      {
        memberAddress: FOUNDING_MEMBER_TOKEN_TRIBUTE_ADDR,
        votingShares: VOTING_SHARES,
        ethTributeAmount: 0,
        tokenTributeAddr: [this.simpleToken.address],
        tokenTributeAmount: [TRIBUTE]
      }
    ]

    const moloch = await Moloch.deployed()
    const votingShares = await VotingShares.deployed()
    const lootToken = await LootToken.deployed()
    const guildBank = await GuildBank.deployed()

    // transfer ownership of dependent contracts to moloch contract
    await Promise.all([
      votingShares.transferOwnership(moloch.address, { from: MOLOCH_ADMIN }),
      lootToken.transferOwnership(moloch.address, { from: MOLOCH_ADMIN }),
      guildBank.transferOwnership(moloch.address, { from: MOLOCH_ADMIN })
    ])

    // set moloch addresses
    await Promise.all([
      moloch.setVotingShares(votingShares.address, { from: MOLOCH_ADMIN }),
      moloch.setLootToken(lootToken.address, { from: MOLOCH_ADMIN }),
      moloch.setGuildBank(guildBank.address, { from: MOLOCH_ADMIN })
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

    guildBankAddr = await moloch.guildBank.call()
    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (member, index) => {
        if (member.ethTributeAmount > 0) {
          await moloch.offerEthTribute({
            from: member.memberAddress,
            value: member.ethTributeAmount
          })
        }

        if (member.tokenTributeAddr.length > 0) {
          await Promise.all(
            member.tokenTributeAddr.map(async (addr, index) => {
              const token = await SimpleToken.at(addr)
              await token.approve(
                moloch.address,
                member.tokenTributeAmount[index],
                { from: member.memberAddress }
              )
              const allowed = await token.allowance.call(
                member.memberAddress,
                moloch.address
              )
              assert.equal(allowed, member.tokenTributeAmount[index])
            })
          )

          await moloch.offerTokenTribute(
            member.tokenTributeAddr,
            member.tokenTributeAmount,
            {
              from: member.memberAddress
            }
          )
        }

        const result = await moloch.addFoundingMember(
          member.memberAddress,
          member.votingShares,
          { from: MOLOCH_ADMIN }
        )

        const mem = await moloch.getMember(member.memberAddress)
        assert.equal(mem[0], true)

        const approved = result.logs.find(log => {
          return log.event === 'MemberAccepted'
        })

        assert.equal(
          approved.args.memberAddress,
          this.FOUNDING_MEMBERS[index].memberAddress,
          'Member approval incorrectly logged'
        )
        // check guild bank balance
        if (member.ethTributeAmount > 0) {
          const balance = web3.eth.getBalance(guildBankAddr)
          assert.equal(
            balance.toNumber(),
            TRIBUTE,
            'eth tribute not in guild bank'
          )
        }

        if (member.tokenTributeAddr.length > 0) {
          await Promise.all(
            member.tokenTributeAddr.map(async (addr, index) => {
              const token = await SimpleToken.at(addr)
              const balance = await token.balanceOf(guildBankAddr)
              assert.equal(balance.toNumber(), TRIBUTE)
            })
          )
        }
      })
    )
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
    const APPLICANT_ADDRESS = accounts[2]

    const moloch = await Moloch.deployed()
    await moloch.offerEthTribute({
      from: APPLICANT_ADDRESS,
      value: ETH_TRIBUTE
    })

    await moloch.submitApplication(VOTING_SHARES, {
      from: APPLICANT_ADDRESS
    })

    const member = await moloch.getMember(APPLICANT_ADDRESS)
    assert.equal(member[0], false)
    assert.equal(member[1].toNumber(), VOTING_SHARES)
    assert.equal(member[2].toNumber(), ETH_TRIBUTE)
  })

  it('should submit application with tokens', async () => {
    const TOKEN_TRIBUTE = web3.toWei(1, 'ether')
    const VOTING_SHARES = 100
    const APPLICANT_ADDRESS = accounts[1]

    const simpleToken = await SimpleToken.new({ from: APPLICANT_ADDRESS })
    let balance = await simpleToken.balanceOf.call(APPLICANT_ADDRESS)
    assert.equal(balance.toNumber(), web3.toWei(10000, 'ether'))

    const moloch = await Moloch.deployed()

    // transfer tokens for application
    await simpleToken.approve(moloch.address, TOKEN_TRIBUTE, {
      from: APPLICANT_ADDRESS
    })

    await moloch.offerTokenTribute([simpleToken.address], [TOKEN_TRIBUTE], {
      from: APPLICANT_ADDRESS
    })
    // submit application
    await moloch.submitApplication(VOTING_SHARES, {
      from: APPLICANT_ADDRESS
    })

    const member = await moloch.getMember(APPLICANT_ADDRESS)

    assert.equal(member[0], false)
    assert.equal(member[1].toNumber(), VOTING_SHARES)
    assert.equal(member[2].toNumber(), 0)
    assert.equal(member[3][0], simpleToken.address)
    assert.equal(member[4][0].toNumber(), TOKEN_TRIBUTE)
  })

  it('should accept votes from members', async () => {
    const APPLICANT_ADDRESS = accounts[1]
    const ACCEPT_MEMBER_BALLOT_PROPOSAL = 1

    const moloch = await Moloch.deployed()

    // verify ballot
    const member = await moloch.getMember.call(APPLICANT_ADDRESS)
    const ballot = await MemberApplicationBallot.at(member[5])

    const requiredVoters = await ballot.howManyVoters.call()
    assert.equal(requiredVoters.toNumber(), this.FOUNDING_MEMBERS.length)
    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (foundingMember, index) => {
        let voter = await ballot.requiredVoters.call(index)
        assert.equal(voter, foundingMember.memberAddress)

        // submit votes
        const vote = await moloch.voteOnMemberApplication(
          APPLICANT_ADDRESS,
          true,
          {
            from: foundingMember.memberAddress
          }
        )

        // vote for acceptance
        const log = vote.logs.find(log => {
          return log.event === 'VotedForMember'
        })
        assert.equal(log.args.votingMember, foundingMember.memberAddress)
        assert.equal(log.args.votedFor, APPLICANT_ADDRESS)
        assert.equal(log.args.accepted, true)

        voter = await ballot.getVoter(foundingMember.memberAddress)
        assert.equal(voter[1], true)
        assert.equal(voter[2].toNumber(), ACCEPT_MEMBER_BALLOT_PROPOSAL)
      })
    )
  })

  it('should accept member after vote is complete', async () => {
    const VOTING_SHARES = 100
    const APPLICANT_ADDRESS = accounts[1]

    const moloch = await Moloch.deployed()

    let member = await moloch.getMember.call(APPLICANT_ADDRESS)
    assert.equal(member[0], false, 'Member was approved before being accepted.')

    await moloch.acceptMember(APPLICANT_ADDRESS, {
      from: this.FOUNDING_MEMBERS[0].memberAddress
    })

    member = await moloch.getMember.call(APPLICANT_ADDRESS)
    assert.equal(member[0], true, 'Member was not approved.')

    const votingSharesAddr = await moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const lootTokenAddr = await moloch.lootToken.call()
    const lootToken = await LootToken.at(lootTokenAddr)
    let balance = await lootToken.balanceOf(APPLICANT_ADDRESS)
    assert.equal(
      balance.toNumber(),
      0,
      'Should have no loot tokens before exit.'
    )

    balance = await votingShares.balanceOf(APPLICANT_ADDRESS)
    assert.equal(
      balance.toNumber(),
      VOTING_SHARES,
      'Should have voting shares.'
    )

    const startingLootTokenBalance = await lootToken.balanceOf(moloch.address)

    await moloch.exitMoloch({ from: APPLICANT_ADDRESS })

    member = await moloch.getMember.call(APPLICANT_ADDRESS)
    assert.equal(member[0], false, 'Member did not get removed on exit.')

    balance = await lootToken.balanceOf(APPLICANT_ADDRESS)
    assert.equal(
      balance.toNumber(),
      VOTING_SHARES,
      'Should have loot tokens after exit.'
    )

    balance = await votingShares.balanceOf(APPLICANT_ADDRESS)
    assert.equal(
      balance.toNumber(),
      0,
      'Should have no voting shares after exit.'
    )

    const endingLootTokenBalance = await lootToken.balanceOf(moloch.address)
    assert.equal(
      startingLootTokenBalance.toNumber() - endingLootTokenBalance.toNumber(),
      VOTING_SHARES,
      'Should remove loot tokens from the overall pot owned by Moloch contract.'
    )
  })
})
