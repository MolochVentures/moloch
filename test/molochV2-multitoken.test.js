// v2 test spec

// New Edge Cases
// - ragequit with multiple tokens in guildbank
// - ragequit too many tokens (loop should run out of gas)
// - ragequit one less than too many tokens
// - safeRagequit even when there are too many tokens to ragequit
//   - might not work with simply 1 less b/c gas cost of providing token array
// - processProposal after emergencyExitWait expires
//   - [setup] -> break a whitelisted token in the guildbank on purpose
//   - proposal after it in queue should be able to be processed immediately
//   - broken tribute tokens must not be returned (check balance)
// - processProposal guildkick auto-fails b/c of token transfer restriction
//   - proposal can still be processed after emergencyExitWait expires

const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const revertMesages = {
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorPeriodDurationCannotBe0: '_periodDuration cannot be 0',
  molochConstructorVotingPeriodLengthCannotBe0: '_votingPeriodLength cannot be 0',
  molochConstructorVotingPeriodLengthExceedsLimit: '_votingPeriodLength exceeds limit',
  molochConstructorGracePeriodLengthExceedsLimit: '_gracePeriodLength exceeds limit',
  molochConstructorEmergencyExitWaitCannotBe0: '_emergencyExitWait cannot be 0',
  molochConstructorDilutionBoundCannotBe0: '_dilutionBound cannot be 0',
  molochConstructorDilutionBoundExceedsLimit: '_dilutionBound exceeds limit',
  molochConstructorNeedAtLeastOneApprovedToken: 'need at least one approved token',
  molochConstructorDepositCannotBeSmallerThanProcessingReward: '_proposalDeposit cannot be smaller than _processingReward',
  molochConstructorApprovedTokenCannotBe0: '_approvedToken cannot be 0',
  molochConstructorDuplicateApprovedToken: 'revert duplicate approved token',
  submitProposalProposalMustHaveBeenProposed: 'proposal must have been proposed',
  submitProposalTributeTokenIsNotWhitelisted: 'tributeToken is not whitelisted',
  submitProposalPaymetTokenIsNotWhitelisted: 'payment is not whitelisted',
  submitProposalApplicantCannotBe0: 'revert applicant cannot be 0',
  submitWhitelistProposalMustProvideTokenAddress: 'must provide token address',
  submitWhitelistProposalAlreadyHaveWhitelistedToken: 'can\'t already have whitelisted the token',
  submitGuildKickProposalMemberMustHaveAtLeastOneShare: 'member must have at least one share',
  sponsorProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  sponsorProposalProposalHasAlreadyBeenCancelled: 'proposal has been cancelled',
  sponsorProposalAlreadyProposedToWhitelist: 'already proposed to whitelist',
  sponsorProposalAlreadyProposedToKick: 'already proposed to kick',
  sponsorProposalTooManySharesRequested: 'too many shares requested',
  submitVoteProposalDoesNotExist: 'proposal does not exist',
  submitVoteMustBeLessThan3: 'must be less than 3',
  submitVoteVotingPeriodHasNotStarted: 'voting period has not started',
  submitVoteVotingPeriodHasExpired: 'voting period has expired',
  submitVoteMemberHasAlreadyVoted: 'member has already voted',
  submitVoteVoteMustBeEitherYesOrNo: 'vote must be either Yes or No',
  cancelProposalProposalHasAlreadyBeenSponsored: 'proposal has already been sponsored',
  cancelProposalOnlyTheProposerCanCancel: 'only the proposer can cancel',
  processProposalProposalDoesNotExist: 'proposal does not exist',
  processProposalProposalIsNotReadyToBeProcessed: 'proposal is not ready to be processed',
  processProposalProposalHasAlreadyBeenProcessed: 'proposal has already been processed',
  processProposalPreviousProposalMustBeProcessed: 'previous proposal must be processed',
  molochNotAMember: 'not a member',
  molochRageQuitInsufficientShares: 'insufficient shares',
  updateDelegateKeyNewDelegateKeyCannotBe0: 'newDelegateKey cannot be 0',
  updateDelegateKeyCantOverwriteExistingMembers: 'cant overwrite existing members',
  updateDelegateKeyCantOverwriteExistingDelegateKeys: 'cant overwrite existing delegate keys',
  canRageQuitProposalDoesNotExist: 'proposal does not exist',
  molochSafeRageQuitTokenMustBeWhitelisted: 'token must be whitelisted',
  molochSafeRageQuitTokenListMustBeUniqueAndInAscendingOrder: 'token list must be unique and in ascending order',
  getMemberProposalVoteMemberDoesntExist: 'member doesn\'t exist',
  getMemberProposalVoteProposalDoesntExist: 'proposal doesn\'t exist'
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18
const _1e18Plus1 = _1e18.add(_1)
const _10e18 = new BN('10000000000000000000') // 10e18
const _10e18Plus1 = _10e18.add(_1)

async function blockTime () {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
}

async function snapshot () {
  return ethereum.send('evm_snapshot', [])
}

async function restore (snapshotId) {
  return ethereum.send('evm_revert', [snapshotId])
}

async function forceMine () {
  return ethereum.send('evm_mine', [])
}

const deploymentConfig = {
  'PERIOD_DURATION_IN_SECONDS': 17280,
  'VOTING_DURATON_IN_PERIODS': 35,
  'GRACE_DURATON_IN_PERIODS': 35,
  'EMERGENCY_EXIT_WAIT_IN_PERIODS': 35,
  'PROPOSAL_DEPOSIT': 10,
  'DILUTION_BOUND': 3,
  'PROCESSING_REWARD': 1,
  'TOKEN_SUPPLY': 10000
}

async function moveForwardPeriods (periods) {
  await blockTime()
  const goToTime = deploymentConfig.PERIOD_DURATION_IN_SECONDS * periods
  await ethereum.send('evm_increaseTime', [goToTime])
  await forceMine()
  await blockTime()
  return true
}

contract('Moloch', ([creator, summoner, applicant1, applicant2, processor, delegateKey, nonMemberAccount, ...otherAccounts]) => {
  let moloch, guildBank, tokenAlpha, tokenBeta
  let proposal1, proposal2, depositToken

  const initSummonerBalance = 100

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 100
  const standardTribute = 100

  let snapshotId

  const fundAndApproveToMoloch = async ({ token, to, from, value }) => {
    await token.transfer(to, value, { from: from })
    await token.approve(moloch.address, value, { from: to })
  }

  before('deploy contracts', async () => {
    tokenAlpha = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })
    tokenBeta = await Token.new(deploymentConfig.TOKEN_SUPPLY, { from: creator })

    moloch = await Moloch.new(
      summoner,
      [tokenAlpha.address, tokenBeta.address],
      deploymentConfig.PERIOD_DURATION_IN_SECONDS,
      deploymentConfig.VOTING_DURATON_IN_PERIODS,
      deploymentConfig.GRACE_DURATON_IN_PERIODS,
      deploymentConfig.EMERGENCY_EXIT_WAIT_IN_PERIODS,
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)

    depositToken = await moloch.depositToken()
    assert.equal(depositToken, tokenAlpha.address)

    depositToken = tokenAlpha
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: standardShareRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch ALPHA'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: standardShareRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenBeta.address,
      paymentRequested: 0,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch BETA'
    }

    tokenAlpha.transfer(summoner, initSummonerBalance, { from: creator })
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('rageQuit - multi-token', () => {
    beforeEach(async () => {
      // 1st proposal for with token alpha tribute
      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: proposal1.applicant,
        from: creator,
        value: proposal1.tributeOffered
      })

      await moloch.submitProposal(
        proposal1.applicant,
        proposal1.sharesRequested,
        proposal1.tributeOffered,
        proposal1.tributeToken,
        proposal1.paymentRequested,
        proposal1.paymentToken,
        proposal1.details,
        { from: proposal1.applicant }
      )

      await fundAndApproveToMoloch({
        token: tokenAlpha,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(firstProposalIndex, { from: summoner })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        proposalIndex: firstProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAtYesVote: 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyProcessProposal({
        proposalIndex: firstProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + 1, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: 1
      })

      await verifyFlags({
        proposalIndex: firstProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance + deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD
      })

      await verifyMember({
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedMemberAddressByDelegateKey: proposal1.applicant
      })

      // 2nd proposal for with token beta tribute
      await fundAndApproveToMoloch({
        token: tokenBeta,
        to: proposal2.applicant,
        from: creator,
        value: proposal2.tributeOffered
      })

      await moloch.submitProposal(
        proposal2.applicant,
        proposal2.sharesRequested,
        proposal2.tributeOffered,
        proposal2.tributeToken,
        proposal2.paymentRequested,
        proposal2.paymentToken,
        proposal2.details,
        { from: proposal2.applicant }
      )

      await fundAndApproveToMoloch({
        token: depositToken,
        to: summoner,
        from: creator,
        value: deploymentConfig.PROPOSAL_DEPOSIT
      })

      await moloch.sponsorProposal(secondProposalIndex, { from: summoner })

      await verifyFlags({
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, false, false, false, false, false]
      })

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await verifySubmitVote({
        proposalIndex: secondProposalIndex,
        memberAddress: summoner,
        expectedMaxSharesAtYesVote: proposal1.sharesRequested + 1,
        expectedVote: yes
      })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyProcessProposal({
        proposalIndex: secondProposalIndex,
        expectedYesVotes: 1,
        expectedTotalShares: proposal1.sharesRequested + proposal2.sharesRequested + 1, // add the 1 the summoner has
        expectedFinalTotalSharesRequested: 0,
        expectedMaxSharesAtYesVote: proposal1.sharesRequested + 1
      })

      await verifyFlags({
        proposalIndex: secondProposalIndex,
        expectedFlags: [true, true, true, false, false, false]
      })

      await verifyBalances({
        token: tokenBeta,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal2.tributeOffered, // tribute now in bank
        applicant: proposal2.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: 0, // sponsor in deposit token (not this one)
        processor: processor,
        expectedProcessorBalance: 0 // rewarded in deposit token
      })

      // check sponsor in deposit token returned
      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: 0,
        guildBank: guildBank.address,
        expectedGuildBankBalance: proposal1.tributeOffered, // tribute now in bank
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0,
        sponsor: summoner,
        expectedSponsorBalance: initSummonerBalance + ((deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2), // sponsor - deposit returned
        processor: processor,
        expectedProcessorBalance: deploymentConfig.PROCESSING_REWARD * 2
      })

      await verifyMember({
        member: proposal2.applicant,
        expectedDelegateKey: proposal2.applicant,
        expectedShares: proposal2.sharesRequested,
        expectedMemberAddressByDelegateKey: proposal2.applicant
      })
    })

    describe('happy path - ', () => {
      const sharesToQuit = 10
      beforeEach(async () => {
        await moloch.ragequit(sharesToQuit, { from: proposal1.applicant })
      })

      it('member shares reduced', async () => {
        await verifyMember({
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: 90,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        const totalShares = await moloch.totalShares()
        assert.equal(+totalShares, 1 + proposal1.sharesRequested + proposal2.sharesRequested - sharesToQuit)
      })
    })

    // describe('partial shares', () => {
    //   let emittedLogs
    //
    //   let partialRageQuitShares
    //
    //   beforeEach(async () => {
    //     partialRageQuitShares = 20
    //     const { logs } = await moloch.ragequit(partialRageQuitShares, { from: proposal1.applicant })
    //     emittedLogs = logs
    //   })
    //
    //   it('member shares reduced', async () => {
    //     await verifyMember({
    //       member: proposal1.applicant,
    //       expectedDelegateKey: proposal1.applicant,
    //       expectedShares: proposal1.sharesRequested - partialRageQuitShares,
    //       expectedMemberAddressByDelegateKey: proposal1.applicant
    //     })
    //
    //     const totalShares = await moloch.totalShares()
    //     // your remaining shares plus the summoners 1 share
    //     assert.equal(totalShares, (proposal1.sharesRequested - partialRageQuitShares) + 1)
    //   })
    //
    //   it('emits event', async () => {
    //     const log = emittedLogs[0]
    //     const { memberAddress, sharesToBurn } = log.args
    //     assert.equal(log.event, 'Ragequit')
    //     assert.equal(memberAddress, proposal1.applicant)
    //     assert.equal(sharesToBurn, partialRageQuitShares)
    //   })
    // })
    //
    // describe('require fail - ', () => {
    //   it('not a member', async () => {
    //     await moloch.ragequit(1, { from: nonMemberAccount })
    //       .should.be.rejectedWith(revertMesages.molochNotAMember)
    //   })
    //
    //   it('requesting more shares than you own', async () => {
    //     await moloch.ragequit(proposal1.sharesRequested + 1, { from: proposal1.applicant })
    //       .should.be.rejectedWith(revertMesages.molochRageQuitInsufficientShares)
    //   })
    //
    //   describe('when a proposal is in flight', () => {
    //     beforeEach(async () => {
    //       await fundAndApproveToMoloch({
    //         to: proposal2.applicant,
    //         from: creator,
    //         value: proposal1.tributeOffered
    //       })
    //
    //       await moloch.submitProposal(
    //         proposal2.applicant,
    //         proposal2.sharesRequested,
    //         proposal2.tributeOffered,
    //         proposal2.tributeToken,
    //         proposal2.paymentRequested,
    //         proposal2.paymentToken,
    //         proposal2.details,
    //         { from: proposal2.applicant }
    //       )
    //
    //       await fundAndApproveToMoloch({
    //         to: summoner,
    //         from: creator,
    //         value: deploymentConfig.PROPOSAL_DEPOSIT
    //       })
    //
    //       await moloch.sponsorProposal(secondProposalIndex, { from: summoner })
    //
    //       await verifyFlags({
    //         proposalIndex: secondProposalIndex,
    //         expectedFlags: [true, false, false, false, false, false]
    //       })
    //
    //       await moveForwardPeriods(1)
    //       await moloch.submitVote(secondProposalIndex, yes, { from: summoner })
    //
    //       await verifySubmitVote({
    //         proposalIndex: secondProposalIndex,
    //         memberAddress: summoner,
    //         expectedMaxSharesAtYesVote: proposal1.sharesRequested + 1,
    //         expectedVote: yes
    //       })
    //     })
    //
    //     it('unable to quit when proposal in flight', async () => {
    //       await moloch.ragequit(secondProposalIndex, { from: summoner })
    //         .should.be.rejectedWith('cant ragequit until highest index proposal member voted YES on is processed')
    //     })
    //   })
    // })
  })

  // VERIFY PROPOSAL
  const verifyProposal = async (
    {
      proposal,
      proposalIndex,
      proposer,
      sponsor = zeroAddress,
      expectedStartingPeriod = 0,
      expectedProposalCount = 0,
      expectedProposalQueueLength = 0
    }
  ) => {
    const proposalData = await moloch.proposals(proposalIndex)

    const proposalCount = await moloch.proposalCount()
    assert.equal(+proposalCount, expectedProposalCount)

    const proposalQueueLength = await moloch.getProposalQueueLength()
    assert.equal(+proposalQueueLength, expectedProposalQueueLength)

    assert.equal(proposalData.applicant, proposal.applicant)
    assert.equal(proposalData.proposer, proposer, 'proposers does not match')
    assert.equal(proposalData.sponsor, sponsor, 'sponsor does not match')

    assert.equal(proposalData.sharesRequested, proposal.sharesRequested, 'sharesRequested does not match')

    assert.equal(proposalData.tributeOffered, proposal.tributeOffered, 'tributeOffered does not match')
    assert.equal(proposalData.tributeToken, proposal.tributeToken, 'tributeToken does not match')

    assert.equal(proposalData.paymentRequested, proposal.paymentRequested, 'paymentRequested does not match')
    assert.equal(proposalData.paymentToken, proposal.paymentToken, 'paymentToken does not match')

    assert.equal(+proposalData.startingPeriod, expectedStartingPeriod, 'startingPeriod does not match')
    assert.equal(proposalData.yesVotes, 0, 'yesVotes does not match')
    assert.equal(proposalData.noVotes, 0, 'noVotes does not match')
    assert.equal(proposalData.details, proposal.details, 'details does not match')
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0, 'maxTotalSharesAtYesVote invalid')
  }

  const verifyFlags = async ({ proposalIndex, expectedFlags }) => {
    const actualFlags = await moloch.getProposalFlags(proposalIndex)

    // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
    assert.equal(actualFlags[0], expectedFlags[0], 'sponsored flag incorrect')
    assert.equal(actualFlags[1], expectedFlags[1], 'processed flag incorrect')
    assert.equal(actualFlags[2], expectedFlags[2], 'didPass flag incorrect')
    assert.equal(actualFlags[3], expectedFlags[3], 'cancelled flag incorrect')
    assert.equal(actualFlags[4], expectedFlags[4], 'whitelist flag incorrect')
    assert.equal(actualFlags[5], expectedFlags[5], 'guildkick flag incorrect')
  }

  const verifyBalance = async ({ token, address, expectedBalance }) => {
    const balance = await token.balanceOf(address)
    assert.equal(+balance, expectedBalance, `token balance incorrect for ${token.address} with ${address}`)
  }

  const verifyBalances = async (
    {
      token,
      moloch,
      expectedMolochBalance,
      guildBank,
      expectedGuildBankBalance,
      applicant,
      expectedApplicantBalance,
      sponsor,
      expectedSponsorBalance,
      processor,
      expectedProcessorBalance
    }
  ) => {
    const molochBalance = await token.balanceOf(moloch)
    assert.equal(+molochBalance, expectedMolochBalance, `moloch token balance incorrect for ${token.address} with ${moloch}`)

    const guildBankBalance = await token.balanceOf(guildBank)
    assert.equal(+guildBankBalance, expectedGuildBankBalance, `Guild Bank token balance incorrect for ${token.address} with ${guildBank}`)

    const applicantBalance = await token.balanceOf(applicant)
    assert.equal(+applicantBalance, expectedApplicantBalance, `Applicant token balance incorrect for ${token.address} with ${applicant}`)

    const sponsorBalance = await token.balanceOf(sponsor)
    assert.equal(+sponsorBalance, expectedSponsorBalance, `Sponsor token balance incorrect for ${token.address} with ${sponsor}`)

    const processorBalance = await token.balanceOf(processor)
    assert.equal(+processorBalance, expectedProcessorBalance, `Processor token balance incorrect for ${token.address} with ${processor}`)
  }

  const verifyAllowance = async ({ token, owner, spender, expectedAllowance }) => {
    const allowance = await token.allowance(owner, spender)
    assert.equal(+allowance, expectedAllowance, `allowance incorrect for ${token.address} owner ${owner} spender ${spender}`)
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (
    {
      proposalIndex,
      memberAddress,
      expectedVote,
      expectedMaxSharesAtYesVote = 0,
      initialYesVotes = 0,
      initialNoVotes = 0
    }
  ) => {
    const proposalData = await moloch.proposals(proposalIndex)
    assert.equal(+proposalData.yesVotes, initialYesVotes + (expectedVote === 1 ? 1 : 0))
    assert.equal(+proposalData.noVotes, initialNoVotes + (expectedVote === 1 ? 0 : 1))
    assert.equal(+proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)

    const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
    assert.equal(+memberVote, expectedVote)
  }

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (
    {
      proposalIndex,
      expectedYesVotes = 0,
      expectedNoVotes = 0,
      expectedTotalShares = 0,
      expectedFinalTotalSharesRequested = 0,
      expectedMaxSharesAtYesVote = 0
    }
  ) => {
    // flags and proposal data
    const proposalData = await moloch.proposals(proposalIndex)

    assert.equal(+proposalData.yesVotes, expectedYesVotes, 'proposal yes votes incorrect')
    assert.equal(+proposalData.noVotes, expectedNoVotes, 'proposal no votes incorrect')
    assert.equal(+proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote, 'total shares at yes vote incorrect')

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(+totalSharesRequested, expectedFinalTotalSharesRequested, 'total shares requested incorrect')

    const totalShares = await moloch.totalShares()
    assert.equal(+totalShares, expectedTotalShares, 'total shares incorrect')
  }

  const verifyMember = async (
    {
      member,
      expectedDelegateKey = zeroAddress,
      expectedShares = 0,
      expectedExists = true,
      expectedHighestIndexYesVote = 0,
      expectedMemberAddressByDelegateKey = zeroAddress
    }
  ) => {
    const memberData = await moloch.members(member)
    assert.equal(memberData.delegateKey, expectedDelegateKey, 'delegate key incorrect')
    assert.equal(+memberData.shares, expectedShares, 'expected shares incorrect')
    assert.equal(memberData.exists, expectedExists, 'exists incorrect')
    assert.equal(memberData.highestIndexYesVote, expectedHighestIndexYesVote, 'highest index yes vote incorrect')

    const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(expectedDelegateKey)
    assert.equal(newMemberAddressByDelegateKey, expectedMemberAddressByDelegateKey, 'member address by delegate key incorrect')
  }
})
