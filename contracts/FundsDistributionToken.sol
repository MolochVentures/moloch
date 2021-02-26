pragma solidity ^0.5.2;

import "./oz/SafeMath.sol";
import "./oz/IERC20.sol";
import "./oz/ERC20.sol";


/**
 * @title SafeMathUint
 * @dev Math operations with safety checks that revert on error
 */
library SafeMathUint {
  function toInt256Safe(uint256 a) internal pure returns (int256) {
    int256 b = int256(a);
    require(b >= 0);
    return b;
  }
}

/**
 * @title SafeMathInt
 * @dev Math operations with safety checks that revert on error
 * @dev SafeMath adapted for int256
 * Based on code of  https://github.com/RequestNetwork/requestNetwork/blob/master/packages/requestNetworkSmartContracts/contracts/base/math/SafeMathInt.sol
 */
library SafeMathInt {
  function mul(int256 a, int256 b) internal pure returns (int256) {
    // Prevent overflow when multiplying INT256_MIN with -1
    // https://github.com/RequestNetwork/requestNetwork/issues/43
    require(!(a == - 2**255 && b == -1) && !(b == - 2**255 && a == -1));

    int256 c = a * b;
    require((b == 0) || (c / b == a));
    return c;
  }

  function div(int256 a, int256 b) internal pure returns (int256) {
    // Prevent overflow when dividing INT256_MIN by -1
    // https://github.com/RequestNetwork/requestNetwork/issues/43
    require(!(a == - 2**255 && b == -1) && (b > 0));

    return a / b;
  }

  function sub(int256 a, int256 b) internal pure returns (int256) {
    require((b >= 0 && a - b <= a) || (b < 0 && a - b > a));

    return a - b;
  }

  function add(int256 a, int256 b) internal pure returns (int256) {
    int256 c = a + b;
    require((b >= 0 && c >= a) || (b < 0 && c < a));
    return c;
  }

  function toUint256Safe(int256 a) internal pure returns (uint256) {
    require(a >= 0);
    return uint256(a);
  }
}

interface IFundsDistributionToken {

	/**
	 * @dev Returns the total amount of funds a given address is able to withdraw currently.
	 * @param owner Address of FundsDistributionToken holder
	 * @return A uint256 representing the available funds for a given account
	 */
	function withdrawableFundsOf(address owner) external view returns (uint256);

	/**
	 * @dev Withdraws all available funds for a FundsDistributionToken holder.
	 */
	function withdrawFunds() external;

	/**
	 * @dev This event emits when new funds are distributed
	 * @param by the address of the sender who distributed funds
	 * @param fundsDistributed the amount of funds received for distribution
	 */
	event FundsDistributed(address indexed by, uint256 fundsDistributed);

	/**
	 * @dev This event emits when distributed funds are withdrawn by a token holder.
	 * @param by the address of the receiver of funds
	 * @param fundsWithdrawn the amount of funds that were withdrawn
	 */
	event FundsWithdrawn(address indexed by, uint256 fundsWithdrawn);
}

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
     * > Note that this information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * `IERC20.balanceOf` and `IERC20.transfer`.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }
}

/**
 * @title Roles
 * @dev Library for managing addresses assigned to a Role.
 */
library Roles {
    struct Role {
        mapping (address => bool) bearer;
    }

    /**
     * @dev Give an account access to this role.
     */
    function add(Role storage role, address account) internal {
        require(!has(role, account), "Roles: account already has role");
        role.bearer[account] = true;
    }

    /**
     * @dev Remove an account's access to this role.
     */
    function remove(Role storage role, address account) internal {
        require(has(role, account), "Roles: account does not have role");
        role.bearer[account] = false;
    }

    /**
     * @dev Check if an account has this role.
     * @return bool
     */
    function has(Role storage role, address account) internal view returns (bool) {
        require(account != address(0), "Roles: account is the zero address");
        return role.bearer[account];
    }
}

contract MinterRole {
    using Roles for Roles.Role;

    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    Roles.Role private _minters;

    constructor () internal {
        _addMinter(msg.sender);
    }

    modifier onlyMinter() {
        require(isMinter(msg.sender), "MinterRole: caller does not have the Minter role");
        _;
    }

    function isMinter(address account) public view returns (bool) {
        return _minters.has(account);
    }

    function addMinter(address account) public onlyMinter {
        _addMinter(account);
    }

    function renounceMinter() public {
        _removeMinter(msg.sender);
    }

    function _addMinter(address account) internal {
        _minters.add(account);
        emit MinterAdded(account);
    }

    function _removeMinter(address account) internal {
        _minters.remove(account);
        emit MinterRemoved(account);
    }
}

