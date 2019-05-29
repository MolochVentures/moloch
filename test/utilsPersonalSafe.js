// Copied From
// https://raw.githubusercontent.com/gnosis/safe-contracts/master/test/utilsPersonalSafe.js

const utils = require('./utils')

let executeTransaction = async function (lw, safe, subject, accounts, to, value, data, operation, executor) {
  let txGasEstimate = 1000000
  let dataGasEstimate = 0
  let gasPrice = 0
  let txGasToken = '0x0000000000000000000000000000000000000000'
  let refundReceiver = safe.address
  let nonce = await safe.nonce()

  let transactionHash = await safe.getTransactionHash(to, value, data, operation, txGasEstimate, dataGasEstimate, gasPrice, txGasToken, refundReceiver, nonce)

  // Confirm transaction with signed messages
  let sigs = utils.signTransaction(lw, accounts, transactionHash)

  // Execute paying transaction
  let tx = await safe.execTransaction(
    to, value, data, operation, txGasEstimate, dataGasEstimate, gasPrice, txGasToken, refundReceiver, sigs, { from: executor, gas: txGasEstimate * 2 }
  )
  return tx
}

Object.assign(exports, {
  executeTransaction
})
