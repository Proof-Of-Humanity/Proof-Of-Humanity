pragma solidity ^0.5.13;
pragma experimental ABIEncoderV2;

import "../ProofOfHumanity.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 *  @title ProofOfHumanityProxy
 *  A proxy contract for ProofOfHumanity to interact with other dapps.
 */
contract ProofOfHumanityProxy is IERC20 {

    struct PoHData {
        address governor;
        uint128 submissionBaseDeposit;
        uint64 submissionDuration;
        uint64 renewalPeriodDuration;
        uint64 challengePeriodDuration;
        uint64 sharedStakeMultiplier;
        uint64 winnerStakeMultiplier;
        uint64 loserStakeMultiplier;
        uint64 submissionCounter;
        uint requiredNumberOfVouches;
    }

    struct RequestData {
        bool disputed;
        bool resolved;
        bool requesterLost;
        ProofOfHumanity.Reason currentReason;
        uint16 nbParallelDisputes;
        uint16 lastChallengeID;
        uint16 arbitratorDataID;
        address payable requester;
        address payable ultimateChallenger;
        uint8 usedReasons;
    }

    struct DisputeData {
        uint96 challengeID; // The ID of the challenge of the request.
        address submissionID; // The submission, which ongoing request was challenged.
    }

    ProofOfHumanity public PoH;
    address public deployer = msg.sender;

    /** @dev Constructor.
     *  @param _PoH The address of the related ProofOfHumanity contract.
     */
    constructor(ProofOfHumanity _PoH) public {
        PoH = _PoH;
    }

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _PoH The address of the new contract.
     */
    function changePoH(ProofOfHumanity _PoH) external {
        require(msg.sender == deployer, "The caller must be the deployer");
        PoH = _PoH;
    }

    // ********************* //
    // *      Getters      * //
    // ********************* //

    /** @dev Returns true if the submission is registered and not expired.
     *  @param _submissionID The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isRegistered(address _submissionID) public view returns (bool) {
        return PoH.isRegistered(_submissionID);
    }

    /** @dev Gets the storage parameters of the related PoH contract.
     *  @return PoH storage data.
     */
    function getPOHStorageData() external view returns (PoHData memory poHData) {
        poHData.governor = PoH.governor();
        poHData.submissionBaseDeposit = PoH.submissionBaseDeposit();
        poHData.submissionDuration = PoH.submissionDuration();
        poHData.renewalPeriodDuration = PoH.renewalPeriodDuration();
        poHData.challengePeriodDuration = PoH.challengePeriodDuration();
        poHData.sharedStakeMultiplier = PoH.sharedStakeMultiplier();
        poHData.winnerStakeMultiplier = PoH.winnerStakeMultiplier();
        poHData.loserStakeMultiplier = PoH.loserStakeMultiplier();
        poHData.submissionCounter = PoH.submissionCounter();
        poHData.requiredNumberOfVouches = PoH.requiredNumberOfVouches();
    }

    /** @dev Gets the element of the arbitratorDataList array.
     *  @param _arbitratorDataID The index of the element.
     *  @return Arbitrator data.
     */
    function getArbitratorData(uint _arbitratorDataID)
        external
        view
        returns (
            IArbitrator arbitrator,
            uint96 metaEvidenceUpdates,
            bytes memory arbitratorExtraData
        )
    {
        return PoH.arbitratorDataList(_arbitratorDataID);
    }

    /** @dev Checks if the voucher has vouched for a certain submission.
     *  @param _voucherID The address of the voucher.
     *  @param _submissionID The address of the submission.
     *  @return Whether vouched or not.
     */
    function checkVouch(address _voucherID, address _submissionID) external view returns (bool) {
        return PoH.vouches(_voucherID, _submissionID);
    }

    /** @dev Gets the data of a particular dispute.
     *  @param _arbitrator The address of the arbitrator where the dispute is created.
     *  @param _disputeID The ID of the dispute.
     *  @return Dispute data.
     */
    function getDisputeData(address _arbitrator, uint _disputeID)
        external
        view
        returns (
            uint96 challengeID,
            address submissionID
        )
    {
        return PoH.arbitratorDisputeIDToDisputeData(_arbitrator, _disputeID);
    }

    /** @dev Gets the number of times the arbitrator data was updated.
     *  @return The number of arbitrator data updates.
     */
    function getArbitratorDataListCount() external view returns (uint) {
        return PoH.getArbitratorDataListCount();
    }

    /** @dev Checks whether the duplicate address has been used in challenging the request or not.
     *  @param _submissionID The address of the submission to check.
     *  @param _requestID The request to check.
     *  @param _duplicateID The duplicate to check.
     *  @return Whether the duplicate has been used.
     */
    function checkRequestDuplicates(address _submissionID, uint _requestID, address _duplicateID) external view returns (bool) {
        return PoH.checkRequestDuplicates(_submissionID, _requestID, _duplicateID);
    }

    /** @dev Gets the contributions made by a party for a given round of a given challenge of a request.
     *  @param _submissionID The address of the submission.
     *  @param _requestID The request to query.
     *  @param _challengeID the challenge to query.
     *  @param _round The round to query.
     *  @param _contributor The address of the contributor.
     *  @return The contributions.
     */
    function getContributions(
        address _submissionID,
        uint _requestID,
        uint _challengeID,
        uint _round,
        address _contributor
    ) external view returns(uint[3] memory contributions) {
        contributions = PoH.getContributions(_submissionID, _requestID, _challengeID, _round, _contributor);
    }

    /** @dev Returns the information of the submission. Includes length of requests array.
     *  @param _submissionID The address of the queried submission.
     *  @return The information of the submission.
     */
    function getSubmissionInfo(address _submissionID)
        external
        view
        returns (
            ProofOfHumanity.Status status,
            uint64 submissionTime,
            uint64 index,
            bool registered,
            bool hasVouched,
            uint numberOfRequests
        )
    {
        (status, submissionTime, index, registered, hasVouched, numberOfRequests) = PoH.getSubmissionInfo(_submissionID);
    }

    /** @dev Gets the information of a particular challenge of the request.
     *  @param _submissionID The address of the queried submission.
     *  @param _requestID The request to query.
     *  @param _challengeID The challenge to query.
     *  @return The information of the challenge.
     */
    function getChallengeInfo(address _submissionID, uint _requestID, uint _challengeID)
        external
        view
        returns (
            uint16 lastRoundID,
            address challenger,
            uint disputeID,
            ProofOfHumanity.Party ruling,
            uint64 duplicateSubmissionIndex
        )
    {
        (lastRoundID, challenger, disputeID, ruling, duplicateSubmissionIndex) = PoH.getChallengeInfo(_submissionID, _requestID, _challengeID);
    }

    /** @dev Gets information of a request of a submission.
     *  @param _submissionID The address of the queried submission.
     *  @param _requestID The request to be queried.
     *  @return The request information.
     */
    function getRequestInfo(address _submissionID, uint _requestID)
        external
        view
        returns (RequestData memory requestData)
    {
        (
            bool disputed,
            bool resolved,
            bool requesterLost,
            ProofOfHumanity.Reason currentReason,
            uint16 nbParallelDisputes,
            uint16 lastChallengeID,
            uint16 arbitratorDataID,
            address payable requester,
            address payable ultimateChallenger,
            uint8 usedReasons
        ) = PoH.getRequestInfo(_submissionID, _requestID);

        requestData = RequestData(
            disputed,
            resolved,
            requesterLost,
            currentReason,
            nbParallelDisputes,
            lastChallengeID,
            arbitratorDataID,
            requester,
            ultimateChallenger,
            usedReasons
        );
    }

    /** @dev Gets the number of vouches of a particular request.
     *  @param _submissionID The address of the queried submission.
     *  @param _requestID The request to query.
     *  @return The current number of vouches.
     */
    function getNumberOfVouches(address _submissionID, uint _requestID) external view returns (uint) {
        return PoH.getNumberOfVouches(_submissionID, _requestID);
    }

    /** @dev Gets the information of a round of a request.
     *  @param _submissionID The address of the queried submission.
     *  @param _requestID The request to query.
     *  @param _challengeID The challenge to query.
     *  @param _round The round to query.
     *  @return The round information.
     */
    function getRoundInfo(address _submissionID, uint _requestID, uint _challengeID, uint _round)
        external
        view
        returns (
            bool appealed,
            uint[3] memory paidFees,
            bool[3] memory hasPaid,
            uint feeRewards
        )
    {
        (appealed, paidFees, hasPaid, feeRewards) = PoH.getRoundInfo(_submissionID, _requestID, _challengeID, _round);
    }

    // ******************** //
    // *      IERC20      * //
    // ******************** //

    function balanceOf(address _account) external view returns (uint256) {
        return isRegistered(_account) ? 1 : 0;
    }

    function totalSupply() external view returns (uint256) {}

    function transfer(address _recipient, uint256 _amount) external returns (bool) { return false; }

    function allowance(address _owner, address _spender) external view returns (uint256) {}

    function approve(address _spender, uint256 _amount) external returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) { return false; }
}