/**
 * @dev Extension of `ERC20` that adds a set of accounts with the `MinterRole`,
 * which have permission to mint (create) new tokens as they see fit.
 *
 * At construction, the deployer of the contract is the only minter.
 */
contract ERC20Mintable is ERC20, MinterRole {
    /**
     * @dev See `ERC20._mint`.
     *
     * Requirements:
     *
     * - the caller must have the `MinterRole`.
     */
    function mint(address account, uint256 amount) public onlyMinter returns (bool) {
        _mint(account, amount);
        return true;
    }
}

/** 
 * @title FundsDistributionToken
 * @author Johannes Escherich
 * @author Roger-Wu
 * @author Johannes Pfeffer
 * @author Tom Lam
 * @dev A  mintable token that can represent claims on cash flow of arbitrary assets such as dividends, loan repayments, 
 * fee or revenue shares among large numbers of token holders. Anyone can deposit funds, token holders can withdraw 
 * their claims.
 * FundsDistributionToken (FDT) implements the accounting logic. FDT-Extension contracts implement methods for depositing and 
 * withdrawing funds in Ether or according to a token standard such as ERC20, ERC223, ERC777.
 */
contract FundsDistributionToken is IFundsDistributionToken, ERC20Detailed, ERC20Mintable {

	using SafeMath for uint256;
	using SafeMathUint for uint256;
	using SafeMathInt for int256;

	// optimize, see https://github.com/ethereum/EIPs/issues/1726#issuecomment-472352728
	uint256 constant internal pointsMultiplier = 2**128;
	uint256 internal pointsPerShare;

	mapping(address => int256) internal pointsCorrection;
	mapping(address => uint256) internal withdrawnFunds;


	constructor (
		string memory name, 
		string memory symbol
	) 
		public 
		ERC20Detailed(name, symbol, 18) 
	{}

	/** 
	 * prev. distributeDividends
	 * @notice Distributes funds to token holders.
	 * @dev It reverts if the total supply of tokens is 0.
	 * It emits the `FundsDistributed` event if the amount of received ether is greater than 0.
	 * About undistributed funds:
	 *   In each distribution, there is a small amount of funds which does not get distributed,
	 *     which is `(msg.value * pointsMultiplier) % totalSupply()`.
	 *   With a well-chosen `pointsMultiplier`, the amount funds that are not getting distributed
	 *     in a distribution can be less than 1 (base unit).
	 *   We can actually keep track of the undistributed ether in a distribution
	 *     and try to distribute it in the next distribution ....... todo implement  
	 */
	function _distributeFunds(uint256 value) internal {
		require(totalSupply() > 0, "FundsDistributionToken._distributeFunds: SUPPLY_IS_ZERO");

		if (value > 0) {
			pointsPerShare = pointsPerShare.add(
				value.mul(pointsMultiplier) / totalSupply()
			);
			emit FundsDistributed(msg.sender, value);
		}
	}

	/**
	 * prev. withdrawDividend
	 * @notice Prepares funds withdrawal
	 * @dev It emits a `FundsWithdrawn` event if the amount of withdrawn ether is greater than 0.
	 */
	function _prepareWithdraw() internal returns (uint256) {
		uint256 _withdrawableDividend = withdrawableFundsOf(msg.sender);
	
		withdrawnFunds[msg.sender] = withdrawnFunds[msg.sender].add(_withdrawableDividend);
		
		emit FundsWithdrawn(msg.sender, _withdrawableDividend);

		return _withdrawableDividend;
	}

	/** 
	 * prev. withdrawableDividendOf
	 * @notice View the amount of funds that an address can withdraw.
	 * @param _owner The address of a token holder.
	 * @return The amount funds that `_owner` can withdraw.
	 */
	function withdrawableFundsOf(address _owner) public view returns(uint256) {
		return accumulativeFundsOf(_owner).sub(withdrawnFunds[_owner]);
	}
	
	/**
	 * prev. withdrawnDividendOf
	 * @notice View the amount of funds that an address has withdrawn.
	 * @param _owner The address of a token holder.
	 * @return The amount of funds that `_owner` has withdrawn.
	 */
	function withdrawnFundsOf(address _owner) public view returns(uint256) {
		return withdrawnFunds[_owner];
	}

	/**
	 * prev. accumulativeDividendOf
	 * @notice View the amount of funds that an address has earned in total.
	 * @dev accumulativeFundsOf(_owner) = withdrawableFundsOf(_owner) + withdrawnFundsOf(_owner)
	 * = (pointsPerShare * balanceOf(_owner) + pointsCorrection[_owner]) / pointsMultiplier
	 * @param _owner The address of a token holder.
	 * @return The amount of funds that `_owner` has earned in total.
	 */
	function accumulativeFundsOf(address _owner) public view returns(uint256) {
		return pointsPerShare.mul(balanceOf(_owner)).toInt256Safe()
			.add(pointsCorrection[_owner]).toUint256Safe() / pointsMultiplier;
	}

	/**
	 * @dev Internal function that transfer tokens from one address to another.
	 * Update pointsCorrection to keep funds unchanged.
	 * @param from The address to transfer from.
	 * @param to The address to transfer to.
	 * @param value The amount to be transferred.
	 */
	function _transfer(address from, address to, uint256 value) internal {
		super._transfer(from, to, value);

		int256 _magCorrection = pointsPerShare.mul(value).toInt256Safe();
		pointsCorrection[from] = pointsCorrection[from].add(_magCorrection);
		pointsCorrection[to] = pointsCorrection[to].sub(_magCorrection);
	}

	/**
	 * @dev Internal function that mints tokens to an account.
	 * Update pointsCorrection to keep funds unchanged.
	 * @param account The account that will receive the created tokens.
	 * @param value The amount that will be created.
	 */
	function _mint(address account, uint256 value) internal {
		super._mint(account, value);

		pointsCorrection[account] = pointsCorrection[account]
			.sub( (pointsPerShare.mul(value)).toInt256Safe() );
	}
	
	/** 
	 * @dev Internal function that burns an amount of the token of a given account.
	 * Update pointsCorrection to keep funds unchanged.
	 * @param account The account whose tokens will be burnt.
	 * @param value The amount that will be burnt.
	 */
	function _burn(address account, uint256 value) internal {
		super._burn(account, value);

		pointsCorrection[account] = pointsCorrection[account]
			.add( (pointsPerShare.mul(value)).toInt256Safe() );
	}
}

