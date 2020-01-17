const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

const {
  verifyProposal,
  verifyFlags,
  verifyInternalBalance,
  verifyInternalBalances,
  verifyBalances,
  verifySubmitVote,
  verifyProcessProposal,
  verifyMember
} = require('./test-utils')

chai
  .use(require('chai-as-promised'))
  .should()

const Moloch = artifacts.require('./Moloch')
const Token = artifacts.require('./Token')

const revertMessages = {
  withdrawBalanceInsufficientBalance: 'insufficient balance',
  withdrawBalanceArrayLengthsMatch: 'tokens and amounts arrays must be matching lengths'
}

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const GUILD  = '0x000000000000000000000000000000000000dead'
const ESCROW = '0x000000000000000000000000000000000000beef'

const _1 = new BN('1')
const _1e18 = new BN('1000000000000000000') // 1e18

const _10e18 = new BN('10000000000000000000') // 10e18
const _100e18 = new BN('100000000000000000000') // 10e18

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
  'PROPOSAL_DEPOSIT': 10,
  'DILUTION_BOUND': 3,
  'PROCESSING_REWARD': 1,
  'TOKEN_SUPPLY': _100e18
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
  let moloch, tokenAlpha, tokenBeta
  let proposal1, proposal2, proposal3, depositToken

  const firstProposalIndex = 0
  const secondProposalIndex = 1
  const thirdProposalIndex = 2
  const invalidPropsalIndex = 123

  const yes = 1
  const no = 2

  const standardShareRequest = 1
  const standardLootRequest = 10
  const standardTribute = _1e18
  const summonerShares = 1

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
      deploymentConfig.PROPOSAL_DEPOSIT,
      deploymentConfig.DILUTION_BOUND,
      deploymentConfig.PROCESSING_REWARD
    )

    const depositTokenAddress = await moloch.depositToken()
    assert.equal(depositTokenAddress, tokenAlpha.address)

    depositToken = tokenAlpha
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    proposal1 = {
      applicant: applicant1,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenAlpha.address,
      paymentRequested: 0,
      paymentToken: tokenAlpha.address,
      details: 'all hail moloch ALPHA'
    }

    proposal2 = {
      applicant: applicant2,
      sharesRequested: standardShareRequest,
      lootRequested: standardLootRequest,
      tributeOffered: standardTribute,
      tributeToken: tokenBeta.address,
      paymentRequested: 0,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch BETA'
    }

    proposal3 = {
      applicant: applicant2,
      sharesRequested: 0,
      lootRequested: 0,
      tributeOffered: 0,
      tributeToken: tokenAlpha.address,
      paymentRequested: 10,
      paymentToken: tokenBeta.address,
      details: 'all hail moloch ALPHA tribute BETA payment'
    }
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe('multi-token ragequit + withdraw', async () => {
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
        proposal1.lootRequested,
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

      await moveForwardPeriods(1)
      await moloch.submitVote(firstProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(firstProposalIndex, { from: processor })

      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT)), // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD, // sponsor - deposit returned,
          [processor]: deploymentConfig.PROCESSING_REWARD
        }
      })

      await verifyMember({
        moloch: moloch,
        member: proposal1.applicant,
        expectedDelegateKey: proposal1.applicant,
        expectedShares: proposal1.sharesRequested,
        expectedLoot: proposal1.lootRequested,
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
        proposal2.lootRequested,
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

      await moveForwardPeriods(1)
      await moloch.submitVote(secondProposalIndex, yes, { from: summoner })

      await moveForwardPeriods(deploymentConfig.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(deploymentConfig.GRACE_DURATON_IN_PERIODS)

      await moloch.processProposal(secondProposalIndex, { from: processor })

      await verifyBalances({
        token: tokenBeta,
        moloch: moloch.address,
        expectedMolochBalance: proposal2.tributeOffered,
        applicant: proposal2.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: tokenBeta,
        userBalances: {
          [GUILD]: proposal2.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: 0,
          [processor]: 0
        }
      })

      // check sponsor in deposit token returned
      await verifyBalances({
        token: depositToken,
        moloch: moloch.address,
        expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)), // tribute now in bank,
        applicant: proposal1.applicant,
        expectedApplicantBalance: 0
      })

      await verifyInternalBalances({
        moloch,
        token: depositToken,
        userBalances: {
          [GUILD]: proposal1.tributeOffered,
          [ESCROW]: 0,
          [proposal1.applicant]: 0,
          [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
          [processor]: deploymentConfig.PROCESSING_REWARD * 2
        }
      })

      await verifyMember({
        moloch: moloch,
        member: proposal2.applicant,
        expectedDelegateKey: proposal2.applicant,
        expectedShares: proposal2.sharesRequested,
        expectedLoot: proposal2.lootRequested,
        expectedMemberAddressByDelegateKey: proposal2.applicant
      })
    })

    describe('happy path - ', () => {
      const sharesToQuit = new BN('1') // all
      let initialShares
      let initialLoot

      beforeEach(async () => {
        initialShares = await moloch.totalShares()
        initialLoot = await moloch.totalLoot()
        await moloch.ragequit(sharesToQuit, 0, { from: proposal1.applicant })
      })

      it('member shares reduced', async () => {
        await verifyMember({
          moloch: moloch,
          member: proposal1.applicant,
          expectedDelegateKey: proposal1.applicant,
          expectedShares: proposal1.sharesRequested - sharesToQuit,
          expectedLoot: proposal1.lootRequested,
          expectedMemberAddressByDelegateKey: proposal1.applicant
        })

        // started with 3 total shares - rage quitted 1 - so now 2
        const totalShares = await moloch.totalShares()
        assert.equal(+totalShares, summonerShares + proposal1.sharesRequested + proposal2.sharesRequested - sharesToQuit)

        // balances should be calculated correctly regardless of shares/loot requested in proposals 1-2
        await verifyBalances({
          token: depositToken,
          moloch: moloch.address,
          expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)),
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0
        })

        await verifyInternalBalances({
          moloch,
          token: depositToken,
          userBalances: {
            [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
            [ESCROW]: 0,
            [proposal1.applicant]: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
            [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
            [processor]: deploymentConfig.PROCESSING_REWARD * 2
          }
        })

        await verifyBalances({
          token: tokenBeta,
          moloch: moloch.address,
          expectedMolochBalance: proposal2.tributeOffered,
          applicant: proposal1.applicant,
          expectedApplicantBalance: 0
        })

        await verifyInternalBalances({
          moloch,
          token: tokenBeta,
          userBalances: {
            [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
            [ESCROW]: 0,
            [proposal1.applicant]: _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)),
            [summoner]: 0,
            [processor]: 0
          }
        })
      })

      describe.only('withdraw balances', () => {
        let tokens, applicantTokenBalances
        let zeroesArray = [0, 0]

        beforeEach(async () => {
          tokens = [depositToken.address, tokenBeta.address]
          applicantTokenBalances = [_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot)), _1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))]
        })

        it('set max = true', async () => {
          await moloch.withdrawBalances(tokens, zeroesArray, true, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            moloch: moloch.address,
            expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            moloch,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            moloch: moloch.address,
            expectedMolochBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            moloch,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('full withdrawal (without max)', async () => {
          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            moloch: moloch.address,
            expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            moloch,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            moloch: moloch.address,
            expectedMolochBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            moloch,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('partial withdrawal', async () => {
          let withdrawAmounts = []
          withdrawAmounts[0] = applicantTokenBalances[0].sub(_1)
          withdrawAmounts[1] = applicantTokenBalances[1].sub(new BN(37))

          await moloch.withdrawBalances(tokens, withdrawAmounts, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            moloch: moloch.address,
            expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(withdrawAmounts[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[0]
          })

          await verifyInternalBalances({
            moloch,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 1, // withdraw all but 1
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            moloch: moloch.address,
            expectedMolochBalance: proposal2.tributeOffered.sub(withdrawAmounts[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[1]
          })

          await verifyInternalBalances({
            moloch,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 37, // withdraw all but 37
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('repeat token (zero balance 2nd time)', async () => {
          tokens.push(depositToken.address)
          applicantTokenBalances.push(0)

          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            moloch: moloch.address,
            expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            moloch,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            moloch: moloch.address,
            expectedMolochBalance: proposal2.tributeOffered.sub(applicantTokenBalances[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[1]
          })

          await verifyInternalBalances({
            moloch,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('repeat token (some balance each time)', async () => {
          tokens.push(depositToken.address)
          withdrawAmounts = applicantTokenBalances.slice()
          withdrawAmounts[0] = withdrawAmounts[0].sub(new BN(10))
          withdrawAmounts[2] = 10

          await moloch.withdrawBalances(tokens, withdrawAmounts, false, { from: proposal1.applicant })

          await verifyBalances({
            token: depositToken,
            moloch: moloch.address,
            expectedMolochBalance: proposal1.tributeOffered.add(new BN(deploymentConfig.PROPOSAL_DEPOSIT * 2)).sub(applicantTokenBalances[0]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: applicantTokenBalances[0]
          })

          await verifyInternalBalances({
            moloch,
            token: depositToken,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: (deploymentConfig.PROPOSAL_DEPOSIT - deploymentConfig.PROCESSING_REWARD) * 2,
              [processor]: deploymentConfig.PROCESSING_REWARD * 2
            }
          })

          await verifyBalances({
            token: tokenBeta,
            moloch: moloch.address,
            expectedMolochBalance: proposal2.tributeOffered.sub(withdrawAmounts[1]),
            applicant: proposal1.applicant,
            expectedApplicantBalance: withdrawAmounts[1]
          })

          await verifyInternalBalances({
            moloch,
            token: tokenBeta,
            userBalances: {
              [GUILD]: _1e18.sub(_1e18.mul(sharesToQuit).div(initialShares.add(initialLoot))),
              [ESCROW]: 0,
              [proposal1.applicant]: 0, // full withdraw
              [summoner]: 0,
              [processor]: 0
            }
          })
        })

        it('require fail - insufficient balance (1st token)', async () => {
          applicantTokenBalances[0] = applicantTokenBalances[0].add(_1)
          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - insufficient balance (2nd token)', async () => {
          applicantTokenBalances[1] = applicantTokenBalances[1].add(_1)
          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - insufficient balance (repeat token)', async () => {
          tokens.push(depositToken.address)
          applicantTokenBalances[2] = _1
          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceInsufficientBalance)
        })

        it('require fail - token & amounts array lengths must match', async () => {
          tokens.push(depositToken.address)
          await moloch.withdrawBalances(tokens, applicantTokenBalances, false, { from: proposal1.applicant })
            .should.be.rejectedWith(revertMessages.withdrawBalanceArrayLengthsMatch)
        })
      })
    })

    // TODO bring back token w/ transfer restriction setup and test
    // - withdraw balance "transfer failed"
  })
})
