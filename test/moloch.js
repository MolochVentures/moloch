/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

const Moloch = artifacts.require('./Moloch')
const VotingShares = artifacts.require('./VotingShares')
const LootToken = artifacts.require('./LootToken')
const GuildBank = artifacts.require('./GuildBank')
const SimpleToken = artifacts.require('./SimpleToken')
const Voting = artifacts.require('./Voting')

contract('Moloch', accounts => {
  const FOUNDING_MEMBER_1 = accounts[9]
  const FOUNDING_MEMBER_2 = accounts[8]
  const MOLOCH_ADMIN = accounts[0]

  before('should add founding members moloch with founders', async () => {
    this.FOUNDING_MEMBERS = [
      {
        memberAddress: FOUNDING_MEMBER_1,
        votingShares: 100
      },
      {
        memberAddress: FOUNDING_MEMBER_2,
        votingShares: 200
      }
    ]

    this.moloch = await Moloch.deployed()
    const votingShares = await VotingShares.deployed()
    const lootToken = await LootToken.deployed()
    const guildBank = await GuildBank.deployed()

    // transfer ownership of dependent contracts to moloch contract
    await Promise.all([
      votingShares.transferOwnership(this.moloch.address, {
        from: MOLOCH_ADMIN
      }),
      lootToken.transferOwnership(this.moloch.address, { from: MOLOCH_ADMIN }),
      guildBank.transferOwnership(this.moloch.address, { from: MOLOCH_ADMIN })
    ])

    let [votingSharesAddr, lootTokenAddr, guildBankAddr] = await Promise.all([
      this.moloch.votingShares.call(),
      this.moloch.lootToken.call(),
      this.moloch.guildBank.call()
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

    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (member, index) => {
        let mem = await this.moloch.getMember.call(member.memberAddress)
        assert.equal(mem, false, 'Member was approved before adding to guild')

        await this.moloch.addFoundingMember(
          member.memberAddress,
          member.votingShares,
          { from: MOLOCH_ADMIN }
        )

        mem = await this.moloch.getMember.call(member.memberAddress)
        assert.equal(mem, true, 'Member was not approved after adding to guild')
      })
    )
  })

  it('should be owned', async () => {
    const owner = await this.moloch.owner.call()
    assert.equal(owner, MOLOCH_ADMIN, 'Owner is incorrect')
  })

  it('should mint voting shares and loot tokens', async () => {
    const votingSharesAddr = await this.moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const lootTokenAddr = await this.moloch.lootToken.call()
    const lootToken = await LootToken.at(lootTokenAddr)

    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (member, index) => {
        const balance = await votingShares.balanceOf.call(member.memberAddress)
        assert.equal(
          balance.toNumber(),
          member.votingShares,
          'Voting shares incorrectly minted'
        )
      })
    )

    const lootTokens = await lootToken.balanceOf(this.moloch.address)
    const totalLootTokens = this.FOUNDING_MEMBERS.reduce(
      (total, member) => total + member.votingShares,
      0
    )
    assert.equal(
      lootTokens.toNumber(),
      totalLootTokens,
      'Loot tokens incorrectly minted'
    )
  })

  const PROPOSAL_TYPE_MEMBERSHIP = 0
  const PROPOSAL_PHASE_PROPOSED = 0
  const PROPOSAL_PHASE_VOTING = 1

  it('should submit application with eth', async () => {
    const ETH_TRIBUTE = web3.toWei(1, 'ether')
    const VOTING_SHARES = 1000
    const APPLICANT_ADDRESS = accounts[2]

    // check current proposal index
    const index = await this.moloch.getCurrentProposalIndex.call()
    assert.equal(index, 0, 'Current proposal index did not start at 0')

    await this.moloch.createMemberProposal(
      APPLICANT_ADDRESS,
      [],
      [],
      VOTING_SHARES,
      {
        from: FOUNDING_MEMBER_1,
        value: ETH_TRIBUTE
      }
    )

    const proposal = await this.moloch.getCurrentProposalCommonDetails.call()
    assert.equal(proposal[0], FOUNDING_MEMBER_1, 'Proposer address incorrect')
    assert.equal(
      proposal[1],
      PROPOSAL_TYPE_MEMBERSHIP,
      'Proposal type is not "membership"'
    )
    assert.equal(proposal[2], VOTING_SHARES, 'Proposal voting shares incorrect')
    assert.equal(
      proposal[3],
      PROPOSAL_PHASE_PROPOSED,
      'Proposal phase is not "proposed"'
    )
  })

  it('should start voting process', async () => {
    await this.moloch.startProposalVote({ from: FOUNDING_MEMBER_2 })

    const proposal = await this.moloch.getCurrentProposalCommonDetails.call()
    assert.equal(
      proposal[3],
      PROPOSAL_PHASE_VOTING,
      'Proposal phase is not "voting"'
    )

    const votingSharesAddr = await this.moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const totalSupply = await votingShares.totalSupply.call()

    const ballot = await this.moloch.getCurrentProposalBallot.call()
    assert.equal(ballot[1].toNumber(), totalSupply.div(2).toNumber())
  })

  /*
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
    const VOTING_SHARES_FRACTION = 0.5

    const moloch = await Moloch.deployed()

    const votingSharesAddr = await moloch.votingShares.call()
    const votingShares = await VotingShares.at(votingSharesAddr)
    const votingSharesSupply = await votingShares.totalSupply()

    // verify ballot
    const member = await moloch.getMember.call(APPLICANT_ADDRESS)
    const ballot = await Voting.at(member[5])

    const votingSharesRequired = await ballot.numVotesRequired.call()
    assert.equal(
      votingSharesRequired.toNumber(),
      votingSharesSupply * VOTING_SHARES_FRACTION
    )
    await Promise.all(
      this.FOUNDING_MEMBERS.map(async (foundingMember, index) => {
        const v = await ballot.hasVoteDurationPeriodElapsed()
        assert.equal(v, false)
        // submit votes
        await moloch.voteOnMemberApplication(APPLICANT_ADDRESS, true, {
          from: foundingMember.memberAddress
        })
        const voter = await ballot.getVoter(foundingMember.memberAddress)
        assert.equal(voter[0], true)
        assert.equal(voter[1].toNumber(), ACCEPT_MEMBER_BALLOT_PROPOSAL)
      })
    )
  })

  it('should accept member after vote is complete', async () => {
    const VOTING_SHARES = 100
    const APPLICANT_ADDRESS = accounts[1]
    const BALLOT_INDEX_OF_MEMBER_ACCEPTED = 1

    const moloch = await Moloch.deployed()

    let member = await moloch.getMember.call(APPLICANT_ADDRESS)
    const ballot = await Voting.at(member[5])
    assert.equal(member[0], false, 'Member was approved before being accepted.')

    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve()
      }, 5000)
    })

    const winningProposal = await ballot.getWinnerProposal()
    assert.equal(winningProposal, BALLOT_INDEX_OF_MEMBER_ACCEPTED)

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
  }) */
})