contract FDT_ERC20Extension is IFundsDistributionToken, FundsDistributionToken {

	using SafeMathUint for uint256;
	using SafeMathInt for int256;

	// token in which the funds can be sent to the FundsDistributionToken
	IERC20 public fundsToken;
	
	// balance of fundsToken that the FundsDistributionToken currently holds
	uint256 public fundsTokenBalance;


	modifier onlyFundsToken () {
		require(msg.sender == address(fundsToken), "FDT_ERC20Extension.onlyFundsToken: UNAUTHORIZED_SENDER");
		_;
	}

	constructor(
		string memory name, 
		string memory symbol,
		IERC20 _fundsToken
	) 
		public 
		FundsDistributionToken(name, symbol)
	{
		require(address(_fundsToken) != address(0), "FDT_ERC20Extension: INVALID_FUNDS_TOKEN_ADDRESS");

		fundsToken = _fundsToken;
	}

	/**
	 * @notice Withdraws all available funds for a token holder
	 */
	function withdrawFunds() 
		external 
	{
		uint256 withdrawableFunds = _prepareWithdraw();
		
		require(fundsToken.transfer(msg.sender, withdrawableFunds), "FDT_ERC20Extension.withdrawFunds: TRANSFER_FAILED");

		_updateFundsTokenBalance();
	}

	/**
	 * @dev Updates the current funds token balance 
	 * and returns the difference of new and previous funds token balances
	 * @return A int256 representing the difference of the new and previous funds token balance
	 */
	function _updateFundsTokenBalance() internal returns (int256) {
		uint256 prevFundsTokenBalance = fundsTokenBalance;
		
		fundsTokenBalance = fundsToken.balanceOf(address(this));

		return int256(fundsTokenBalance).sub(int256(prevFundsTokenBalance));
	}

	/**
	 * @notice Register a payment of funds in tokens. May be called directly after a deposit is made.
	 * @dev Calls _updateFundsTokenBalance(), whereby the contract computes the delta of the previous and the new 
	 * funds token balance and increments the total received funds (cumulative) by delta by calling _registerFunds()
	 */
	function updateFundsReceived() external {
		int256 newFunds = _updateFundsTokenBalance();

		if (newFunds > 0) {
			_distributeFunds(newFunds.toUint256Safe());
		}
	}
}
