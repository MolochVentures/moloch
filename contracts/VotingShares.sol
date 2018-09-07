pragma solidity 0.4.23;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

/**
 * Structured like an ERC20, but can only be burned/minted and not transferred.
 */
contract VotingShares is Ownable {
    using SafeMath for uint256;

    uint256 totalSupply_;
    mapping(address => uint256) balances;
    bool public mintingFinished = false;
    address public owner;

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    event MintFinished();

    modifier canMint() {
        require(!mintingFinished, "VotingShares::canMint - minting finished");
        _;
    }

    constructor() public {
        owner = msg.sender;
    }

    /**
    * @dev total number of tokens in existence
    */
    function totalSupply() public view returns (uint256) {
        return totalSupply_;
    }

    /**
     * @dev Burns a specific amount of tokens.
     * @param _burner Who to burn tokens from.
     * @param _value The amount of token to be burned.
     */
    function proxyBurn(address burner, uint256 value) public onlyOwner {
        require(value <= balances[burner], "VotingShares::proxyBurn - value less than balance");
        // no need to require value <= totalSupply, since that would imply the
        // sender's balance is greater than the totalSupply, which *should* be an assertion failure

        balances[burner] = balances[burner].sub(value);
        totalSupply_ = totalSupply_.sub(value);
        emit Burn(burner, value);
    }

    /**
    * @dev Gets the balance of the specified address.
    * @param _owner The address to query the the balance of.
    * @return An uint256 representing the amount owned by the passed address.
    */
    function balanceOf(address owner) public view returns (uint256 balance) {
        return balances[owner];
    }

    /**
     * @dev Function to mint tokens
     * @param _to The address that will receive the minted tokens.
     * @param _amount The amount of tokens to mint.
     * @return A boolean that indicates if the operation was successful.
     */
    function mint(address to, uint256 amount) public onlyOwner canMint returns (address) {
        totalSupply_ = totalSupply_.add(amount);
        balances[to] = balances[to].add(amount);
        emit Mint(to, amount);
        emit Transfer(address(0), to, amount);
        return owner;
    }

    /**
     * @dev Function to stop minting new tokens.
     * @return True if the operation was successful.
     */
    function finishMinting() onlyOwner canMint public returns (bool) {
        mintingFinished = true;
        emit MintFinished();
        return true;
    }
}