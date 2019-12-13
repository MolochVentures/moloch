pragma solidity ^0.5.2;

import "../oz/SafeMath.sol";
import "../oz/IERC20.sol";
import "../oz/ERC20.sol";

/**
 * @dev Optional functions from the ERC20 standard.
 */
contract ERC20Detailed is IERC20 {
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /**
     * @dev Sets the values for `name`, `symbol`, and `decimals`. All three of
     * these values are immutable: they can only be set once during
     * construction.
     */
    constructor (string memory name, string memory symbol, uint8 decimals) public {
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }
}

interface IClaimsToken {

	/**
	 * @dev This event emits when funds to be deposited are sent to the token contract
	 * @param from contains the address of the sender of the received funds
	 * @param fundsReceived contains the amount of funds received for distribution
	 */
	event FundsReceived(address indexed from, uint256 fundsReceived);

	/**
	 * @dev This event emits when distributed funds are withdrawn by a token holder.
	 * @param by contains the address of the receiver of funds
	 * @param fundsWithdrawn contains the amount of funds that were withdrawn
	 */
	event FundsWithdrawn(address indexed by, uint256 fundsWithdrawn);

	/**
	 * @dev Withdraws available funds for user.
	 */
	function withdrawFunds() external payable;

	/**
	 * @dev Returns the amount of funds a given address is able to withdraw currently.
	 * @param _forAddress Address of ClaimsToken holder
	 * @return A uint256 representing the available funds for a given account
	 */
	function availableFunds(address _forAddress) external view returns (uint256);

	/**
	 * @dev Get cumulative funds received by ClaimsToken.
	 * @return A uint256 representing the total funds received by ClaimsToken
	 */
	function totalReceivedFunds() external view returns (uint256);
}

contract ClaimsToken is IClaimsToken, ERC20, ERC20Detailed {

	using SafeMath for uint256;

	// cumulative funds received by this contract
	uint256 public receivedFunds;
	// cumulative funds received which were already processed for distribution - by user
	mapping (address => uint256) public processedFunds;
	// claimed but not yet withdrawn funds for a user
	mapping (address => uint256) public claimedFunds;


	constructor(address _owner)
		public
		ERC20Detailed("ClaimsToken", "CST", 18)
	{
		_mint(_owner, 10000 * (10 ** uint256(18)));

		receivedFunds = 0;
	}

	/**
	 * @dev Transfer token to a specified address.
	 * Claims funds for both parties, whereby the amount of tokens withdrawn
	 * is inherited by the new token owner.
	 * @param _to The address to transfer to
	 * @param _value The amount to be transferred
	 */
	function transfer(address _to, uint256 _value)
		public
		returns (bool)
	{
		_claimFunds(msg.sender);
		_claimFunds(_to);

		return super.transfer(_to, _value);
	}


	/**
	 * @dev Transfer tokens from one address to another.
	 * Claims funds for both parties, whereby the amount of tokens withdrawn
	 * is inherited by the new token owner.
	 * @param _from address The address which you want to send tokens from
	 * @param _to address The address which you want to transfer to
	 * @param _value uint256 the amount of tokens to be transferred
	 */
	function transferFrom(address _from, address _to, uint256 _value)
		public
		returns (bool)
	{
		_claimFunds(_from);
		_claimFunds(_to);

		return super.transferFrom(_from, _to, _value);
	}

	/**
	 * @dev Get cumulative funds received by ClaimsToken.
	 * @return A uint256 representing the total funds received by ClaimsToken
	 */
	function totalReceivedFunds()
		external
		view
		returns (uint256)
	{
		return receivedFunds;
	}

	/**
	 * @dev Returns the amount of funds a given address is able to withdraw currently.
	 * @param _forAddress Address of ClaimsToken holder
	 * @return A uint256 representing the available funds for a given account
	 */
	function availableFunds(address _forAddress)
		public
		view
		returns (uint256)
	{
		return _calcUnprocessedFunds(_forAddress).add(claimedFunds[_forAddress]);
	}

	/**
	 * @dev Increments cumulative received funds by new received funds.
	 * Called when ClaimsToken receives funds.
	 * @param _value Amount of tokens / Ether received
	 */
	function _registerFunds(uint256 _value)
		internal
	{
		receivedFunds = receivedFunds.add(_value);
	}

	/**
	 * @dev Returns payout for a user which can be withdrawn or claimed.
	 * @param _forAddress Address of ClaimsToken holder
	 */
	function _calcUnprocessedFunds(address _forAddress)
		internal
		view
		returns (uint256)
	{
		uint256 newReceivedFunds = receivedFunds.sub(processedFunds[_forAddress]);
		return balanceOf(_forAddress).mul(newReceivedFunds).div(totalSupply());
	}

	/**
	 * @dev Claims funds for a user.
	 * @param _forAddress Address of ClaimsToken holder
	 */
	function _claimFunds(address _forAddress) internal {
		uint256 unprocessedFunds = _calcUnprocessedFunds(_forAddress);

		processedFunds[_forAddress] = receivedFunds;
		claimedFunds[_forAddress] = claimedFunds[_forAddress].add(unprocessedFunds);
	}

	/**
	 * @dev Sets claimed but not yet withdrawn funds to 0,
	 * marks total received funds as processed and
	 * returns the withdrawable amount for a user.
	 * @return A uint256 representing the withdrawable funds
	 */
	function _prepareWithdraw()
		internal
		returns (uint256)
	{
		uint256 withdrawableFunds = availableFunds(msg.sender);

		processedFunds[msg.sender] = receivedFunds;
		claimedFunds[msg.sender] = 0;

		return withdrawableFunds;
	}
}

contract ClaimsTokenERC20Extension is IClaimsToken, ClaimsToken {

	// token that ClaimsToken takes in custodianship
	IERC20 public fundsToken;

	modifier onlyFundsToken () {
		require(msg.sender == address(fundsToken), "UNAUTHORIZED_SENDER");
		_;
	}

	constructor(address _owner, IERC20 _fundsToken)
		public
		ClaimsToken(_owner)
	{
		require(address(_fundsToken) != address(0));

		fundsToken = _fundsToken;
	}

	/**
	 * @dev Withdraws available funds for user.
	 */
	function withdrawFunds()
		external
		payable
	{
		require(msg.value == 0, "");

		uint256 withdrawableFunds = _prepareWithdraw();

		require(fundsToken.transfer(msg.sender, withdrawableFunds), "TRANSFER_FAILED");
	}

	/**
	 * @dev For ERC223.
	 * Calls _registerFunds(), whereby total received funds (cumulative) gets updated.
	 * @param _sender Sender of tokens
	 * @param _value Amount of tokens
	 */
	function tokenFallback(address _sender, uint256 _value, bytes memory)
		public
		onlyFundsToken()
	{
		if (_value > 0) {
			_registerFunds(_value);
			emit FundsReceived(_sender, _value);
		}
	}
}
