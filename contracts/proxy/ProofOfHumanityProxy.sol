pragma solidity ^0.5.13;

import "../ProofOfHumanity.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 *  @title ProofOfHumanityProxy
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract ProofOfHumanityProxy is IERC20 {

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

    /** @dev Returns true if the submission is registered and not expired.
     *  @param _submissionID The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isRegistered(address _submissionID) public view returns (bool) {
        return PoH.isRegistered(_submissionID);
    }

    // ******************** //
    // *      IERC20      * //
    // ******************** //

    /** @dev Returns the balance of a particular submission of the ProofOfHumanity contract.
     *  Note that this function takes the expiration date into account.
     *  @param _submissionID The address of the submission.
     *  @return The balance of the submission.
     */
    function balanceOf(address _submissionID) external view returns (uint256) {
        return isRegistered(_submissionID) ? 1 : 0;
    }

    /** @dev Returns the count of all submissions that made a registration request at some point, including those that were added manually.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to count only the submissions that are currently registered.
     *  @return The total count of submissions.
     */
    function totalSupply() external view returns (uint256) {
        return PoH.submissionCounter();
    }

    function transfer(address _recipient, uint256 _amount) external returns (bool) { return false; }

    function allowance(address _owner, address _spender) external view returns (uint256) {}

    function approve(address _spender, uint256 _amount) external returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) { return false; }
}