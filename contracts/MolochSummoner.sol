pragma solidity 0.5.3;

import "./Moloch.sol";

contract MolochSummoner {

    Moloch private baal;

    address[] public Molochs;

    event Summoned(address indexed baal, address indexed _summoner);

    function summonMoloch(
        address _summoner,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward) public {

        baal = new Moloch(
            _summoner,
            _approvedTokens,
            _periodDuration,
            _votingPeriodLength,
            _gracePeriodLength,
            _proposalDeposit,
            _dilutionBound,
            _processingReward);

        Molochs.push(address(baal));

        emit Summoned(address(baal), _summoner);
    }

    function getMolochCount() public view returns (uint256) {
        return Molochs.length;
    }
}
