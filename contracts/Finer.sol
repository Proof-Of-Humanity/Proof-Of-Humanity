/**
 *  @authors: [@unknownunknown1]
 *  @reviewers: [@mtsalenc*, @nix1g*, @hbarcelos*, @ferittuncer]
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */

pragma solidity ^0.5.17;

import "@kleros/erc-792/contracts/IArbitrator.sol";

/**
 *  @title Finer
 *  The contract that allows to pay the fines for vouching for bad submissions in the ProofOfHumanity smart contract.
 *  The fines should be paid to the challenger that exposed the bad submission of a particular request.
 *  Note that the paid addresses and related amounts are not stored because the fine is not tied to the blockchain addresses but to the actual people.
 *  The fact of funding as well as the required amount will be established and recorded off-chain.
 */
contract Finer {

    uint public constant CHALLENGER_WON = 2;
    IArbitrator public arbitrator; // The arbitrator contract.

    /**
     *  @dev Emitted when a fine is paid.
     *  @param _challenger The address of the challenger to pay the fines to.
     *  @param _voucher The address of the penalized voucher that pays the fine.
     *  @param _disputeID The ID of the related dispute that was ruled in favor of the challenger.
     *  @param _value The amount paid.
     */
    event FinePaid(address indexed _challenger, address indexed _voucher, uint indexed _disputeID, uint _value);

    constructor(IArbitrator _arbitrator) public {
        arbitrator = _arbitrator;
    }

    /** @dev Pays the fine and sends it to a particular address. Emits an event.
     *  @param _challenger The address to pay the fine to.
     *  @param _disputeID ID of the dispute in the arbitrator contract that the challenger won.
     */
    function payFine(address payable _challenger, uint _disputeID) external payable {
        require(arbitrator.disputeStatus(_disputeID) == IArbitrator.DisputeStatus.Solved, "Dispute is not over yet");
        require(arbitrator.currentRuling(_disputeID) == CHALLENGER_WON, "No fine for this dispute");
        _challenger.send(msg.value); // Deliberate use of 'send' to avoid blocking the call.
        emit FinePaid(_challenger, msg.sender, _disputeID, msg.value);
    }
}
