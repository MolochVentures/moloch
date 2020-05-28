pragma solidity 0.5.12;

import "./Moloch.sol";

contract MolochSummoner {

    Moloch private m;

    address[] public molochs;

    event Summoned(address indexed m, address indexed _summoner);

    function summonMoloch(
        address _summoner,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward) public {

        m = new Moloch(
            _summoner,
            _approvedTokens,
            _periodDuration,
            _votingPeriodLength,
            _gracePeriodLength,
            _proposalDeposit,
            _dilutionBound,
            _processingReward);

        molochs.push(address(m));

        emit Summoned(address(m), _summoner);
    }

    function getMolochCount() public view returns (uint256 MolochCount) {
        return molochs.length;
    }
}
