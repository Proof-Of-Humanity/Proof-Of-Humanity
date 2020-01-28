/**
 *  @title Arbitrable
 *  @author Clément Lesaege - <clement@lesaege.com>
 *  Bug Bounties: This code hasn't undertaken a bug bounty program yet.
 */

pragma solidity ^0.5.13;

import "./IArbitrable.sol";

/** @title Arbitrable
 *  Arbitrable abstract contract.
 *  When developing arbitrable contracts, we need to:
 *  -Define the action taken when a ruling is received by the contract. We should do so in executeRuling.
 *  -Allow dispute creation. For this a function must:
 *      -Call arbitrator.createDispute.value(_fee)(_choices,_extraData);
 *      -Create the event Dispute(_arbitrator,_disputeID,_rulingOptions);
 */
contract Arbitrable is IArbitrable {
    Arbitrator public arbitrator;
    bytes public arbitratorExtraData; // Extra data to require particular dispute and appeal behaviour.

    modifier onlyArbitrator {require(msg.sender == address(arbitrator), "Can only be called by the arbitrator."); _;}

    /** @dev Constructor. Choose the arbitrator.
     *  @param _arbitrator The arbitrator of the contract.
     *  @param _arbitratorExtraData Extra data for the arbitrator.
     */
    constructor(Arbitrator _arbitrator, bytes memory _arbitratorExtraData) public {
        arbitrator = _arbitrator;
        arbitratorExtraData = _arbitratorExtraData;
    }

    /** @dev Give a ruling for a dispute. Must be called by the arbitrator.
     *  The purpose of this function is to ensure that the address calling it has the right to rule on the contract.
     *  @param _disputeID ID of the dispute in the Arbitrator contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function rule(uint _disputeID, uint _ruling) public onlyArbitrator {
        emit Ruling(Arbitrator(msg.sender),_disputeID,_ruling);

        executeRuling(_disputeID,_ruling);
    }


    /** @dev Execute a ruling of a dispute.
     *  @param _disputeID ID of the dispute in the Arbitrator contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function executeRuling(uint _disputeID, uint _ruling) internal;
}