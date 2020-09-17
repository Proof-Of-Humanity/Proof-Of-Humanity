/**
 *  @authors: [@unknownunknown1]
 *  @reviewers: [@ferittuncer, @fnanni-0]
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 *  @tools: [MythX]
 */

pragma solidity ^0.5.13;

/* solium-disable max-len*/
/* solium-disable error-reason */
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";
import "@kleros/ethereum-libraries/contracts/CappedMath.sol";

/**
 *  @title ProofOfHumanity
 *  This contract is a curated registry for people. The users are identified by their address and can be added or removed through the request-challenge protocol.
 *  In order to challenge a registration request the challenger must provide one of the four reasons.
 *  New requests firstly should gain sufficient amount of vouches from other registered users and only after that they can be accepted or challenged.
 *  The users who vouched for submission that lost the challenge with the reason Duplicate or DoesNotExist would be penalized with optional fine or ban period.
 *  NOTE: This contract trusts that the Arbitrator is honest and will not reenter or modify its costs during a call.
 *  The arbitrator must support appeal period.
 */
contract ProofOfHumanity is IArbitrable, IEvidence {
    using CappedMath for uint;

    /* Enums */

    enum Status {
        None, // The submission doesn't have a pending status.
        Vouching, // The submission is in the state where it can be vouched for and crowdfunded.
        PendingRegistration, // The submission is in the state where it can be challenged. Or accepted to the list, if there are no challenges within the time limit.
        PendingRemoval // The submission is in the state where it can be challenged. Or removed from the list, if there are no challenges within the time limit.
    }

    enum Party {
        None, // Party per default when there is no challenger or requester. Also used for unconclusive ruling.
        Requester, // Party that made the request to change a status.
        Challenger // Party that challenged the request to change a status.
    }

    enum Reason {
        None, // No reason specified. This option should be used to challenge removal requests.
        IncorrectSubmission, // The submission does not comply with the submission rules.
        Deceased, // The submitter has existed but does not exist anymore.
        Duplicate, // The submitter is already registered. The challenger has to point to the identity already registered or to a duplicate submission.
        DoesNotExist // The submitter is not real. For example, this can be used for videos showing computer generated persons.
    }

    /* Structs */

    struct Submission {
        Status status; // The current status of the submission.
        bool registered; // Whether the submission is in the registry or not.
        uint index; // Submissions are ordered by index in submissionList.
        uint submissionTime; // The time when the submission was accepted to the list.
        uint renewalTimestamp; // The time after which it becomes possible to reapply the submission.
        Request[] requests; // List of status change requests made for the submission.
    }

    struct Request {
        bool disputed; // True if a dispute was raised. Note that the request can enter disputed state multiple times, once per reason.
        bool resolved; // True if the request is executed and/or all raised disputes are resolved.
        address payable requester; // Address that made a request. It matches submissionID in case of registration requests.
        uint[] disputeIDs; // Stores the IDs of all disputes that were raised during challenge period. disputeIDs[challengeID].
        uint lastStatusChange; // Time when submission's status was last updated. Is used to track when the challenge period ends.
        Round[][] rounds; // Tracks each round of each dispute that was raised during the challenge period. rounds[challengeID][roundID].
        mapping(uint => uint) rulings; // Maps a dispute index with a ruling given to it. rulings[challengeID].
        IArbitrator arbitrator; // The arbitrator trusted to solve disputes for this request.
        bytes arbitratorExtraData; // The extra data for the trusted arbitrator of this request.
        uint metaEvidenceID; // The meta evidence to be used in a dispute for this case.
        address[] vouches; // Stores the addresses of all submissions that vouched for this request.
        uint nbParallelDisputes; // Tracks the number of simultaneously raised disputes. Parallel disputes are only allowed for reason Duplicate.
        Reason[] usedReasons; // Stores all reasons, that were used to challenge a registration request, to make sure that each reason was only used once.
        Reason currentReason; // Current reason a registration request was challenged with. Is left empty for removal requests.
        bool requesterLost; // True if the requester has already had a dispute that wasn't ruled in his favor.
        address payable ultimateChallenger; // Address of the challenger who won a dispute and who users, that vouched for the request, must pay the fines to.
        uint penaltyIndex; // Stores the index of the last processed vouch in the array of vouches. Is used for partial processing of the vouches in resolved submissions.
        uint currentDuplicateIndex; // Stores the array index of the duplicate submission provided by the challenger who is currently winning.
    }

    // Some arrays below have 3 elements to map with the Party enums for better readability:
    // - 0: is unused, matches `Party.None`.
    // - 1: for `Party.Requester`.
    // - 2: for `Party.Challenger`.
    struct Round {
        uint[3] paidFees; // Tracks the fees paid by each side in this round.
        bool[3] hasPaid; // True when the side has fully paid its fee. False otherwise.
        uint feeRewards; // Sum of reimbursable fees and stake rewards available to the parties that made contributions to the side that ultimately wins a dispute.
        mapping(address => uint[3]) contributions; // Maps contributors to their contributions for each side.
    }

    // The requests in this contract can have multiple disputes. Each dispute, created for the request, will be identified by challengeID.
    struct Challenge {
        uint challengeID; // The ID that indicates the index of a dispute in disputeIDs array of a request, that was created when the request was challenged.
        address payable challenger; // Address that challenged the request.
        address challengedSubmission; // The submission, which ongoing request was challenged.
        uint duplicateSubmissionIndex; // Index of a submission in the array of submissions, which is a supposed duplicate of a challenged submission. Is only used for reason Duplicate.
    }

    /* Storage */

    IArbitrator public arbitrator; // The arbitrator contract.
    bytes public arbitratorExtraData; // Extra data to require particular dispute and appeal behaviour.

    uint RULING_OPTIONS = 2; // The amount of non 0 choices the arbitrator can give.

    address public governor; // The address that can make governance changes to the parameters of the contract.
    uint public submissionBaseDeposit; // The base deposit to make a new request for a submission.
    uint public submissionChallengeBaseDeposit; // The base deposit to challenge a request.
    uint public submissionDuration; // Time after which the registered submission will no longer be considered registered. The submitter has to reapply to the list to refresh it.
    uint public renewalTime; // Denotes the point in time of the submission period after which it becomes possible for the submission to reapply (to refresh the duration of the submission period).
    uint public challengePeriodDuration; // The time after which a request becomes executable if not challenged. Note that this value should be less than the time spent on potential dispute's resolution, to avoid complications of parallel dispute handling.
    uint public requiredNumberOfVouches; // The number of registered users that have to vouch for a new registration request in order for it to enter PendingRegistration state.
    uint public metaEvidenceUpdates; // The number of times the meta evidence has been updated. Used to track the latest meta evidence ID.

    uint public sharedStakeMultiplier; // Multiplier for calculating the fee stake that must be paid in the case where arbitrator refused to arbitrate.
    uint public winnerStakeMultiplier; // Multiplier for calculating the fee stake paid by the party that won the previous round.
    uint public loserStakeMultiplier; // Multiplier for calculating the fee stake paid by the party that lost the previous round.
    uint public constant MULTIPLIER_DIVISOR = 10000; // Divisor parameter for multipliers.

    uint public constant NB_REASONS = 4; // Total number of reasons that can be used to challenge a submission.

    address[] public submissionList; // List of IDs of all submissions.
    mapping(address => Submission) public submissions; // Maps the submission ID to its data. submissions[submissionID].

    mapping(address => mapping(address => bool)) public vouches; // Indicates whether or not the voucher has vouched for a certain submission. vouches[voucherID][submissionID].
    mapping(address => bool) public usedVouch; // Indicates whether or not the voucher has vouched for a submission that entered PendingRegistration state. usedVouch[voucherID].

    mapping(address => mapping(uint => Challenge)) public arbitratorDisputeIDToChallenge; // Maps a dispute ID with the data of the challenger who created a dispute. arbitratorDisputeIDToChallenge[arbitrator][disputeID].

     /* Modifiers */

    modifier onlyByGovernor() {require(governor == msg.sender, "The caller must be the governor."); _;}

    /* Events */
    event ArbitratorComplete(IArbitrator arbitrator, address indexed governor, uint submissionBaseDeposit, uint submissionChallengeBaseDeposit, uint submissionDuration, uint challengePeriodDuration, uint requiredNumberOfVouches, uint sharedStakeMultiplier, uint winnerStakeMultiplier, uint loserStakeMultiplier);

    /** @dev Constructor.
     *  @param _arbitrator The trusted arbitrator to resolve potential disputes.
     *  @param _arbitratorExtraData Extra data for the trusted arbitrator contract.
     *  @param _registrationMetaEvidence The URI of the meta evidence object for registration requests.
     *  @param _clearingMetaEvidence The URI of the meta evidence object for clearing requests.
     *  @param _submissionBaseDeposit The base deposit to make a request for a submission.
     *  @param _submissionChallengeBaseDeposit The base deposit to challenge a submission.
     *  @param _submissionDuration Time in seconds during which the registered submission won't automatically lose its status.
     *  @param _renewalTime Value that defines the start of submission's renewal period.
     *  @param _challengePeriodDuration The time in seconds during which the request can be challenged.
     *  @param _requiredNumberOfVouches The number of vouches the submission has to have to pass from Vouching to PendingRegistration state.
     *  @param _sharedStakeMultiplier Multiplier of the arbitration cost that each party has to pay as fee stake for a round when there is no winner/loser in the previous round (e.g. when it's the first round or the arbitrator refused to arbitrate). In basis points.
     *  @param _winnerStakeMultiplier Multiplier of the arbitration cost that the winner has to pay as fee stake for a round in basis points.
     *  @param _loserStakeMultiplier Multiplier of the arbitration cost that the loser has to pay as fee stake for a round in basis points.
     */
    constructor(
        IArbitrator _arbitrator,
        bytes memory _arbitratorExtraData,
        string memory _registrationMetaEvidence,
        string memory _clearingMetaEvidence,
        uint _submissionBaseDeposit,
        uint _submissionChallengeBaseDeposit,
        uint _submissionDuration,
        uint _renewalTime,
        uint _challengePeriodDuration,
        uint _requiredNumberOfVouches,
        uint _sharedStakeMultiplier,
        uint _winnerStakeMultiplier,
        uint _loserStakeMultiplier
    ) public {
        emit MetaEvidence(0, _registrationMetaEvidence);
        emit MetaEvidence(1, _clearingMetaEvidence);

        arbitrator = _arbitrator;
        arbitratorExtraData = _arbitratorExtraData;
        governor = msg.sender;
        submissionBaseDeposit = _submissionBaseDeposit;
        submissionChallengeBaseDeposit = _submissionChallengeBaseDeposit;
        submissionDuration = _submissionDuration;
        renewalTime = _renewalTime;
        challengePeriodDuration = _challengePeriodDuration;
        requiredNumberOfVouches = _requiredNumberOfVouches;
        sharedStakeMultiplier = _sharedStakeMultiplier;
        winnerStakeMultiplier = _winnerStakeMultiplier;
        loserStakeMultiplier = _loserStakeMultiplier;

        emit ArbitratorComplete(arbitrator, governor, submissionBaseDeposit, submissionChallengeBaseDeposit, submissionDuration, challengePeriodDuration, requiredNumberOfVouches, sharedStakeMultiplier, winnerStakeMultiplier, loserStakeMultiplier);
    }

    /* External and Public */

    // ************************ //
    // *      Governance      * //
    // ************************ //

    /** @dev Allows the governor to directly add a new submission to the list as a part of the seeding event.
     *  @param _submissionID The address of a newly added submission.
     *  @param _evidence A link to evidence using its URI.
     */
    function addSubmissionManually(address _submissionID, string calldata _evidence) external onlyByGovernor {
        Submission storage submission = submissions[_submissionID];
        require(submission.requests.length == 0, "Submission already exists");
        submissionList.push(_submissionID);
        submission.index = submissionList.length - 1;

        Request storage request = submission.requests[submission.requests.length++];
        submission.registered = true;
        submission.submissionTime = now;
        submission.renewalTimestamp = now.addCap(submissionDuration.subCap(renewalTime));
        request.resolved = true;

        if (bytes(_evidence).length > 0)
            emit Evidence(request.arbitrator, uint(keccak256(abi.encodePacked(_submissionID, 0))), msg.sender, _evidence);
    }

    /** @dev Allows the governor to directly remove a registered entry from the list as a part of the seeding event.
     *  @param _submissionID The address of a submission to remove.
     */
    function removeSubmissionManually(address _submissionID) external onlyByGovernor {
        Submission storage submission = submissions[_submissionID];
        require(submission.registered && submission.status == Status.None, "Submission not found");
        submission.registered = false;
    }

    /** @dev Change the base amount required as a deposit to make a request for a submission.
     *  @param _submissionBaseDeposit The new base amount of wei required to make a new request.
     */
    function changeSubmissionBaseDeposit(uint _submissionBaseDeposit) external onlyByGovernor {
        submissionBaseDeposit = _submissionBaseDeposit;
    }

    /** @dev Change the base amount required as a deposit to challenge a submission.
     *  @param _submissionChallengeBaseDeposit The new base amount of wei required to challenge a submission.
     */
    function changeSubmissionChallengeBaseDeposit(uint _submissionChallengeBaseDeposit) external onlyByGovernor {
        submissionChallengeBaseDeposit = _submissionChallengeBaseDeposit;
    }

    /** @dev Change the time after which the registered status of a submission expires.
     *  @param _submissionDuration The new duration of the time the submission is considered registered.
     */
    function changeSubmissionDuration(uint _submissionDuration) external onlyByGovernor {
        submissionDuration = _submissionDuration;
    }

    /** @dev Change the time after which reapplication becomes possible.
     *  @param _renewalTime The new value that defines the start of submission's renewal period.
     */
    function changeRenewalTime(uint _renewalTime) external onlyByGovernor {
        renewalTime = _renewalTime;
    }

    /** @dev Change the duration of the challenge period.
     *  @param _challengePeriodDuration The new duration of the challenge period.
     */
    function changeChallengePeriodDuration(uint _challengePeriodDuration) external onlyByGovernor {
        challengePeriodDuration = _challengePeriodDuration;
    }

    /** @dev Change the number of vouches required for the request to pass to the pending state.
     *  @param _requiredNumberOfVouches The new required number of vouches.
     */
    function changeRequiredNumberOfVouches(uint _requiredNumberOfVouches) external onlyByGovernor {
        requiredNumberOfVouches = _requiredNumberOfVouches;
    }

    /** @dev Change the proportion of arbitration fees that must be paid as fee stake by parties when there is no winner or loser.
     *  @param _sharedStakeMultiplier Multiplier of arbitration fees that must be paid as fee stake. In basis points.
     */
    function changeSharedStakeMultiplier(uint _sharedStakeMultiplier) external onlyByGovernor {
        sharedStakeMultiplier = _sharedStakeMultiplier;
    }

    /** @dev Change the proportion of arbitration fees that must be paid as fee stake by the winner of the previous round.
     *  @param _winnerStakeMultiplier Multiplier of arbitration fees that must be paid as fee stake. In basis points.
     */
    function changeWinnerStakeMultiplier(uint _winnerStakeMultiplier) external onlyByGovernor {
        winnerStakeMultiplier = _winnerStakeMultiplier;
    }

    /** @dev Change the proportion of arbitration fees that must be paid as fee stake by the party that lost the previous round.
     *  @param _loserStakeMultiplier Multiplier of arbitration fees that must be paid as fee stake. In basis points.
     */
    function changeLoserStakeMultiplier(uint _loserStakeMultiplier) external onlyByGovernor {
        loserStakeMultiplier = _loserStakeMultiplier;
    }

    /** @dev Change the governor of the contract.
     *  @param _governor The address of the new governor.
     */
    function changeGovernor(address _governor) external onlyByGovernor {
        governor = _governor;
    }

    /** @dev Update the meta evidence used for disputes.
     *  @param _registrationMetaEvidence The meta evidence to be used for future registration request disputes.
     *  @param _clearingMetaEvidence The meta evidence to be used for future clearing request disputes.
     */
    function changeMetaEvidence(string calldata _registrationMetaEvidence, string calldata _clearingMetaEvidence) external onlyByGovernor {
        metaEvidenceUpdates++;
        emit MetaEvidence(2 * metaEvidenceUpdates, _registrationMetaEvidence);
        emit MetaEvidence(2 * metaEvidenceUpdates + 1, _clearingMetaEvidence);
    }

    /** @dev Change the arbitrator to be used for disputes that may be raised in the next requests. The arbitrator is trusted to support appeal periods and not reenter.
     *  @param _arbitrator The new trusted arbitrator to be used in the next requests.
     *  @param _arbitratorExtraData The extra data used by the new arbitrator.
     */
    function changeArbitrator(IArbitrator _arbitrator, bytes calldata _arbitratorExtraData) external onlyByGovernor {
        arbitrator = _arbitrator;
        arbitratorExtraData = _arbitratorExtraData;
    }

    // ************************ //
    // *       Requests       * //
    // ************************ //

    /** @dev Make a request to add a new entry to the list. Paying the full deposit right away is not required as it can be crowdfunded later.
     *  @param _evidence A link to evidence using its URI.
     */
    function addSubmission(string calldata _evidence) external payable {
        Submission storage submission = submissions[msg.sender];
        require(!submission.registered && submission.status == Status.None, "You are already registered/registering");
        if (submission.requests.length == 0) {
            submissionList.push(msg.sender);
            submission.index = submissionList.length - 1;
        }
        submission.status = Status.Vouching;
        requestStatusChange(msg.sender, _evidence);
    }

    /** @dev Make a request to refresh a submissionDuration. Paying the full deposit right away is not required as it can be crowdfunded later.
     *  Note that the user can reapply even when current submissionDuration has not expired, but only after the start of renewal period.
     *  @param _evidence A link to evidence using its URI.
     */
    function reapplySubmission(string calldata _evidence) external payable {
        Submission storage submission = submissions[msg.sender];
        require(submission.registered && submission.status == Status.None, "Not registered or Invalid status");
        require(now >= submission.renewalTimestamp, "Renewal period hasn't started");
        submission.status = Status.Vouching;
        requestStatusChange(msg.sender, _evidence);
    }

    /** @dev Make a request to remove a submission from the list. Requires full deposit. Accepts enough ETH to cover the deposit, reimburses the rest.
     *  @param _submissionID The address of the submission to remove.
     *  @param _evidence A link to evidence using its URI.
     */
    function removeSubmission(address _submissionID, string calldata _evidence) external payable {
        Submission storage submission = submissions[_submissionID];
        require(submission.registered && submission.status == Status.None, "Not registered or Invalid status");
        require(now < submission.renewalTimestamp || now - submission.submissionTime > submissionDuration, "Invalid period: renewal");
        submission.status = Status.PendingRemoval;
        requestStatusChange(_submissionID, _evidence);
    }

    /** @dev Fund the requester's deposit. Accepts enough ETH to cover the deposit, reimburses the rest.
     *  @param _submissionID The address of the submission which ongoing request to fund.
     */
    function fundSubmission(address _submissionID) external payable {
        Submission storage submission = submissions[_submissionID];
        require(submission.status == Status.Vouching, "Status must be Vouching");
        Request storage request = submission.requests[submission.requests.length - 1];
        Round storage round = request.rounds[0][0];
        require(!round.hasPaid[uint(Party.Requester)], "Submission fee is fully paid");

        uint arbitrationCost = request.arbitrator.arbitrationCost(request.arbitratorExtraData);
        uint totalCost = arbitrationCost.addCap((arbitrationCost.mulCap(sharedStakeMultiplier)) / MULTIPLIER_DIVISOR).addCap(submissionBaseDeposit);
        contribute(round, Party.Requester, msg.sender, msg.value, totalCost);

        if (round.paidFees[uint(Party.Requester)] >= totalCost)
            round.hasPaid[uint(Party.Requester)] = true;
    }

    /** @dev Vouch for the submission.
     *  @param _submissionID The address of the submission to vouch for.
     */
    function addVouch(address _submissionID) external {
        Submission storage submission = submissions[_submissionID];
        require(submission.status == Status.Vouching, "Status must be Vouching");
        require(_submissionID != msg.sender, "Cannot vouch for yourself");
        vouches[msg.sender][_submissionID] = true;
    }

    /** @dev Remove the submission's vouch that has been added earlier.
     *  @param _submissionID The address of the submission to remove vouch from.
     */
    function removeVouch(address _submissionID) external {
        Submission storage submission = submissions[_submissionID];
        require(submission.status == Status.Vouching, "Status must be Vouching");
        vouches[msg.sender][_submissionID] = false;
    }

    /** @dev Allows to withdraw a mistakenly added submission while it's still in a vouching state.
     */
    function withdrawSubmission() external {
        Submission storage submission = submissions[msg.sender];
        require(submission.status == Status.Vouching, "Status must be Vouching");
        Request storage request = submission.requests[submission.requests.length - 1];

        submission.status = Status.None;
        request.resolved = true;

        withdrawFeesAndRewards(msg.sender, msg.sender, submission.requests.length - 1, 0, 0); // Automatically withdraw for the requester.
    }

    /** @dev Change submission's state from Vouching to PendingRegistration if all conditions are met.
     *  @param _submissionID The address of the submission which status to change.
     *  @param _vouches Array of users which vouches to count.
     */
    function changeStateToPending(address _submissionID, address[] calldata _vouches) external {
        Submission storage submission = submissions[_submissionID];
        require(submission.status == Status.Vouching, "Status must be Vouching");
        Request storage request = submission.requests[submission.requests.length - 1];
        Round storage round = request.rounds[0][0];
        require(round.hasPaid[uint(Party.Requester)], "Requester didn't pay his fees");

        for (uint i = 0; i < _vouches.length && request.vouches.length < requiredNumberOfVouches; i++) {
            // Check that the vouch isn't currently used by another submission and the voucher has a right to vouch.
            if (!usedVouch[_vouches[i]] && submissions[_vouches[i]].registered && now - submissions[_vouches[i]].submissionTime <= submissionDuration &&
            vouches[_vouches[i]][_submissionID] == true) {
                request.vouches.push(_vouches[i]);
                usedVouch[_vouches[i]] = true;
            }
        }
        require(request.vouches.length >= requiredNumberOfVouches, "Not enough valid vouches");
        submission.status = Status.PendingRegistration;
        request.lastStatusChange = now;
    }

    /** @dev Challenge the submission's request. Accepts enough ETH to cover the deposit, reimburses the rest.
     *  @param _submissionID The address of the submission which request to challenge.
     *  @param _reason The reason to challenge the request. Left empty for removal requests.
     *  @param _duplicateID The address of a supposed duplicate submission. Left empty if the reason is not Duplicate.
     *  @param _evidence A link to evidence using its URI. Ignored if not provided.
     */
    function challengeRequest(address _submissionID, Reason _reason, address _duplicateID, string calldata _evidence) external payable {
        Submission storage submission = submissions[_submissionID];
        if (submission.status == Status.PendingRegistration)
            require(_reason != Reason.None, "Challenge reason is expected");
        else if (submission.status == Status.PendingRemoval)
            require(_reason == Reason.None, "Challenge reason must be empty");
        else
            revert("Invalid submission status");

        Request storage request = submission.requests[submission.requests.length - 1];
        require(now - request.lastStatusChange <= challengePeriodDuration, "Not in challenge period");

        if (_reason == Reason.Duplicate) {
            require(submissions[_duplicateID].status > Status.None || submissions[_duplicateID].registered, "Alleged duplicate not valid");
            require(_submissionID != _duplicateID, "Can't be a duplicate of itself");
            require(request.currentReason == _reason || request.currentReason == Reason.None, "Another challenge is active");
        }
        else {
            require(!request.disputed, "Another challenge is active");
            require(_duplicateID == address(0x0), "DuplicateID must be empty");
        }

        if (request.currentReason != _reason) {
            for (uint i = 0; i < request.usedReasons.length; i++)
                require(request.usedReasons[i] != _reason, "Reason already used");

            request.usedReasons.push(_reason);
            require(request.usedReasons.length <= NB_REASONS, "No more reasons to challenge");
            request.currentReason = _reason;
        }

        Round storage round = request.rounds[request.disputeIDs.length][0];
        uint arbitrationCost = request.arbitrator.arbitrationCost(request.arbitratorExtraData);
        uint totalCost = arbitrationCost.addCap((arbitrationCost.mulCap(sharedStakeMultiplier)) / MULTIPLIER_DIVISOR).addCap(submissionChallengeBaseDeposit);
        contribute(round, Party.Challenger, msg.sender, msg.value, totalCost);
        require(round.paidFees[uint(Party.Challenger)] >= totalCost, "You must fully fund your side");
        round.hasPaid[uint(Party.Challenger)] = true;

        request.disputeIDs.push(request.arbitrator.createDispute.value(arbitrationCost)(RULING_OPTIONS, request.arbitratorExtraData));
        request.disputed = true;
        request.nbParallelDisputes++;

        Challenge storage challenge = arbitratorDisputeIDToChallenge[address(request.arbitrator)][request.disputeIDs[request.disputeIDs.length - 1]];
        // The index of the challenge is equal to the index of a newly created dispute in disputeIDs array.
        challenge.challengeID = request.disputeIDs.length - 1;
        challenge.challenger = msg.sender;
        challenge.challengedSubmission = _submissionID;
        challenge.duplicateSubmissionIndex = submissions[_duplicateID].index;

        request.rounds[request.disputeIDs.length - 1].length++;
        request.rounds[request.rounds.length++].length++;
        round.feeRewards = round.feeRewards.subCap(arbitrationCost);

        emit Dispute(
            request.arbitrator,
            request.disputeIDs[request.disputeIDs.length - 1],
            request.metaEvidenceID,
            uint(keccak256(abi.encodePacked(_submissionID, submission.requests.length - 1)))
        );

        if (bytes(_evidence).length > 0)
            emit Evidence(request.arbitrator, uint(keccak256(abi.encodePacked(_submissionID, submission.requests.length - 1))), msg.sender, _evidence);
    }

    /** @dev Takes up to the total amount required to fund a side of an appeal. Reimburses the rest. Creates an appeal if both sides are fully funded.
     *  @param _submissionID The address of the submission which request to fund.
     *  @param _challengeID The index of a dispute, created for the request.
     *  @param _side The recipient of the contribution.
     */
    function fundAppeal(address _submissionID, uint _challengeID, Party _side) external payable {
        Submission storage submission = submissions[_submissionID];
        require(_side == Party.Requester || _side == Party.Challenger, "Invalid Party");
        require(submission.status == Status.PendingRegistration || submission.status == Status.PendingRemoval, "Submission status invalid");

        Request storage request = submission.requests[submission.requests.length - 1];
        require(request.disputed, "No dispute was raised");
        (uint appealPeriodStart, uint appealPeriodEnd) = request.arbitrator.appealPeriod(request.disputeIDs[_challengeID]);
        require(now >= appealPeriodStart && now < appealPeriodEnd, "Not in appeal period");

        uint multiplier;

        Party winner = Party(request.arbitrator.currentRuling(request.disputeIDs[_challengeID]));
        Party loser;
        if (winner == Party.Requester)
            loser = Party.Challenger;
        else if (winner == Party.Challenger)
            loser = Party.Requester;
        require(_side != loser || (now-appealPeriodStart < (appealPeriodEnd-appealPeriodStart)/2), "Not in loser's appeal period");

        if (_side == winner)
            multiplier = winnerStakeMultiplier;
        else if (_side == loser)
            multiplier = loserStakeMultiplier;
        else
            multiplier = sharedStakeMultiplier;

        Round storage round = request.rounds[_challengeID][request.rounds[_challengeID].length - 1];
        uint appealCost = request.arbitrator.appealCost(request.disputeIDs[_challengeID], request.arbitratorExtraData);
        uint totalCost = appealCost.addCap((appealCost.mulCap(multiplier)) / MULTIPLIER_DIVISOR);
        contribute(round, _side, msg.sender, msg.value, totalCost);

        if (round.paidFees[uint(_side)] >= totalCost)
            round.hasPaid[uint(_side)] = true;

        if (round.hasPaid[uint(Party.Challenger)] && round.hasPaid[uint(Party.Requester)]) {
            request.arbitrator.appeal.value(appealCost)(request.disputeIDs[_challengeID], request.arbitratorExtraData);
            request.rounds[_challengeID].length++;
            round.feeRewards = round.feeRewards.subCap(appealCost);
        }
    }

    /** @dev Execute a request if the challenge period passed and no one challenged the request.
     *  @param _submissionID The address of the submission with the request to execute.
     */
    function executeRequest(address _submissionID) external {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[submission.requests.length - 1];
        require(now - request.lastStatusChange > challengePeriodDuration, "Challenge period must end first");
        require(!request.disputed, "The request is disputed");
        if (submission.status == Status.PendingRegistration) {
            // It is possible for the requester to lose without a dispute if he was penalized for bad vouching while reapplying.
            if (!request.requesterLost) {
                submission.registered = true;
                submission.submissionTime = now;
                submission.renewalTimestamp = now.addCap(submissionDuration.subCap(renewalTime));
            }
        } else if (submission.status == Status.PendingRemoval)
            submission.registered = false;
        else
            revert("Incorrect status");

        submission.status = Status.None;
        request.resolved = true;

        withdrawFeesAndRewards(request.requester, _submissionID, submission.requests.length - 1, 0, 0); // Automatically withdraw for the requester.
    }

    /** @dev Deletes vouches of the resolved request, so vouchings of users who vouched for it can be used in other submissions.
     *  Penalizes users who vouched for bad submissions.
     *  @param _submissionID The address of the submission which vouches to iterate.
     *  @param _requestID The ID of the request which vouches to iterate.
     *  @param _iterations The number of iterations to go through.
     */
    function processVouches(address _submissionID, uint _requestID, uint _iterations) external {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[_requestID];
        require(request.resolved, "The submission must be resolved");

        uint endIndex = _iterations.addCap(request.penaltyIndex) > request.vouches.length ?
            request.vouches.length : request.penaltyIndex + _iterations;
        // If the submission was challenged successfully, because it is duplicated or does not exists, vouchers are unregistered.
        Reason winnerReason = request.usedReasons.length > 0 ? request.usedReasons[request.usedReasons.length - 1] : Reason.None;
        bool applyPenalty = request.ultimateChallenger != address(0x0) && (winnerReason == Reason.Duplicate || winnerReason == Reason.DoesNotExist);

        for (uint i = request.penaltyIndex; i < endIndex; i++) {
            usedVouch[request.vouches[i]] = false;
            if (applyPenalty) {
                Submission storage voucher = submissions[request.vouches[i]];
                // Check the situation when vouching address is in the middle of reapplication process.
                if (voucher.status == Status.Vouching || voucher.status == Status.PendingRegistration)
                    voucher.requests[voucher.requests.length - 1].requesterLost = true;

                voucher.registered = false;
            }
        }
        request.penaltyIndex = endIndex;
    }

    /** @dev Reimburses contributions if no disputes were raised. If a dispute was raised, sends the fee stake rewards and reimbursements proportionally to the contributions made to the winner of a dispute.
     *  @param _beneficiary The address that made contributions to a request.
     *  @param _submissionID The address of the submission with the request from which to withdraw.
     *  @param _request The request from which to withdraw.
     *  @param _challengeID The ID of the challenge from which to withdraw.
     *  @param _round The round from which to withdraw.
     */
    function withdrawFeesAndRewards(address payable _beneficiary, address _submissionID, uint _request, uint _challengeID, uint _round) public {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[_request];
        Round storage round = request.rounds[_challengeID][_round];
        require(request.resolved, "The submission must be resolved");
        require(_beneficiary != address(0x0), "Empty beneficiary address");

        uint reward;
        if (_round != 0 && (!round.hasPaid[uint(Party.Requester)] || !round.hasPaid[uint(Party.Challenger)])) {
            reward = round.contributions[_beneficiary][uint(Party.Requester)] + round.contributions[_beneficiary][uint(Party.Challenger)];
            round.contributions[_beneficiary][uint(Party.Requester)] = 0;
            round.contributions[_beneficiary][uint(Party.Challenger)] = 0;
        } else if (request.rulings[_challengeID] == uint(Party.None)) {
            uint totalFeesInRound = round.paidFees[uint(Party.Challenger)] + round.paidFees[uint(Party.Requester)];
            reward = totalFeesInRound > 0
                ? (round.contributions[_beneficiary][uint(Party.Requester)] + round.contributions[_beneficiary][uint(Party.Requester)]) * round.feeRewards / totalFeesInRound
                : 0;
            
            round.contributions[_beneficiary][uint(Party.Requester)] = 0;
            round.contributions[_beneficiary][uint(Party.Challenger)] = 0;
        } else {
            // Give the winner the reward for rounds he might not have been able to contribute to.
            // Challenger, who ultimately wins, will be able to get the deposit of the requester, even if he didn't participate in the initial dispute.
            // Requester, if wins a dispute, will be able to get the deposit of the challenger of said dispute, even if he ultimately loses a request. This does not apply to the initial dispute, however.
            if (_round == 0 && ((_beneficiary == request.ultimateChallenger && _challengeID == 0) ||
               (_beneficiary == request.requester && _challengeID > 0 && request.rulings[_challengeID] == uint(Party.Requester)))) {
                reward = round.feeRewards;
                round.feeRewards = 0;
            // This condition will prevent claiming a reward, intended for the ultimate challenger.
            } else if (request.ultimateChallenger==address(0x0) || _challengeID!=0 || _round!=0) {
                reward = round.paidFees[request.rulings[_challengeID]] > 0
                    ? (round.contributions[_beneficiary][request.rulings[_challengeID]] * round.feeRewards) / round.paidFees[request.rulings[_challengeID]]
                    : 0;
                round.contributions[_beneficiary][request.rulings[_challengeID]] = 0;
            }
        }
        _beneficiary.send(reward);
    }

    /** @dev Give a ruling for a dispute. Can only be called by the arbitrator. TRUSTED.
     *  Account for the situation where the winner loses a case due to paying less appeal fees than expected.
     *  @param _disputeID ID of the dispute in the arbitrator contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Refused to arbitrate".
     */
    function rule(uint _disputeID, uint _ruling) public {
        Party resultRuling = Party(_ruling);
        Challenge storage challenge = arbitratorDisputeIDToChallenge[msg.sender][_disputeID];
        Submission storage submission = submissions[challenge.challengedSubmission];

        Request storage request = submission.requests[submission.requests.length - 1];
        Round storage round = request.rounds[challenge.challengeID][request.rounds[challenge.challengeID].length - 1];
        require(_ruling <= RULING_OPTIONS);
        require(address(request.arbitrator) == msg.sender);
        require(!request.resolved);

        // The ruling is inverted if the loser paid its fees.
        if (round.hasPaid[uint(Party.Requester)] == true) // If one side paid its fees, the ruling is in its favor. Note that if the other side had also paid, an appeal would have been created.
            resultRuling = Party.Requester;
        else if (round.hasPaid[uint(Party.Challenger)] == true)
            resultRuling = Party.Challenger;

        emit Ruling(IArbitrator(msg.sender), _disputeID, uint(resultRuling));
        executeRuling(_disputeID, uint(resultRuling));
    }

    /** @dev Submit a reference to evidence. EVENT.
     *  @param _submissionID The address of the submission which the evidence is related to.
     *  @param _evidence A link to an evidence using its URI.
     */
    function submitEvidence(address _submissionID, string calldata _evidence) external {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[submission.requests.length - 1];
        require(!request.resolved, "Submission already resolved");

        if (bytes(_evidence).length > 0)
            emit Evidence(request.arbitrator, uint(keccak256(abi.encodePacked(_submissionID, submission.requests.length - 1))), msg.sender, _evidence);
    }

    /* Internal */

    /** @dev Make a request to change submission's status. Paying the full deposit right away is not required for registration requests.
     *  @param _submissionID The address of the submission which status to change.
     *  @param _evidence A link to evidence using its URI.
     */
    function requestStatusChange(address _submissionID, string memory _evidence) internal {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[submission.requests.length++];

        request.requester = msg.sender;
        request.lastStatusChange = now;
        request.arbitrator = arbitrator;
        request.arbitratorExtraData = arbitratorExtraData;

        Round storage round = request.rounds[request.rounds.length++][request.rounds[0].length++];
        uint arbitrationCost = request.arbitrator.arbitrationCost(request.arbitratorExtraData);
        uint totalCost = arbitrationCost.addCap((arbitrationCost.mulCap(sharedStakeMultiplier)) / MULTIPLIER_DIVISOR).addCap(submissionBaseDeposit);
        contribute(round, Party.Requester, msg.sender, msg.value, totalCost);

        if (submission.status == Status.PendingRemoval) {
            require(round.paidFees[uint(Party.Requester)] >= totalCost, "You must fully fund your side");
            request.metaEvidenceID = 2 * metaEvidenceUpdates + 1;
        } else
            request.metaEvidenceID = 2 * metaEvidenceUpdates;

        if (round.paidFees[uint(Party.Requester)] >= totalCost)
            round.hasPaid[uint(Party.Requester)] = true;

        if (bytes(_evidence).length > 0)
            emit Evidence(request.arbitrator, uint(keccak256(abi.encodePacked(_submissionID, 0))), msg.sender, _evidence);
    }

    /** @dev Returns the contribution value and remainder from available ETH and required amount.
     *  @param _available The amount of ETH available for the contribution.
     *  @param _requiredAmount The amount of ETH required for the contribution.
     *  @return taken The amount of ETH taken.
     *  @return remainder The amount of ETH left from the contribution.
     */
    function calculateContribution(uint _available, uint _requiredAmount)
        internal
        pure
        returns(uint taken, uint remainder)
    {
        if (_requiredAmount > _available)
            return (_available, 0);

        remainder = _available - _requiredAmount;
        return (_requiredAmount, remainder);
    }

    /** @dev Make a fee contribution.
     *  @param _round The round to contribute.
     *  @param _side The side for which to contribute.
     *  @param _contributor The contributor.
     *  @param _amount The amount contributed.
     *  @param _totalRequired The total amount required for this side.
     *  @return The amount of fees contributed.
     */
    function contribute(Round storage _round, Party _side, address payable _contributor, uint _amount, uint _totalRequired) internal returns (uint) {
        uint contribution;
        uint remainingETH;
        (contribution, remainingETH) = calculateContribution(_amount, _totalRequired.subCap(_round.paidFees[uint(_side)]));
        _round.contributions[_contributor][uint(_side)] += contribution;
        _round.paidFees[uint(_side)] += contribution;
        _round.feeRewards += contribution;

        _contributor.send(remainingETH);

        return contribution;
    }

    /** @dev Execute the ruling of a dispute.
     *  @param _disputeID ID of the dispute in the Arbitrator contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Refused to arbitrate".
     */
    function executeRuling(uint _disputeID, uint _ruling) internal {
        Challenge storage challenge = arbitratorDisputeIDToChallenge[msg.sender][_disputeID];
        Submission storage submission = submissions[challenge.challengedSubmission];

        Request storage request = submission.requests[submission.requests.length - 1];

        Party winner = Party(_ruling);

        if (submission.status == Status.PendingRemoval) {
            submission.registered = winner == Party.Requester ? false : true;
            submission.status = Status.None;
            request.resolved = true;
        } else if (submission.status == Status.PendingRegistration) {
            // For a registration request there can be many disputes
            if (winner == Party.Requester) {
                if (request.nbParallelDisputes == 1) {
                    // Check whether or not the requester won all of his previous disputes for current reason.
                    if (!request.requesterLost) {
                        if (request.usedReasons.length == NB_REASONS) {
                            // All reasons being used means the request can't be challenged again, so we can update its status.
                            submission.registered = true;
                            submission.status = Status.None;
                            submission.submissionTime = now;
                            submission.renewalTimestamp = now.addCap(submissionDuration.subCap(renewalTime));
                            request.resolved = true;
                        } else {
                            // Refresh the state of the request so it can be challenged again.
                            request.disputed = false;
                            request.lastStatusChange = now;
                            request.currentReason = Reason.None;
                        }
                    } else {
                        submission.status = Status.None;
                        equest.resolved = true;
                    }
                }
            // Challenger won or it’s a tie.
            } else {
                request.requesterLost = true;
                // Update the status of the submission if there is no more disputes left.
                if (request.nbParallelDisputes == 1) {
                    submission.status = Status.None;
                    request.resolved = true;
                }
                // Store the challenger that made the requester lose. Update the challenger if there is a duplicate with lower submission time, which is indicated by submission's array index.
                if (_ruling == uint(Party.Challenger) && (request.ultimateChallenger == address(0x0) || challenge.duplicateSubmissionIndex < request.currentDuplicateIndex)) {
                    request.ultimateChallenger = challenge.challenger;
                    request.currentDuplicateIndex = challenge.duplicateSubmissionIndex;
                }
            }
            if (request.usedReasons.length == NB_REASONS && request.nbParallelDisputes == 1)
                request.resolved = true;
        }

        // Decrease the number of parallel disputes each time the dispute is resolved. Store the rulings of each dispute for correct distribution of rewards.
        request.nbParallelDisputes--;
        request.rulings[challenge.challengeID] = _ruling;
    }

    // ************************ //
    // *       Getters        * //
    // ************************ //

    /** @dev Returns the number of addresses that were submitted. Includes addresses that never made it to the list or were later removed.
     *  @return count The number of submissions in the list.
     */
    function submissionCount() external view returns (uint count) {
        return submissionList.length;
    }

    /** @dev Gets the contributions made by a party for a given round of a given challenge of a request.
     *  @param _submissionID The address of the submission.
     *  @param _request The request to query.
     *  @param _challengeID the challenge to query.
     *  @param _round The round to query.
     *  @param _contributor The address of the contributor.
     *  @return The contributions.
     */
    function getContributions(
        address _submissionID,
        uint _request,
        uint _challengeID,
        uint _round,
        address _contributor
    ) external view returns(uint[3] memory contributions) {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[_request];
        Round storage round = request.rounds[_challengeID][_round];
        contributions = round.contributions[_contributor];
    }

    /** @dev Returns the information of the submission. Includes length of requests array.
     *  @param _submissionID The address of the queried submission.
     *  @return The information of the submission.
     */
    function getSubmissionInfo(address _submissionID)
        external
        view
        returns (
            Status status,
            uint submissionTime,
            uint renewalTimestamp,
            uint numberOfRequests,
            bool registered
        )
    {
        Submission storage submission = submissions[_submissionID];
        return (
            submission.status,
            submission.submissionTime,
            submission.renewalTimestamp,
            submission.requests.length,
            submission.registered
        );
    }

    /** @dev Gets the information of a particular challenge of the request.
     *  @param _submissionID The address of the queried submission.
     *  @param _request The request to query.
     *  @param _challengeID The challenge to query.
     *  @return The information of the challenge.
     */
    function getChallengeInfo(address _submissionID, uint _request, uint _challengeID)
        external
        view
        returns (
            uint numberOfRounds,
            uint disputeID,
            uint ruling
        )
    {
        Request storage request = submissions[_submissionID].requests[_request];
        return (
            request.rounds[_challengeID].length,
            request.disputeIDs[_challengeID],
            request.rulings[_challengeID]
        );
    }

    /** @dev Gets information of a request of a submission.
     *  @param _submissionID The address of the queried submission.
     *  @param _request The request to be queried.
     *  @return The request information.
     */
    function getRequestInfo(address _submissionID, uint _request)
        external
        view
        returns (
            bool disputed,
            uint numberOfChallenges,
            bool resolved,
            address payable requester,
            address payable ultimateChallenger,
            uint numberOfReasons,
            Reason currentReason,
            uint nbParallelDisputes,
            IArbitrator arbitrator,
            bytes memory arbitratorExtraData,
            bool requesterLost
        )
    {
        Request storage request = submissions[_submissionID].requests[_request];
        return (
            request.disputed,
            request.disputeIDs.length,
            request.resolved,
            request.requester,
            request.ultimateChallenger,
            request.usedReasons.length,
            request.currentReason,
            request.nbParallelDisputes,
            request.arbitrator,
            request.arbitratorExtraData,
            request.requesterLost
        );
    }

    /** @dev Gets the number of vouches of a particular request.
     *  @param _submissionID The address of the queried submission.
     *  @param _request The request to query.
     *  @return The current number of vouches.
     */
    function getNumberOfVouches(address _submissionID, uint _request) external view returns (uint) {
        Request storage request = submissions[_submissionID].requests[_request];
        return request.vouches.length;
    }

    /** @dev Gets the information of a round of a request.
     *  @param _submissionID The address of the queried submission.
     *  @param _request The request to query.
     *  @param _challengeID The challenge to query.
     *  @param _round The round to query.
     *  @return The round information.
     */
    function getRoundInfo(address _submissionID, uint _request, uint _challengeID, uint _round)
        external
        view
        returns (
            bool appealed,
            uint[3] memory paidFees,
            bool[3] memory hasPaid,
            uint feeRewards
        )
    {
        Submission storage submission = submissions[_submissionID];
        Request storage request = submission.requests[_request];
        Round storage round = request.rounds[_challengeID][_round];
        appealed = _round != (request.rounds[_challengeID].length - 1);
        return (
            appealed,
            round.paidFees,
            round.hasPaid,
            round.feeRewards
        );
    }
}
