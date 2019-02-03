// TODO
// - make proposal deposits wETH
// - add canRagequit that prevents ragequit until latest proposal member voted YES on is processed

pragma solidity 0.5.3;

import "./oz/SafeMath.sol";
import "./oz/ERC20.sol";
import "./GuildBank.sol";

contract Moloch {
    using SafeMath for uint256;

    /***************
    GLOBAL CONSTANTS
    ***************/
    uint256 public periodDuration; // default = 17280 = 4.8 hours in seconds (5 periods per day)
    uint256 public votingPeriodLength; // default = 7 periods
    uint256 public gracePeriodLength; // default = 7 periods
    uint256 public proposalDeposit; // default = 10 ETH (~$1,000 worth of ETH at contract deployment)

    ERC20 public approvedToken; // approved token contract reference; default = wETH
    GuildBank public guildBank; // guild bank contract reference

    /***************
    EVENTS
    ***************/
    event SubmitProposal(uint256 indexed index, address indexed applicant, address indexed memberAddress);
    event ProcessProposal(uint256 indexed index, address indexed applicant, address indexed proposer, bool didPass, uint256 shares);
    event SubmitVote(address indexed sender, address indexed memberAddress, uint256 indexed proposalIndex, uint8 uintVote);

    /******************
    INTERNAL ACCOUNTING
    ******************/
    uint256 public currentPeriod = 0; // the current period number
    uint256 public pendingProposals = 0; // the # of proposals waiting to be voted on
    uint256 public totalVotingShares = 0; // total voting shares across all members
    uint256 public deployTime; // needed to determine the current period

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
        // uint256 canRagequitAfterBlock; // block # after which member can ragequit - set on vote
        uint256 latestYes
    }

    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 votingSharesRequested; // the # of voting shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        uint256 tokenTribute; // amount of tokens offered as tribute
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping (address => Member) public members;
    mapping (address => address payable) public memberAddressByDelegateKey;
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
    constructor(address summoner, address _approvedToken, uint256 _periodDuration, uint256 _votingPeriodLength, uint256 _gracePeriodLength, uint256 _proposalDeposit) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_approvedToken != address(0), "Moloch::constructor - _approvedToken cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");

        approvedToken = ERC20(_approvedToken);

        guildBank = new GuildBank(_approvedToken);

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        proposalDeposit = _proposalDeposit;

        deployTime = now;

        members[summoner] = Member(summoner, 1, true, 0);
        memberAddressByDelegateKey[summoner] = summoner;
        totalVotingShares = totalVotingShares.add(1);
    }

    function updatePeriod() public {
        uint256 newCurrentPeriod = (now - deployTime) / periodDuration;
        if (newCurrentPeriod > currentPeriod) {
            uint256 periodsElapsed = newCurrentPeriod - currentPeriod;
            currentPeriod = newCurrentPeriod;
            pendingProposals = pendingProposals > periodsElapsed ? pendingProposals - periodsElapsed : 0;
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/

    function submitProposal(
        address payable applicant,
        uint256 tokenTribute,
        uint256 votingSharesRequested,
        string details
    )
        public
        payable
        onlyMemberDelegate
    {
        updatePeriod();

        address payable memberAddress = memberAddressByDelegateKey[msg.sender];

        require(msg.value == proposalDeposit, "Moloch::submitProposal - sent ETH doesn't match proposalDeposit");

        // collect tribute from applicant and store it in the Moloch until the proposal is being processed
        require(approvedToken.transferFrom(applicant, address(this), tokenTribute), "Moloch::submitProposal - tribute token transfer failed");

        pendingProposals = pendingProposals.add(1);
        uint256 startingPeriod = currentPeriod + pendingProposals;

        // create proposal ...
        Proposal memory proposal = Proposal({
            proposer: memberAddress,
            applicant: applicant,
            votingSharesRequested: votingSharesRequested,
            startingPeriod: startingPeriod,
            yesVotes: 0,
            noVotes: 0,
            processed: false,
            tokenTribute: tokenTribute,
            details: details
        });

        // ... and append it to the queue
        proposalQueue.push(proposal);

        uint256 proposalIndex = proposalQueue.length.sub(1);
        emit SubmitProposal(proposalIndex, applicant, memberAddress);
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
        Member storage member = members[memberAddress];
        Proposal storage proposal = proposalQueue[proposalIndex];
        Vote vote = Vote(uintVote);

        require(proposal.startingPeriod > 0, "Moloch::submitVote - proposal does not exist");
        require(currentPeriod >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(currentPeriod.sub(proposal.startingPeriod) < votingPeriodLength, "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");

        // store vote
        proposal.votesByMember[memberAddress] = vote;
        member.votesByProposal[proposalIndex] = vote;

        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.votingShares);

            // update when the member can ragequit
            uint256 endingPeriod = proposal.startingPeriod.add(votingPeriodLength).add(gracePeriodLength);
            if (endingPeriod > member.canRagequitAfterBlock) {
                member.canRagequitAfterBlock = endingPeriod;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.votingShares);
        }

        emit SubmitVote(msg.sender, memberAddress, proposalIndex, uintVote);
    }

    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        Proposal storage proposal = proposalQueue[proposalIndex];
        require(proposal.startingPeriod > 0, "Moloch::processProposal - proposal does not exist");
        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");
        require(proposalIndex == 0 || proposalQueue[proposalIndex - 1].processed, "Moloch::processProposal - previous proposal must be processed");

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

            // transfer tokens to guild bank
            require(
                approvedToken.approve(address(guildBank), proposal.tokenTribute),
                "Moloch::processProposal - approval of token transfer to guild bank failed"
            );
            require(
                guildBank.deposit(proposal.tokenTribute),
                "Moloch::processProposal - passing vote token transfer failed"
            );

        // PROPOSAL FAILED
        } else {
            // return all tokens to the applicant
            require(
                approvedToken.transfer(proposal.applicant, proposal.tokenTribute),
                "Moloch::processProposal - failing vote token transfer failed"
            );
        }

        // return deposit to proposer
        proposal.proposer.transfer(proposalDeposit);

        emit ProcessProposal(
            proposalIndex,
            proposal.applicant,
            proposal.proposer,
            didPass,
            proposal.votingSharesRequested
        );
    }

    function ragequit(uint256 sharesToBurn) public onlyMember {
        updatePeriod();

        uint256 initialTotalVotingShares = totalVotingShares;

        Member storage member = members[msg.sender];

        require(member.votingShares >= sharesToBurn, "Moloch::ragequit - insufficient voting shares");

        require(currentPeriod > member.canRagequitAfterBlock, "Moloch::ragequit - can't ragequit yet");

        // burn voting shares
        member.votingShares = member.votingShares.sub(sharesToBurn);
        totalVotingShares = totalVotingShares.sub(sharesToBurn);

        // instruct guildBank to transfer fair share of tokens to the receiver
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalVotingShares),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );
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
