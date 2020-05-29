pragma solidity 0.5.17;

/*
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with GSN meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
contract Context {
    function _msgSender() internal view returns (address payable) {
        return msg.sender;
    }

    function _msgData() internal view returns (bytes memory) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        return msg.data;
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

contract SecretaryRole is Context {
    using Roles for Roles.Role;

    event SecretaryAdded(address indexed account);
    event SecretaryRemoved(address indexed account);

    Roles.Role private _secretaries;
    
    constructor () internal {
        _addSecretary(_msgSender());
    }

    modifier onlySecretary() {
        require(isSecretary(_msgSender()), "SecretaryRole: caller does not have the Secretary role");
        _;
    }
    
    function isSecretary(address account) public view returns (bool) {
        return _secretaries.has(account);
    }

    function addSecretary(address account) public onlySecretary {
        _addSecretary(account);
    }

    function renounceSecretary() public {
        _removeSecretary(_msgSender());
    }

    function _addSecretary(address account) internal {
        _secretaries.add(account);
        emit SecretaryAdded(account);
    }

    function _removeSecretary(address account) internal {
        _secretaries.remove(account);
        emit SecretaryRemoved(account);
    }
}

contract LexDAOTokenList is SecretaryRole {
    address[] public listings;
    string public message;
    mapping(address => Token) public tokenList;
    
    struct Token {
        uint256 tokenIndex;
        bool listed;
    }
    
    event TokenListed(address indexed _token);
    event TokenUnlisted(address indexed _token);
    event MessageUpdated(string indexed _message);
    
    constructor (address[] memory _listings, string memory _message) public {
        for (uint256 i = 0; i < _listings.length; i++) {
             require(_listings[i] != address(0), "token address cannot be 0");
             tokenList[_listings[i]].tokenIndex = listings.push(_listings[i]) - 1;
             tokenList[_listings[i]].listed = true;
        }
        
        message = _message;
    }
    
    /****************
    LISTING FUNCTIONS
    ****************/
    function list(address _token) public onlySecretary { 
        require(tokenList[_token].listed != true, "token already listed");
        tokenList[_token].tokenIndex = listings.push(_token) - 1;
        tokenList[_token].listed = true;
        emit TokenListed(_token);
    }

    function unlist(address _token) public onlySecretary {
        require(tokenList[_token].listed == true, "no such token to remove");
        uint256 tokenToUnlist = tokenList[_token].tokenIndex;
        address tkn = listings[listings.length - 1];
        listings[tokenToUnlist] = tkn;
        tokenList[tkn].tokenIndex = tokenToUnlist;
        tokenList[_token].listed = false;
        listings.length--;
        emit TokenUnlisted(_token);
    }
    
    function updateMessage(string memory _message) public onlySecretary {
        message = _message;
        emit MessageUpdated(_message);
    }
    
    // *******
    // GETTERS
    // *******
    function isListed(address _token) public view returns (bool listed) {
        if(listings.length == 0) return false;
        return (listings[tokenList[_token].tokenIndex] == _token);
    }
    
    function TokenCount() public view returns(uint256 tokenCount) {
        return listings.length;
    }
    
    function TokenList() public view returns (address[] memory) {
        return listings;
    }
}
