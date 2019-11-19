module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      network_id: '*',
      gas: 0xfffffffffff,
      gasPrice: 0x01
    },
    coverage: {
      host: 'localhost',
      network_id: '*',
      port: 8555,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    },
    mainnet: getInfuraConfig('mainnet', 1),
    ropsten: getInfuraConfig('ropsten', 3)
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  compilers: {
    solc: {
      version: '0.5.3',
      evmVersion: 'byzantium'
    }
  }
};

function getInfuraConfig (networkName, networkId) {
  return {
    network_id: networkId,
    provider: `https://${networkName}.infura.io/v3/` + keys.infura_projectid,
    gas: 6000000,
    gasPrice: 10000000000 //10 Gwei
  }
}
