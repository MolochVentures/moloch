/**
 * Fetches all proposals in parallel, and formats them to be displayed as a table.
 */
async function getProposals (moloch) {
  const queueLength = (await moloch.getProposalQueueLength()).toNumber()
  const currentPeriod = (await moloch.getCurrentPeriod()).toNumber()

  return Promise.all(
    Array.from({ length: queueLength }).map((_, index) =>
      moloch.proposalQueue(index).then(proposal =>
        formatSimpleProposal(proposal, currentPeriod, index)
      )
    )
  )
}

/**
 * Fetches a given proposal by Id, and formats its fields to be displayed as a human-readable JSON.
 */
async function getDetailedProposal (moloch, proposalIndex) {
  const queueLength = (await moloch.getProposalQueueLength()).toNumber()

  if (proposalIndex >= queueLength) {
    console.error(`A proposal with Id: ${proposalIndex} doesn't exist, please try again with an Id in the range [0..${queueLength - 1}]`)
    return
  }

  const rawProposal = await moloch.proposalQueue(proposalIndex)
  const currentPeriod = (await moloch.getCurrentPeriod()).toNumber()

  const { title, description } = extractDetails(rawProposal)

  return {
    id: proposalIndex,
    title,
    description,
    proposer: rawProposal.proposer,
    applicant: rawProposal.applicant,
    status: determineProposalStatus(rawProposal, currentPeriod),
    sharesRequested: rawProposal.sharesRequested,
    startingPeriod: rawProposal.startingPeriod,
    yesVotes: rawProposal.yesVotes,
    noVotes: rawProposal.noVotes,
    tokenTribute: rawProposal.tokenTribute,
    maxTotalSharesAtYesVote: rawProposal.maxTotalSharesAtYesVote
  }
}

/**
 * Formats a proposal to only contain ID, Status and Title.
 */
function formatSimpleProposal (proposal, currentPeriod, index) {
  const { title } = extractDetails(proposal)

  return {
    ID: index,
    Status: determineProposalStatus(proposal, currentPeriod),
    Title: trimTitle(title)
  }
}

/**
 * Formats the raw `proposal.details` into nicely formatted title and description.
 */
function extractDetails (proposal) {
  let title, description

  try {
    const jsonDetails = JSON.parse(proposal.details)

    if (typeof jsonDetails !== 'object' || jsonDetails.title === undefined || jsonDetails.description === undefined) {
      throw new Error(`Proposal details is not a valid JSON object with properties "title" and "description": ${jsonDetails}`)
    }

    title = jsonDetails.title
    description = jsonDetails.description
  } catch (_) {
    // Special case two proposals with invalid JSON payload
    /* eslint-disable no-tabs */
    if (proposal.details === '{	itle:Member Proposal: DCInvestor,description:https://paper.dropbox.com/doc/MGP3-ETH2.0-Test-Runner--AcFiUF_av4SF5CHOuS4qSH0WAg-DZu4VRgbP1LZeUimS1k3L}') {
      title = 'Membership Proposal: DCInvestor'
      description = 'https://paper.dropbox.com/doc/MGP3-ETH2.0-Test-Runner--AcFiUF_av4SF5CHOuS4qSH0WAg-DZu4VRgbP1LZeUimS1k3L'
    } else if (proposal.details === '{title:Member Proposal: Anon,description:https://etherpad.net/p/anon_moloch_proposal}') {
      title = 'Membership Proposal: Anon'
      description = 'https://etherpad.net/p/anon_moloch_proposal'
    } else {
      title = proposal.details
      description = 'N/A'
    }
  }

  return { title, description }
}

/**
 * Ensures the title is at most 60 characters long
 */
function trimTitle (title) {
  return title.length > 60 ? title.split('').slice(0, 57).join('').concat('...') : title
}

// Below are all the functions needed to determine proposal status
const VOTING_PERIOD_LENGTH = 35
const GRACE_PERIOD_LENGTH = 35

const ProposalStatus = {
  Unknown: 'Unknown',
  InQueue: 'In queue',
  VotingPeriod: 'Voting period',
  GracePeriod: 'Grace period',
  Aborted: 'Aborted',
  Passed: 'Passed',
  Failed: 'Failed',
  ReadyForProcessing: 'Ready for processing'
}

function inQueue (startingPeriod, currentPeriod) {
  return currentPeriod < startingPeriod
}

function inGracePeriod (startingPeriod, currentPeriod) {
  return currentPeriod > startingPeriod + VOTING_PERIOD_LENGTH &&
    currentPeriod < startingPeriod + VOTING_PERIOD_LENGTH + GRACE_PERIOD_LENGTH
}

function inVotingPeriod (startingPeriod, currentPeriod) {
  return currentPeriod >= startingPeriod && currentPeriod <= startingPeriod + VOTING_PERIOD_LENGTH
}

function passedVotingAndGrace (startingPeriod, currentPeriod) {
  return currentPeriod > startingPeriod + VOTING_PERIOD_LENGTH + GRACE_PERIOD_LENGTH
}

function determineProposalStatus (proposal, currentPeriod) {
  const startingPeriod = proposal.startingPeriod.toNumber()

  let status
  if (proposal.processed && proposal.aborted) {
    status = ProposalStatus.Aborted
  } else if (proposal.processed && proposal.didPass) {
    status = ProposalStatus.Passed
  } else if (proposal.processed && !proposal.didPass) {
    status = ProposalStatus.Failed
  } else if (inGracePeriod(startingPeriod, currentPeriod)) {
    status = ProposalStatus.GracePeriod
  } else if (inVotingPeriod(startingPeriod, currentPeriod)) {
    status = ProposalStatus.VotingPeriod
  } else if (inQueue(startingPeriod, currentPeriod)) {
    status = ProposalStatus.InQueue
  } else if (passedVotingAndGrace(startingPeriod, currentPeriod)) {
    status = ProposalStatus.ReadyForProcessing
  } else {
    status = ProposalStatus.Unknown
  }

  return status
}

module.exports = {
  getProposals,
  getDetailedProposal
}
