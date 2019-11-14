mkdir -p contracts/flattened
node_modules/.bin/truffle-flattener contracts/Moloch.sol > contracts/flattened/Moloch.sol
node_modules/.bin/truffle-flattener contracts/GuildBank.sol > contracts/flattened/GuildBank.sol
node_modules/.bin/truffle-flattener contracts/Token.sol > contracts/flattened/Token.sol
