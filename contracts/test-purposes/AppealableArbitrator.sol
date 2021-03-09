/**
*  https://contributing.kleros.io/smart-contract-workflow
*  @authors: [@epiqueras, @ferittuncer]
*  @reviewers: []
*  @auditors: []
*  @bounties: []
*  @deployments: []
*/

pragma solidity ^0.5.17;

import "./CentralizedArbitrator.sol";

/**
 *  @title AppealableArbitrator
 *  @dev A centralized arbitrator that can be appealed.
 */
contract AppealableArbitrator is CentralizedArbitrator, IArbitrable {
    /* Structs */

    struct AppealDispute {
        uint rulingTime;
        IArbitrator arbitrator;
        uint appealDisputeID;
    }

    /* Modifiers */

    modifier onlyArbitrator {require(msg.sender == address(arbitrator), "Can only be called by the arbitrator."); _;}
    modifier requireAppealFee(uint _disputeID, bytes memory _extraData) {
        require(msg.value >= appealCost(_disputeID, _extraData), "Not enough ETH to cover appeal costs.");
        _;
    }

    /* Storage */

    uint public timeOut;
    mapping(uint => AppealDispute) public appealDisputes;
    mapping(uint => uint) public appealDisputeIDsToDisputeIDs;
    IArbitrator public arbitrator;
    bytes public arbitratorExtraData; // Extra data to require particular dispute and appeal behaviour.

    /* Constructor */

    /** @dev Constructs the `AppealableArbitrator` contract.
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
    ) public CentralizedArbitrator(_arbitrationPrice) {
        timeOut = _timeOut;
    }

    /* External */

    /** @dev Changes the back up arbitrator.
     *  @param _arbitrator The new back up arbitrator.
     */
    function changeArbitrator(IArbitrator _arbitrator) external onlyOwner {
        arbitrator = _arbitrator;
    }

    /** @dev Changes the time out.
     *  @param _timeOut The new time out.
     */
    function changeTimeOut(uint _timeOut) external onlyOwner {
        timeOut = _timeOut;
    }

    /* External Views */

    /** @dev Gets the specified dispute's latest appeal ID.
     *  @param _disputeID The ID of the dispute.
     */
    function getAppealDisputeID(uint _disputeID) external view returns(uint disputeID) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0)))
            disputeID = AppealableArbitrator(address(appealDisputes[_disputeID].arbitrator)).getAppealDisputeID(appealDisputes[_disputeID].appealDisputeID);
        else disputeID = _disputeID;
    }

    /* Public */

    /** @dev Appeals a ruling.
     *  @param _disputeID The ID of the dispute.
     *  @param _extraData Additional info about the appeal.
     */
    function appeal(uint _disputeID, bytes memory _extraData) public payable requireAppealFee(_disputeID, _extraData) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0)))
            appealDisputes[_disputeID].arbitrator.appeal.value(msg.value)(appealDisputes[_disputeID].appealDisputeID, _extraData);
        else {
            appealDisputes[_disputeID].arbitrator = arbitrator;
            appealDisputes[_disputeID].appealDisputeID = arbitrator.createDispute.value(msg.value)(disputes[_disputeID].choices, _extraData);
            appealDisputeIDsToDisputeIDs[appealDisputes[_disputeID].appealDisputeID] = _disputeID;
        }
    }

    /** @dev Gives a ruling.
     *  @param _disputeID The ID of the dispute.
     *  @param _ruling The ruling.
     */
    function giveRuling(uint _disputeID, uint _ruling) public {
        require(disputes[_disputeID].status != DisputeStatus.Solved, "The specified dispute is already resolved.");
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0))) {
            require(IArbitrator(msg.sender) == appealDisputes[_disputeID].arbitrator, "Appealed disputes must be ruled by their back up arbitrator.");
            super._giveRuling(_disputeID, _ruling);
        } else {
            require(msg.sender == owner, "Not appealed disputes must be ruled by the owner.");
            if (disputes[_disputeID].status == DisputeStatus.Appealable) {
                if (now - appealDisputes[_disputeID].rulingTime > timeOut)
                    super._giveRuling(_disputeID, disputes[_disputeID].ruling);
                else revert("Time out time has not passed yet.");
            } else {
                disputes[_disputeID].ruling = _ruling;
                disputes[_disputeID].status = DisputeStatus.Appealable;
                appealDisputes[_disputeID].rulingTime = now;
                emit AppealPossible(_disputeID, disputes[_disputeID].arbitrated);
            }
        }
    }

    /** @dev Give a ruling for a dispute. Must be called by the arbitrator.
     *  The purpose of this function is to ensure that the address calling it has the right to rule on the contract.
     *  @param _disputeID ID of the dispute in the IArbitrator contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function rule(uint _disputeID, uint _ruling) public onlyArbitrator {
        emit Ruling(IArbitrator(msg.sender),_disputeID,_ruling);

        executeRuling(_disputeID,_ruling);
    }

    /* Public Views */

    /** @dev Gets the cost of appeal for the specified dispute.
     *  @param _disputeID The ID of the dispute.
     *  @param _extraData Additional info about the appeal.
     *  @return The cost of the appeal.
     */
    function appealCost(uint _disputeID, bytes memory _extraData) public view returns(uint cost) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0)))
            cost = appealDisputes[_disputeID].arbitrator.appealCost(appealDisputes[_disputeID].appealDisputeID, _extraData);
        else if (disputes[_disputeID].status == DisputeStatus.Appealable) cost = arbitrator.arbitrationCost(_extraData);
        else cost = NOT_PAYABLE_VALUE;
    }

    /** @dev Gets the status of the specified dispute.
     *  @param _disputeID The ID of the dispute.
     *  @return The status.
     */
    function disputeStatus(uint _disputeID) public view returns(DisputeStatus status) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0)))
            status = appealDisputes[_disputeID].arbitrator.disputeStatus(appealDisputes[_disputeID].appealDisputeID);
        else status = disputes[_disputeID].status;
    }

    /** @dev Return the ruling of a dispute.
     *  @param _disputeID ID of the dispute to rule.
     *  @return ruling The ruling which would or has been given.
     */
    function currentRuling(uint _disputeID) public view returns(uint ruling) {
        if (appealDisputes[_disputeID].arbitrator != IArbitrator(address(0))) // Appealed.
            ruling = appealDisputes[_disputeID].arbitrator.currentRuling(appealDisputes[_disputeID].appealDisputeID); // Retrieve ruling from the arbitrator whom the dispute is appealed to.
        else ruling = disputes[_disputeID].ruling; //  Not appealed, basic case.
    }

    /* Internal */

    /** @dev Executes the ruling of the specified dispute.
     *  @param _disputeID The ID of the dispute.
     *  @param _ruling The ruling.
     */
    function executeRuling(uint _disputeID, uint _ruling) internal {
        require(
            appealDisputes[appealDisputeIDsToDisputeIDs[_disputeID]].arbitrator != IArbitrator(address(0)),
            "The dispute must have been appealed."
        );
        giveRuling(appealDisputeIDsToDisputeIDs[_disputeID], _ruling);
    }
}