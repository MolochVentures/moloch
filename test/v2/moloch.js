// v2 test spec

const { artifacts, ethereum, web3 } = require('@nomiclabs/buidler')
const chai = require('chai')
const { assert } = chai

const BN = web3.utils.BN

chai
  .use(require('chai-as-promised'))
  .should()

contract.only('Moloch V2', ([creator, summoner, applicant1, applicant2, processor, delegateKey, ...otherAccounts]) => {

  it('hello world', async () => {
    assert.isTrue(true, 'This should be true!')
  })

})
