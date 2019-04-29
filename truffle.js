module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      gas: 4700000,
      network_id: '*' // Match any network id
    }
  },
  compilers: {
    solc: {
      version: "0.5.2",
    },
  },
}

/*

Available Accounts
==================
(0) 0x9faa0720cedfe32bad8d6c7f96fd7b71903cfa7d (~100 ETH)
(1) 0xf98e71d7feb5ca6bf437c438a1fdc597322bcb0b (~100 ETH)
(2) 0x31fa2aed69c70c6ec435c9ef669fd8a06b41465e (~100 ETH)
(3) 0x3f964c40db4a3ac5b4422b6004dccb0576ce250f (~100 ETH)
(4) 0x87c8137bcd210ee00519492ec8845a76bb40a495 (~100 ETH)
(5) 0x1d587542f2799a0b808a6c484b781f0bf376c2a5 (~100 ETH)
(6) 0xd40f6b658da5c8b3ebee0728aec74515b25e14d0 (~100 ETH)
(7) 0x10d0620f65443e3b755e8a8a35664f9f9c72691a (~100 ETH)
(8) 0xcfbfdfe7be58af99e088725b29180e717defbea5 (~100 ETH)
(9) 0x12b65d9cac1d7e1263ab828ce56e5de6f6731004 (~100 ETH)

Private Keys
==================
(0) 0x4e086d3ab66803a8088ddaf8c0eb7e343c16ca47085c1c1ca5a9c05a2337fced
(1) 0x42870efa3939900032b5eb1dcd5850d44f7dfc77b3d6dc971844bf0a7da99b43
(2) 0x0caa42498bb287d8e3f11d3bee2c8037eeea19f7868e07b5501dbe0647159a24
(3) 0xbc643724d67933313ea435641e379028bfef539e7a5fd06a7a195856423acc6b
(4) 0x0aba058b9a8093629db0f73fc652b2c3a22f7c6017787d0a6472f37b3b67a22c
(5) 0x00306ba6a28b46a8f17760753180ec1036c3c4b4e3b371cdfcf5157b12e1b9dc
(6) 0x15cb4b73b9db96bbc313e2de58ccda5a399dacf31668fee5adabd604481fe664
(7) 0xfd789541261b3d5ef65f5dd51b1c4d6dc503d2d1ae81aebb02ffbb86445661fc
(8) 0xf0c6625a30cac38f2b2ba7fec3e021671d803b3883ff69ade7ef6486e4f3e5cc
(9) 0x3d6c61c184ccbd33f650b840ad3b92a8d4b60653b262a7b64067b2e19c08c727

HD Wallet
==================
Mnemonic:      sword card process delay payment chalk jar list dinner fury carbon bunker
Base HD Path:  m/44'/60'/0'/0/{account_index}

*/
