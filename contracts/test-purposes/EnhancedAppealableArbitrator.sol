pragma solidity ^0.5.17;

import "./AppealableArbitrator.sol";

/**
 *  @title EnhancedAppealableArbitrator
 *  @author Enrique Piqueras - <epiquerass@gmail.com>
 *  @dev Implementation of `AppealableArbitrator` that supports `appealPeriod`.
 */
contract EnhancedAppealableArbitrator is AppealableArbitrator {
    /* Constructor */

    /* solium-disable no-empty-blocks */
    /** @dev Constructs the `EnhancedAppealableArbitrator` contract.
     *  @param _arbitrationPrice The amount to be paid for arbitration.
     *  @param _arbitrator The back up arbitrator.
     *  @param _arbitratorExtraData Not used by this contract.
     *  @param _timeOut The time out for the appeal period.
     */
    constructor(
        uint _arbitrationPrice,
        IArbitrator _arbitrator,
        bytes memory _arbitratorExtraData,
        uint _timeOut
    ) public AppealableArbitrator(_arbitrationPrice, _arbitrator, _arbitratorExtraData, _timeOut) {}
    /* solium-enable no-empty-blocks */

    /* Public Views */

    /** @dev Compute the start and end of the dispute's current or next appeal period, if possible.
     *  @param _disputeID ID of the dispute.
     *  @return The start and end of the period.
     */
    function appealPeriod(uint _disputeID) public view returns(uint start, uint end) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0)))
            (start, end) = appealDisputes[_disputeID].arbitrator.appealPeriod(appealDisputes[_disputeID].appealDisputeID);
        else {
            start = appealDisputes[_disputeID].rulingTime;
            require(start != 0, "The specified dispute is not appealable.");
            end = start + timeOut;
        }
    }
}