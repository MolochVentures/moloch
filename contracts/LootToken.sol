pragma solidity 0.4.23;

// import "zeppelin-solidity/contracts/token/ERC20/BurnableToken.sol";
// import "zeppelin-solidity/contracts/token/ERC20/MintableToken.sol";
import "zeppelin-solidity/contracts/token/ERC20/StandardToken.sol";

contract LootToken is StandardToken {
    event Burn(address indexed from, uint256 amount);
    event Mint(address indexed to, uint256 amount);
    event MintFinished();

    string public constant name = "LootToken"; // solium-disable-line uppercase
    string public constant symbol = "MLL"; // solium-disable-line uppercase
    uint8 public constant decimals = 18; // solium-disable-line uppercase

    address public owner;
    bool public mintingFinished = false;

    constructor() {
        owner = msg.sender;
    }

    modifier canMint() {
        require(!mintingFinished);
        _;
    }

    /**
    * @dev Function to mint tokens
    * @param _to The address that will receive the minted tokens.
    * @param _amount The amount of tokens to mint.
    * @return A boolean that indicates if the operation was successful.
    */
    function mint(address _owner, address _to, uint256 _amount) canMint public returns (bool) {
        require(owner == _owner);
        totalSupply_ = totalSupply_.add(_amount);
        balances[_to] = balances[_to].add(_amount);
        emit Mint(_to, _amount);
        emit Transfer(address(0), _to, _amount);
        return true;
    }

    /**
    * @dev Function to stop minting new tokens.
    * @return True if the operation was successful.
    */
    function finishMinting(address _owner) canMint public returns (bool) {
        require(owner == _owner);
        mintingFinished = true;
        emit MintFinished();
        return true;
    }

    /**
     * @dev Burns a specific amount of tokens.
     * @param _burner Who to burn tokens from.
     * @param _value The amount of token to be burned.
     */
    function proxyBurn(address _owner, address _burner, uint256 _value) public {
        require(owner == _owner);
        require(_value <= balances[_burner], "LootToken::proxyBurn - amount to burn is greater than balance");
        // no need to require value <= totalSupply, since that would imply the
        // sender's balance is greater than the totalSupply, which *should* be an assertion failure

        balances[_burner] = balances[_burner].sub(_value);
        totalSupply_ = totalSupply_.sub(_value);
        emit Burn(_burner, _value);
        emit Transfer(_burner, address(0), _value);
    }
}