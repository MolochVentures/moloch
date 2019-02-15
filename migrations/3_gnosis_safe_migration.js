var ProxyFactory = artifacts.require("./ProxyFactory.sol");
var GnosisSafePersonalEdition = artifacts.require("./GnosisSafePersonalEdition.sol");

const notOwnedAddress = "0x0000000000000000000000000000000000000002"
const notOwnedAddress2 = "0x0000000000000000000000000000000000000003"

let initSafe = function (safe) {
    safe.setup([notOwnedAddress], 1, 0, 0)
    return safe
}

module.exports = function(deployer) {
    if (process.env.target != 'mainnet') {
        deployer.deploy(ProxyFactory);
        deployer.deploy(GnosisSafePersonalEdition).then(initSafe);
    }
};
