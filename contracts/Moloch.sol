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
    uint256 public dilutionBound; // default = 3 - maximum multiplier a YES voter will be obligated to pay in case of mass ragequit
    uint256 public processingReward; // default = 0.1 - amount of ETH to give to whoever processes a proposal
    uint256 public summoningTime; // needed to determine the current period

    ERC20 public approvedToken; // approved token contract reference; default = wETH
    GuildBank public guildBank; // guild bank contract reference

    /***************
    EVENTS
    ***************/
    event SubmitProposal(uint256 indexed index, address indexed applicant, address indexed memberAddress);
    event ProcessProposal(uint256 indexed index, address indexed applicant, address indexed proposer, bool didPass, uint256 shares);
    event SubmitVote(address indexed sender, address indexed memberAddress, uint256 indexed proposalIndex, uint8 uintVote);
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn);

    /******************
    INTERNAL ACCOUNTING
    ******************/
    uint256 public currentPeriod = 0; // the current period number
    uint256 public pendingProposals = 0; // the # of proposals waiting to be voted on
    uint256 public totalShares = 0; // total shares across all members

    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of shares assigned to this member
        bool isActive; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES
    }

    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 sharesRequested; // the # of shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        uint256 tokenTribute; // amount of tokens offered as tribute
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 totalSharesAtLastVote; // the total # of shares at the time of the last vote on this proposal
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member
    }

    mapping (address => bool) public isApplicant; // stores the applicant address while a proposal is active (prevents this address from being overwritten)
    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;
    Proposal[] public proposalQueue;

    /********
    MODIFIERS
    ********/
    modifier onlyMember {
        require(members[msg.sender].shares > 0, "Moloch::onlyMember - not a member");
        _;
    }

    modifier onlyDelegate {
        require(members[memberAddressByDelegateKey[msg.sender]].shares > 0, "Moloch::onlyDelegate - not a member");
        _;
    }

    /********
    FUNCTIONS
    ********/
    constructor(
        address summoner,
        address _approvedToken,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward
    ) public {
        require(summoner != address(0), "Moloch::constructor - summoner cannot be 0");
        require(_approvedToken != address(0), "Moloch::constructor - _approvedToken cannot be 0");
        require(_periodDuration > 0, "Moloch::constructor - _periodDuration cannot be 0");
        require(_votingPeriodLength > 0, "Moloch::constructor - _votingPeriodLength cannot be 0");
        require(_dilutionBound > 0, "Moloch::constructor - _dilutionBound cannot be 0");
        require(_proposalDeposit >= _processingReward, "Moloch::constructor - _proposalDeposit cannot be smaller than _processingReward");

        approvedToken = ERC20(_approvedToken);

        guildBank = new GuildBank(_approvedToken);

        periodDuration = _periodDuration;
        votingPeriodLength = _votingPeriodLength;
        gracePeriodLength = _gracePeriodLength;
        proposalDeposit = _proposalDeposit;
        dilutionBound = _dilutionBound;
        processingReward = _processingReward;

        summoningTime = now;

        members[summoner] = Member(summoner, 1, true, 0);
        memberAddressByDelegateKey[summoner] = summoner;
        totalShares = 1;
    }

    function updatePeriod() public {
        uint256 newCurrentPeriod = now.sub(summoningTime).div(periodDuration);
        if (newCurrentPeriod > currentPeriod) {
            uint256 periodsElapsed = newCurrentPeriod.sub(currentPeriod);
            currentPeriod = newCurrentPeriod;
            pendingProposals = pendingProposals > periodsElapsed ? pendingProposals.sub(periodsElapsed) : 0;
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/

    function submitProposal(
        address applicant,
        uint256 tokenTribute,
        uint256 sharesRequested,
        string memory details
    )
        public
        onlyDelegate
    {
        updatePeriod();

        require(applicant != address(0), "Moloch::submitProposal - applicant cannot be 0");

        address memberAddress = memberAddressByDelegateKey[msg.sender];

        // collect proposal deposit from proposer and store it in the Moloch until the proposal is processed
        require(approvedToken.transferFrom(msg.sender, address(this), proposalDeposit), "Moloch::submitProposal - proposal deposit token transfer failed");

        // collect tribute from applicant and store it in the Moloch until the proposal is processed
        require(approvedToken.transferFrom(applicant, address(this), tokenTribute), "Moloch::submitProposal - tribute token transfer failed");

        pendingProposals = pendingProposals.add(1);
        uint256 startingPeriod = currentPeriod.add(pendingProposals);

        // create proposal ...
        Proposal memory proposal = Proposal({
            proposer: memberAddress,
            applicant: applicant,
            sharesRequested: sharesRequested,
            startingPeriod: startingPeriod,
            yesVotes: 0,
            noVotes: 0,
            processed: false,
            tokenTribute: tokenTribute,
            details: details,
            totalSharesAtLastVote: totalShares
        });

        // ... and append it to the queue
        proposalQueue.push(proposal);

        // save the applicant address (to prevent delegate keys from overwriting it)
        isApplicant[proposal.applicant] = true;

        uint256 proposalIndex = proposalQueue.length.sub(1);
        emit SubmitProposal(proposalIndex, applicant, memberAddress);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public onlyDelegate {
        updatePeriod();

        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "Moloch::submitVote - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        Vote vote = Vote(uintVote);

        require(currentPeriod >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
        require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");

        // store vote
        proposal.votesByMember[memberAddress] = vote;

        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares);

            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares);
        }

        // set total shares on proposal - used to bound dilution for yes voters
        proposal.totalSharesAtLastVote = totalShares;

        emit SubmitVote(msg.sender, memberAddress, proposalIndex, uintVote);
    }

    function processProposal(uint256 proposalIndex) public {
        updatePeriod();

        require(proposalIndex < proposalQueue.length, "Moloch::processProposal - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        require(currentPeriod.sub(proposal.startingPeriod) > votingPeriodLength.add(gracePeriodLength), "Moloch::processProposal - proposal is not ready to be processed");
        require(proposal.processed == false, "Moloch::processProposal - proposal has already been processed");
        require(proposalIndex == 0 || proposalQueue[proposalIndex.sub(1)].processed, "Moloch::processProposal - previous proposal must be processed");

        proposal.processed = true;

        bool didPass = proposal.yesVotes > proposal.noVotes;

        // Make the proposal fail if the dilutionBound is exceeded
        if (totalShares * dilutionBound < proposal.totalSharesAtLastVote) {
            didPass = false;
        }

        // PROPOSAL PASSED
        if (didPass) {

            // if the proposer is already a member, add to their existing shares
            if (members[proposal.applicant].isActive) {
                members[proposal.applicant].shares = members[proposal.applicant].shares.add(proposal.sharesRequested);

            // the applicant is a new member, create a new record for them
            } else {
                // use applicant address as delegateKey by default
                members[proposal.applicant] = Member(proposal.applicant, proposal.sharesRequested, true, 0);
                memberAddressByDelegateKey[proposal.applicant] = proposal.applicant;
            }

            // mint new shares
            totalShares = totalShares.add(proposal.sharesRequested);

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

        // send msg.sender the processingReward
        require(
            approvedToken.transfer(msg.sender, processingReward),
            "Moloch::processProposal - failed to send processing reward to msg.sender"
        );

        // return deposit to proposer (subtract processing reward)
        require(
            approvedToken.transfer(proposal.proposer, proposalDeposit.sub(processingReward)),
            "Moloch::processProposal - failed to return proposal deposit to proposer"
        );

        // remove the isApplicant entry for the applicant
        isApplicant[proposal.applicant] = false;

        emit ProcessProposal(
            proposalIndex,
            proposal.applicant,
            proposal.proposer,
            didPass,
            proposal.sharesRequested
        );
    }

    function ragequit(uint256 sharesToBurn) public onlyMember {
        updatePeriod();

        uint256 initialTotalShares = totalShares;

        Member storage member = members[msg.sender];

        require(member.shares >= sharesToBurn, "Moloch::ragequit - insufficient shares");

        require(canRagequit(msg.sender), "Moloch::ragequit - can't ragequit until highest index proposal member voted YES on is processed or the vote fails");

        // burn shares
        member.shares = member.shares.sub(sharesToBurn);
        totalShares = totalShares.sub(sharesToBurn);

        // instruct guildBank to transfer fair share of tokens to the ragequitter
        require(
            guildBank.withdraw(msg.sender, sharesToBurn, initialTotalShares),
            "Moloch::ragequit - withdrawal of tokens from guildBank failed"
        );

        emit Ragequit(msg.sender, sharesToBurn);
    }

    function updateDelegateKey(address newDelegateKey) public onlyMember {
        require(newDelegateKey != address(0), "Moloch::updateDelegateKey - newDelegateKey cannot be 0");

        // skip checks if member is setting the delegate key to their member address
        if (newDelegateKey != msg.sender) {
            require(!members[newDelegateKey].isActive, "Moloch::updateDelegateKey - can't overwrite existing members");
            require(!members[memberAddressByDelegateKey[newDelegateKey]].isActive, "Moloch::updateDelegateKey - can't overwrite existing delegate keys");
            require(!isApplicant[newDelegateKey], "Moloch::updateDelegateKey - can't overwrite existing applicants");
        }

        Member storage member = members[msg.sender];
        if (memberAddressByDelegateKey[member.delegateKey] == msg.sender) {
          memberAddressByDelegateKey[member.delegateKey] = address(0);
        }
        memberAddressByDelegateKey[newDelegateKey] = msg.sender;
        member.delegateKey = newDelegateKey;
    }

    /***************
    GETTER FUNCTIONS
    ***************/

    // can only ragequit if the latest proposal you voted YES on has either been processed OR voting has expired and it didn't pass
    function canRagequit(address memberAddress) public returns (bool) {
        Member storage member = members[memberAddress];
        require(member.isActive, "Moloch:canRagequit - member doesn't exist");

        if (member.shares == 0) {
            return false;
        }

        if (proposalQueue.length == 0) {
            return true;
        }

        uint256 highestIndexYesVote = member.highestIndexYesVote;

        if (highestIndexYesVote == 0 && proposalQueue[0].votesByMember[memberAddress] != Vote.Yes) {
            // member has never voted yes on any proposal
            return true;
        }

        Proposal memory proposal = proposalQueue[highestIndexYesVote];

        return proposal.processed || (hasVotingPeriodExpired(proposal.startingPeriod) && proposal.noVotes >= proposal.yesVotes);
    }

    function hasVotingPeriodExpired(uint256 startingPeriod) public returns (bool) {
        updatePeriod();
        return currentPeriod.sub(startingPeriod) >= votingPeriodLength;
    }

    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        require(members[memberAddress].isActive, "Moloch::getMemberProposalVote - member doesn't exist");
        require(proposalIndex < proposalQueue.length, "Moloch::getMemberProposalVote - proposal doesn't exist");
        return proposalQueue[proposalIndex].votesByMember[memberAddress];
    }
}
