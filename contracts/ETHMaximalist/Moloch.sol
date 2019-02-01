/* TODO
 * Test edge cases around increasing/decreasing voting shares of existing members wrt to proposal queue length
 *
 * New:
 *  - remove DAI support -> ETH maximalist only
 */

pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/ERC20.sol";

contract Moloch {
    using SafeMath for uint256;

    /***************
    GLOBAL CONSTANTS
    ***************/
    uint256 public periodDuration; // default = 86400 = 1 day in seconds
    uint256 public votingPeriodLength; // default = 7 periods
    uint256 public gracePeriodLength; // default = 7 periods
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)

    /***************
    EVENTS
    ***************/
    event SubmitProposal(uint256 indexed index, address indexed applicant, address indexed memberAddress);
    event ProcessProposal(uint256 indexed index, address indexed applicant, address indexed proposer, bool didPass, uint256 shares);
    event SubmitVote(address indexed sender, address indexed memberAddress, uint256 indexed proposalIndex, uint8 uintVote);
    event Withdrawal(address indexed receiver, uint256 ethAmount);

    /******************
    INTERNAL ACCOUNTING
    ******************/
    uint256 public currentPeriod = 0; // the current period number
    uint256 public pendingProposals = 0; // the # of proposals waiting to be voted on
    uint256 public totalVotingShares = 0; // total voting shares across all members

    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 votingShares; // the # of voting shares assigned to this member
        bool isActive; // always true once a member has been created
        mapping (uint256 => Vote) votesByProposal; // records a member's votes by the index of the proposal
        uint256 canRagequitAfterBlock; // block # after which member can ragequit - set on vote
    }

    struct Proposal {
        address payable proposer; // the member who submitted the proposal
        address payable applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 votingSharesRequested; // the # of voting shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        uint256 ethTribute; // amount of ETH offered as tribute
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    struct Period {
        uint256 startTime; // the starting unix timestamp in seconds
        uint256 endTime; // the ending unix timestamp in seconds
    }

    mapping (address => Member) public members;
    mapping (address => address payable) public memberAddressByDelegateKey;
    mapping (uint256 => Period) public periods;
    Proposal[] public proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyMember {
        require(members[msg.sender].votingShares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    modifier onlyMemberDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].votingShares > 0, "Moloch::onlyMemberDelegate - not a member");
        _;
    }

    /********
    FUNCTIONS
    ********/
    constructor(address summoner, uint256 _periodDuration, uint256 _votingPeriodLength, uint256 _gracePeriodLength, uint _proposalDeposit) public {
        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        proposalDeposit = _proposalDeposit;

        uint256 startTime = now;
        periods[currentPeriod].startTime = startTime;
        periods[currentPeriod].endTime = startTime.add(periodDuration);

        members[summoner] = Member(summoner, 1, true, 0);
        totalVotingShares = totalVotingShares.add(1);
    }

    function updatePeriod() public {
        while (now >= periods[currentPeriod].endTime) {
            Period memory prevPeriod = periods[currentPeriod];
            currentPeriod += 1;
            periods[currentPeriod].startTime = prevPeriod.endTime;
            periods[currentPeriod].endTime = prevPeriod.endTime.add(periodDuration);

            if (pendingProposals > 0) {
                pendingProposals = pendingProposals.sub(1);
            }
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/

    function submitProposal(address payable applicant, uint256 ethTribute, uint256 votingSharesRequested) public payable onlyMemberDelegate {
        updatePeriod();

        address payable memberAddress = memberAddressByDelegateKey[msg.sender];

        require(msg.value == proposalDeposit.add(ethTribute), "Moloch::submitProposal - insufficient value");

        pendingProposals = pendingProposals.add(1);
        uint256 startingPeriod = currentPeriod + pendingProposals;

        Proposal memory proposal = Proposal({
            proposer: memberAddress,
            applicant: applicant,
            votingSharesRequested: votingSharesRequested,
            startingPeriod: startingPeriod,
            yesVotes: 0,
            noVotes: 0,
            processed: false,
            ethTribute: ethTribute
        });

        emit SubmitProposal(proposalQueue.push(proposal)-1, applicant,memberAddress);
    }

    function submitVote(
        uint256 proposalIndex,
        uint8 uintVote
    )
        public
        onlyMemberDelegate
    {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];

        Proposal storage proposal = proposalQueue[proposalIndex];
        Vote vote = Vote(uintVote);
        require(proposal.startingPeriod > 0, "Moloch::submitVote - proposal does not exist");
        require(currentPeriod >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(currentPeriod.sub(proposal.startingPeriod) < votingPeriodLength, "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        proposal.votesByMember[memberAddress] = vote;

        Member storage member = members[memberAddress];
        member.votesByProposal[proposalIndex] = vote;

        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.votingShares);
        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.votingShares);
        }

        uint256 endingPeriod = proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength);

        if (endingPeriod > member.canRagequitAfterBlock) {
            member.canRagequitAfterBlock = endingPeriod;
        }

        emit SubmitVote(msg.sender, memberAddress, proposalIndex, uintVote);
    }

    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        require(proposal.startingPeriod > 0, "Moloch::processProposal - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");

        proposal.processed = true;

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // PROPOSAL PASSED
        if (didPass) {

            // if the proposer is already a member, add to their existing voting shares
            if (members[proposal.applicant].votingShares > 0) {
                members[proposal.applicant].votingShares = members[proposal.applicant].votingShares.add(proposal.votingSharesRequested);

            // the applicant is a new member, create a new record for them
            } else {
                // use applicant address as delegateKey by default
                members[proposal.applicant] = Member(proposal.applicant, proposal.votingSharesRequested, true, 0);
                memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
            }

            // mint new voting shares
            totalVotingShares = totalVotingShares.add(proposal.votingSharesRequested);

        // PROPOSAL FAILED
        } else {
            // return all eth to the applicant
            // NOTE - ETH will go directly to the applicant even though it came from the proposer
            proposal.applicant.transfer(proposal.ethTribute);
        }

        proposal.proposer.transfer(proposalDeposit.add(proposal.ethTribute));
        emit ProcessProposal(proposalIndex, proposal.applicant, proposal.proposer, didPass, proposal.votingSharesRequested);
    }

    function ragequit(address payable receiver, uint256 sharesToBurn) public onlyMember {
        updatePeriod();

        uint256 initialTotalVotingShares = totalVotingShares;

        Member storage member = members[msg.sender];

        require(member.votingShares >= sharesToBurn, "Moloch::collectLoot - insufficient voting shares");

        require(currentPeriod > member.canRagequitAfterBlock, "Moloch::collectLoot - can't ragequit yet");

        member.votingShares = member.votingShares.sub(sharesToBurn);
        totalVotingShares = totalVotingShares.sub(sharesToBurn);

        withdraw(receiver, sharesToBurn, initialTotalVotingShares);
    }

    function withdraw(address payable receiver, uint256 shares, uint256 totalShares) public onlyMember {
        uint256 ethAmount = address(this).balance.mul(shares).div(totalShares);
        receiver.transfer(ethAmount);
        emit Withdrawal(receiver, ethAmount);
    }

    function updateDelegateKey(address newDelegateKey) public onlyMember {
        // newDelegateKey must be either the member's address or one not in use by any other members
        require(newDelegateKey == msg.sender || !members[memberAddressByDelegateKey[newDelegateKey]].isActive);
        Member storage member = members[msg.sender];
        memberAddressByDelegateKey[member.delegateKey] = address(0);
        memberAddressByDelegateKey[newDelegateKey] = msg.sender;
        member.delegateKey = newDelegateKey;
    }
}