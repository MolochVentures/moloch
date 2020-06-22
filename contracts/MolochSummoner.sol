pragma solidity ^0.6.0;

import "./Moloch.sol";

contract MolochSummoner {
    // presented by OpenESQ || LexDAO LLC ~ Use at own risk! || chat with us: lexdao.chat 
    Moloch private baal;
    address[] public molochs;

    event Summoned(address indexed baal, address[] indexed _summoner);

    function summonMoloch(
        address[] memory _summoners,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward,
        uint256 _defaultTribute) public {

        baal = new Moloch(
            _summoners,
            _approvedTokens,
            _periodDuration,
            _votingPeriodLength,
            _gracePeriodLength,
            _proposalDeposit,
            _dilutionBound,
            _processingReward,
            _defaultTribute);

        molochs.push(address(baal));
        emit Summoned(address(baal), _summoners);
    }
}