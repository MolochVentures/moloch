pragma solidity 0.5.3;

import "./oz/ERC20Burnable.sol";
import "./oz/ERC20Mintable.sol";
import "./oz/Ownable.sol";

contract LootToken is ERC20Mintable, ERC20Burnable {
    string public constant name = "LootToken"; // solium-disable-line uppercase
    string public constant symbol = "MLL"; // solium-disable-line uppercase
    uint8 public constant decimals = 18; // solium-disable-line uppercase

    // no constructor, all tokens will be minted

    /**
     * @dev Burns a specific amount of tokens.
     * @param _burner Who to burn tokens from.
     * @param _value The amount of token to be burned.
     */
    function proxyBurn(address _burner, uint256 _value) public onlyOwner {
        _burn(_burner, _value);
    }
}
