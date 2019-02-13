// Copied From
// https://raw.githubusercontent.com/gnosis/safe-contracts/master/test/utilsPersonalSafe.js

const utils = require('./utils')
const solc = require('solc')
const BigNumber = require('bignumber.js');

const GAS_PRICE = web3.utils.toWei('1', 'gwei')

let executeTransaction = async function(lw, safe, subject, accounts, to, value, data, operation, executor) {
    let txGasEstimate = 1000000
    let dataGasEstimate = 0
    let gasPrice = 0
    let txGasToken = 0

    let nonce = await safe.nonce()

    let transactionHash = await safe.getTransactionHash(to, value, data, operation, txGasEstimate, dataGasEstimate, gasPrice, txGasToken, nonce)

    // Confirm transaction with signed messages
    let sigs = utils.signTransaction(lw, accounts, transactionHash)

    // Execute paying transaction
    let tx = await safe.execTransactionAndPaySubmitter(
        to, value, data, operation, txGasEstimate, dataGasEstimate, gasPrice, txGasToken, sigs, {from: executor, gas: txGasEstimate * 2 }
    )
    return tx
}

Object.assign(exports, {
    executeTransaction
})
