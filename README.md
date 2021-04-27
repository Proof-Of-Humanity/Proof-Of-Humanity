# Proof-Of-Humanity
Proof-of-Humanity smart contract

You can use the *isRegistered(address _party)* function to determine if an address is or isn't registered.

If you are referring to Proof Of Humanity, we advise you to either:
- Reference the [main contract](https://etherscan.io/address/0xC5E9dDebb09Cd64DfaCab4011A0D5cEDaf7c9BDb) and have a mechanism to switch to a new one.
- Reference the [proxy](https://etherscan.io/address/0x1dAD862095d40d43c2109370121cf087632874dB) which will automatically be updated in case of new versions (like one allowing anonymous accounts). The proxy also acts as a pseudo-ERC20 returning a balance of 1 VOTE to people registered in the registry. This allows to use it for some voting systems using tokens such as [Snapshot](https://snapshot.page/).
