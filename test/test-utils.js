const zeroAddress = '0x0000000000000000000000000000000000000000'

const chai = require('chai')
const { assert } = chai

const verifyBalance = async ({ token, address, expectedBalance }) => {
  const balance = await token.balanceOf(address)
  assert.equal(balance.toString(), expectedBalance.toString(), `token balance incorrect for ${token.address} with ${address}`)
}

const verifyInternalBalance = async ({ moloch, token, user, expectedBalance }) => {
  const balance = await moloch.userTokenBalances.call(user, token.address)
  assert.equal(balance.toString(), expectedBalance.toString(), `internal token balance incorrect for user ${user} and token ${token.address}`)
}

const verifyInternalBalances = async ({ moloch, token, userBalances }) => {
  const users = Object.keys(userBalances)
  for (i = 0; i < users.length; i++) {
    await verifyInternalBalance({ moloch, token, user: users[i], expectedBalance: userBalances[users[i]]})
  }
}

const verifyAllowance = async ({ token, owner, spender, expectedAllowance }) => {
  const allowance = await token.allowance(owner, spender)
  assert.equal(+allowance, expectedAllowance, `allowance incorrect for ${token.address} owner ${owner} spender ${spender}`)
}

const verifyProposal = async (
  {
    moloch,
    proposal,
    proposalId,
    proposer,
    sponsor = zeroAddress,
    expectedStartingPeriod = 0,
    expectedProposalCount = 0,
    expectedProposalQueueLength = 0
  }
) => {
  const proposalData = await moloch.proposals(proposalId)

  const proposalCount = await moloch.proposalCount()
  assert.equal(+proposalCount, expectedProposalCount)

  const proposalQueueLength = await moloch.getProposalQueueLength()
  assert.equal(+proposalQueueLength, expectedProposalQueueLength)

  assert.equal(proposalData.applicant, proposal.applicant)
  assert.equal(proposalData.proposer, proposer, 'proposers does not match')
  assert.equal(proposalData.sponsor, sponsor, 'sponsor does not match')

  assert.equal(proposalData.sharesRequested, proposal.sharesRequested, 'sharesRequested does not match')
  
  assert.equal(proposalData.tributeOffered.toString(), proposal.tributeOffered.toString(), 'tributeOffered does not match')
  assert.equal(proposalData.tributeToken, proposal.tributeToken, 'tributeToken does not match')

  assert.equal(proposalData.paymentRequested, proposal.paymentRequested, 'paymentRequested does not match')
  assert.equal(proposalData.paymentToken, proposal.paymentToken, 'paymentToken does not match')

  assert.equal(+proposalData.startingPeriod, expectedStartingPeriod, 'startingPeriod does not match')
  assert.equal(proposalData.yesVotes, 0, 'yesVotes does not match')
  assert.equal(proposalData.noVotes, 0, 'noVotes does not match')
  assert.equal(proposalData.details, proposal.details, 'details does not match')
  assert.equal(proposalData.maxTotalSharesAndLootAtYesVote, 0, 'maxTotalSharesAndLootAtYesVote invalid')
}

const verifyFlags = async ({ moloch, proposalId, expectedFlags }) => {
  const actualFlags = await moloch.getProposalFlags(proposalId)

  // [sponsored, processed, didPass, cancelled, whitelist, guildkick]
  assert.equal(actualFlags[0], expectedFlags[0], 'sponsored flag incorrect')
  assert.equal(actualFlags[1], expectedFlags[1], 'processed flag incorrect')
  assert.equal(actualFlags[2], expectedFlags[2], 'didPass flag incorrect')
  assert.equal(actualFlags[3], expectedFlags[3], 'cancelled flag incorrect')
  assert.equal(actualFlags[4], expectedFlags[4], 'whitelist flag incorrect')
  assert.equal(actualFlags[5], expectedFlags[5], 'guildkick flag incorrect')
}

