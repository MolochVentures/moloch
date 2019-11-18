usePlugin('@nomiclabs/buidler-truffle5')

require('./scripts/moloch-tasks')
require('./scripts/pool-tasks')

const INFURA_API_KEY = ''
const MAINNET_PRIVATE_KEY = ''
const ROPSTEN_PRIVATE_KEY = ''

module.exports = {
  networks: {
    develop: {
      url: 'http://localhost:8545',
      deployedContracts: {
        moloch: '',
        pool: ''
      }
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [ ROPSTEN_PRIVATE_KEY ],
      deployedContracts: {
        moloch: "",
        pool: ""
      }
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [ MAINNET_PRIVATE_KEY ],
      deployedContracts: {
        moloch: '0x1fd169A4f5c59ACf79d0Fd5d91D1201EF1Bce9f1', // The original Moloch
        pool: ""
      }
    },
    coverage: {
      url: 'http://localhost:8555'
    }
  },
  solc: {
    version: '0.5.3',
    evmVersion: 'constantinople'
  }
}
