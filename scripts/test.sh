#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
  # Kill the ganache instance that we started (if we started one and if it's still running).
  if [ -n "$ganache_pid" ] && ps -p $ganache_pid > /dev/null; then
    kill -9 $ganache_pid
  fi
}

if [ "$SOLIDITY_COVERAGE" = true ]; then
  ganache_port=8555
else
  ganache_port=8545
fi

ganache_running() {
  nc -z localhost "$ganache_port"
}

start_ganache() {
  if [ "$SOLIDITY_COVERAGE" = true ]; then
    export RUNNING_COVERAGE=true
    node_modules/.bin/ganache-cli-coverage --emitFreeLogs true --allowUnlimitedContractSize true --gasLimit 0xfffffffffff --port "$ganache_port" -m "fetch local valve black attend double eye excite planet primary install allow" > /dev/null &
  else
    node_modules/.bin/ganache-cli -l 99900000  --port "$ganache_port" -m "fetch local valve black attend double eye excite planet primary install allow" > /dev/null &
  fi

  ganache_pid=$!

  echo "Waiting for ganache to launch on port "$ganache_port"..."

  while ! ganache_running; do
    sleep 0.1 # wait for 1/10 of the second before check again
  done

  echo "Ganache launched!"
}

if ganache_running; then
  echo "Using existing ganache instance"
else
  echo "Starting our own ganache instance"
  start_ganache
fi

echo "Hardhat version $(npx hardhat --version)"

if [ "$SOLIDITY_COVERAGE" = true ]; then
  node_modules/.bin/solidity-coverage
else
  npx hardhat test --network develop "$@"
fi
