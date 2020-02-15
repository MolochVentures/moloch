module.exports = {
  compilers: {
    solc: {
      version: '0.5.3',
      settings: {
        optimizer: {
          enabled: true, // Default: false
          runs: 200      // Default: 200
        },
      }
    }
  },
  
  networks: {
    development: {
      host: '127.0.0.1',
      port: 7545,
      gas: 6721975, // <-- Use this high gas value
      gasPrice: 1000000000,    // <-- Use this low gas price
      network_id: '*', // Match any network id
    },
  },

  mocha: {
    enableTimeouts: false,
    before_timeout: 120000 // 2min
  }
}
