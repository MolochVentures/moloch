// Copied from https://github.com/gnosis/safe-contracts/blob/development/test/utils.js

const util = require('util');
const lightwallet = require('eth-lightwallet')
const abi = require("ethereumjs-abi");

async function getParamFromTxEvent(transaction, eventName, paramName, contract, contractFactory, subject) {
    assert.isObject(transaction)
    if (subject != null) {
        // logGasUsage(subject, transaction)
    }
    let logs = transaction.logs
    if(eventName != null) {
        logs = logs.filter((l) => l.event === eventName && l.address === contract)
    }
    assert.equal(logs.length, 1, 'too many logs found!')
    let param = logs[0].args[paramName]
    if(contractFactory != null) {
        let contract = await contractFactory.at(param)
        assert.isObject(contract, `getting ${paramName} failed for ${param}`)
        return contract
    } else {
        return param
    }
}

function logGasUsage(subject, transactionOrReceipt) {
    let receipt = transactionOrReceipt.receipt || transactionOrReceipt
    console.log("    Gas costs for " + subject + ": " + receipt.gasUsed)
}

async function createLightwallet() {
    // Create lightwallet accounts
    const createVault = util.promisify(lightwallet.keystore.createVault).bind(lightwallet.keystore)
    const keystore = await createVault({
        hdPathString: "m/44'/60'/0'/0",
        seedPhrase: "pull rent tower word science patrol economy legal yellow kit frequent fat",
        password: "test",
        salt: "testsalt"
    })
    const keyFromPassword = await util.promisify(keystore.keyFromPassword).bind(keystore)("test")
    keystore.generateNewAddress(keyFromPassword, 20)
    return {
        keystore: keystore,
        accounts: keystore.getAddresses(),
        passwords: keyFromPassword
    }
}

function signTransaction(lw, signers, transactionHash) {
    let signatureBytes = "0x"
    signers.sort()
    for (var i=0; i<signers.length; i++) {
        let sig = lightwallet.signing.signMsgHash(lw.keystore, lw.passwords, transactionHash, signers[i])
        signatureBytes += sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16)
    }
    return signatureBytes
}

Object.assign(exports, {
    getParamFromTxEvent, // keep
    logGasUsage, // keep
    createLightwallet, // keep
    signTransaction // keep
})
