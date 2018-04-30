const Moloch = artifacts.require('./Moloch')
const foundersJSON = require('../migrations/founders.json')

contract('Moloch', accounts => {
  before('deploy contracts', async() => {
    moloch = await Moloch.deployed()
    founders = foundersJSON
  })
  // verify founding members
  it('should save addresses from deploy', async() => {
    for (let i = 0; i < founders.addresses.length; i++) {
      let memberAddress = founders.addresses[i]
      const member = await moloch.getMember(memberAddress)
      assert.equal(member, true, 'founding member not saved correctly')
    }
  })
  // verify failure of non-founding members
  it('should fail non deployed addresses', async() => {
    for (let i = 0; i < 10; i++) {
      let nonMemberAddress = accounts[i]
      const nonMember = await moloch.getMember(nonMemberAddress)
      assert.equal(nonMember, false, 'non-member added incorrectly')
    }
  })
  // verify founding member shares
  it('should save founder shares from deploy', async() => {
    for (let i = 0; i < founders.addresses.length; i++) {
      let memberAddress = founders.addresses[i]
      const memberShares = await moloch.getVotingShares(memberAddress)
      assert.equal(founders.shares[i], memberShares.toNumber(), 'founding shares not saved correctly')
    }
  })
  // verify failure of incorrect shares
  it('should fail on incorrect shares', async() => {
    for (let i = 0; i < founders.addresses.length; i++) {
      let memberAddress = founders.addresses[i]
      const memberShares = await moloch.getVotingShares(memberAddress)
      assert.notEqual(parseInt(Math.random() * 1000), memberShares.toNumber(), 'incorrect shares saved')
    }
  })  

  // verify create/failure member proposal
  // verify create/failure project proposal
  // verify create/failure start proposal vote
  // verify create/failure vote on current proposal
  // verify create/failure transition proposal to grace period
  // verify create/failure finish proposal
  
  // verify shares
  // verify tokens

  // verify member exit
  // verify member exit burned voting tokens
  // verify member exit loot tokens calculation
  // verify loot tokens decremented correctly on member exit
  // verify exited member no longer has voting ability
})