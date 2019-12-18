module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  compilers: {
    solc: {
      version: '0.5.13', // Fetch exact version from solc-bin (default: truffle's version)
      settings: {
        // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  },
  mocha: {
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD'
    }
  },
  networks: {
    development: {
      host: 'localhost',
      network_id: '*',
      gas: 8000000,
      port: 8545
    },
    kovan: {
      confirmations: 2,
      gas: 6000000,
      gasPrice: 20000000000,
      network_id: 42
    }
  }
}
