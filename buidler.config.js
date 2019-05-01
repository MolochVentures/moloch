require('@nomiclabs/buidler-truffle5')

module.exports = {
  networks: {
    coverage: {
      url: 'http://localhost:8555'
    }
  },
  solc: {
    version: '0.5.3',
    evmVersion: 'byzantium'
  }
}