const verifyBalances = async (
  {
    token,
    moloch, // FIXME rename as slightly misleading
    expectedMolochBalance,
    applicant,
    expectedApplicantBalance
  }
) => {
  const molochBalance = await token.balanceOf(moloch)

  assert.equal(molochBalance.toString(), expectedMolochBalance.toString(), `moloch token balance incorrect for ${token.address} with ${moloch}`)

  const applicantBalance = await token.balanceOf(applicant)
  assert.equal(applicantBalance.toString(), expectedApplicantBalance.toString(), `Applicant token balance incorrect for ${token.address} with ${applicant}`)
}

const verifySubmitVote = async (
  {
    moloch,
    proposalIndex,
    memberAddress,
    expectedVote,
    expectedMaxSharesAndLootAtYesVote = 0,
    initialYesVotes = 0,
    initialNoVotes = 0
  }
) => {
  const proposalId = await moloch.proposalQueue(proposalIndex)
  const proposalData = await moloch.proposals(proposalId)

  assert.equal(+proposalData.yesVotes, initialYesVotes + (expectedVote === 1 ? 1 : 0))
  assert.equal(+proposalData.noVotes, initialNoVotes + (expectedVote === 1 ? 0 : 1))
  assert.equal(+proposalData.maxTotalSharesAndLootAtYesVote, expectedMaxSharesAndLootAtYesVote)

  const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
  assert.equal(+memberVote, expectedVote)
}

const verifyProcessProposal = async (
  {
    moloch,
    proposalIndex,
    expectedYesVotes = 0,
    expectedNoVotes = 0,
    expectedTotalShares = 0,
    expectedTotalLoot = 0,
    expectedMaxSharesAndLootAtYesVote = 0
  }
) => {
  // flags and proposal data
  const proposalId = await moloch.proposalQueue(proposalIndex)
  const proposalData = await moloch.proposals(proposalId)

  assert.equal(+proposalData.yesVotes, expectedYesVotes, 'proposal yes votes incorrect')
  assert.equal(+proposalData.noVotes, expectedNoVotes, 'proposal no votes incorrect')
  assert.equal(+proposalData.maxTotalSharesAndLootAtYesVote, expectedMaxSharesAndLootAtYesVote, 'total shares at yes vote incorrect')

  const totalShares = await moloch.totalShares()
  assert.equal(+totalShares, expectedTotalShares, 'total shares incorrect')

  const totalLoot = await moloch.totalLoot()
  assert.equal(+totalLoot, expectedTotalLoot, 'total loot incorrect')
}

const verifyMember = async (
  {
    moloch,
    member,
    expectedDelegateKey = zeroAddress,
    expectedShares = 0,
    expectedLoot = 0,
    expectedExists = true,
    expectedJailed = 0,
    expectedHighestIndexYesVote = 0,
    expectedMemberAddressByDelegateKey = zeroAddress
  }
) => {
  const memberData = await moloch.members(member)
  assert.equal(memberData.delegateKey, expectedDelegateKey, 'delegate key incorrect')
  assert.equal(+memberData.shares, expectedShares, 'expected shares incorrect')
  assert.equal(+memberData.loot, expectedLoot, 'expected loot incorrect')
  assert.equal(memberData.exists, expectedExists, 'exists incorrect')
  assert.equal(+memberData.jailed, expectedJailed, 'jailed incorrect')
  assert.equal(+memberData.highestIndexYesVote, expectedHighestIndexYesVote, 'highest index yes vote incorrect')

  const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(expectedDelegateKey)
  assert.equal(newMemberAddressByDelegateKey, expectedMemberAddressByDelegateKey, 'member address by delegate key incorrect')
}

Object.assign(exports, {
  verifyProposal,
  verifyFlags,
  verifyBalance,
  verifyInternalBalance,
  verifyInternalBalances,
  verifyBalances,
  verifyAllowance,
  verifySubmitVote,
  verifyProcessProposal,
  verifyMember
})
