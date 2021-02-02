/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const { BN, expectRevert, time } = require('openzeppelin-test-helpers')
const util = require('util')

const ProofOfHumanity = artifacts.require('ProofOfHumanity')
const Arbitrator = artifacts.require('EnhancedAppealableArbitrator')

// Promisify signTypedData, note that MetaMask defaults to eth_signTypedData_v1 instead of eth_signTypedData_v4.
web3.eth.signTypedData = async function(typedData, from) {
  const send = util.promisify(web3.eth.currentProvider.send)

  const args = {
    jsonrpc: '2.0',
    method: 'eth_signTypedData',
    params: [from, typedData]
  }

  return send(args).then(value => value.result)
}

// Declare typed data.
const voucherTemplate = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }
    ],
    IsHumanVoucher: [
      { name: 'vouchedSubmission', type: 'address' },
      { name: 'voucherExpirationTimestamp', type: 'uint256' }
    ]
  },
  primaryType: 'IsHumanVoucher',
  domain: {
    name: 'Proof of Humanity',
    chainId: null,
    verifyingContract: null
  }
}

contract('ProofOfHumanity', function(accounts) {
  const governor = accounts[0]
  const requester = accounts[1]
  const requester2 = accounts[2]

  const challenger1 = accounts[3]
  const challenger2 = accounts[4]

  const voucher1 = accounts[5]
  const voucher2 = accounts[6]
  const voucher3 = accounts[7]
  const other = accounts[8]

  const MULTIPLIER_DIVISOR = 10000
  const arbitratorExtraData = '0x85'
  const arbitrationCost = 1000
  const submissionBaseDeposit = 5000
  const submissionDuration = 86400
  const challengePeriodDuration = 600
  const renewalPeriodDuration = 6000
  const nbVouches = 2

  const appealTimeOut = 180

  const sharedStakeMultiplier = 5000
  const winnerStakeMultiplier = 2000
  const loserStakeMultiplier = 8000

  const registrationMetaEvidence = 'registrationMetaEvidence.json'
  const clearingMetaEvidence = 'clearingMetaEvidence.json'

  const gasPrice = 8000000

  let arbitrator
  let proofH
  let requesterTotalCost

  beforeEach('initialize the contract', async function() {
    arbitrator = await Arbitrator.new(
      arbitrationCost,
      governor,
      arbitratorExtraData,
      appealTimeOut,
      { from: governor }
    )

    await arbitrator.changeArbitrator(arbitrator.address)
    await arbitrator.createDispute(3, arbitratorExtraData, {
      from: other,
      value: arbitrationCost
    }) // Create a dispute so the index in tests will not be a default value.

    proofH = await ProofOfHumanity.new(
      arbitrator.address,
      arbitratorExtraData,
      registrationMetaEvidence,
      clearingMetaEvidence,
      submissionBaseDeposit,
      submissionDuration,
      renewalPeriodDuration,
      challengePeriodDuration,
      [sharedStakeMultiplier, winnerStakeMultiplier, loserStakeMultiplier],
      nbVouches,
      { from: governor }
    )

    voucherTemplate.domain.chainId = 1 // ganache-cli's EVM uses 1 despite reporting 1337 through web3.eth.getChainId().
    voucherTemplate.domain.verifyingContract = proofH.address

    await proofH.addSubmissionManually(
      [voucher1, voucher2, voucher3],
      ['', '', ''],
      [],
      { from: governor }
    )

    requesterTotalCost = arbitrationCost + submissionBaseDeposit // Total sum: 1000 + 5000 = 6000
  })

  it('Should set the correct values in constructor', async () => {
    assert.equal(await proofH.governor(), governor)
    assert.equal(await proofH.submissionBaseDeposit(), submissionBaseDeposit)
    assert.equal(await proofH.submissionDuration(), submissionDuration)
    assert.equal(await proofH.renewalPeriodDuration(), renewalPeriodDuration)
    assert.equal(
      await proofH.challengePeriodDuration(),
      challengePeriodDuration
    )
    assert.equal(await proofH.sharedStakeMultiplier(), sharedStakeMultiplier)
    assert.equal(await proofH.winnerStakeMultiplier(), winnerStakeMultiplier)
    assert.equal(await proofH.loserStakeMultiplier(), loserStakeMultiplier)
    assert.equal(await proofH.requiredNumberOfVouches(), nbVouches)

    const arbitratorData = await proofH.arbitratorDataList(0)
    assert.equal(arbitratorData[0], arbitrator.address)
    assert.equal(arbitratorData[1], 0)
    assert.equal(arbitratorData[2], arbitratorExtraData)
    assert.equal(await proofH.getArbitratorDataListCount(), 1)
  })

  it('Should set correct values in manually added submissions', async () => {
    const submission1 = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission1[0].toNumber(),
      0,
      'First submission has incorrect status'
    )
    assert.equal(
      submission1[5].toNumber(),
      1,
      'First submission has incorrect number of requests'
    )
    const request1 = await proofH.getRequestInfo(voucher1, 0)
    assert.equal(
      request1[1],
      true,
      'The request of the first submission should be resolved'
    )
    assert.equal(
      request1[6].toNumber(),
      0,
      'The request of the first submission has incorrect arbitrator data ID'
    )
    assert.equal(
      submission1[2].toNumber(),
      0,
      'Incorrect index of the first submission'
    )
    assert.equal(submission1[3], true, 'First submission should be registered')

    // Check the data of the 2nd submission as well.
    let submission2 = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      submission2[0].toNumber(),
      0,
      'Second submission has incorrect status'
    )
    assert.equal(
      submission2[5].toNumber(),
      1,
      'Second submission has incorrect number of requests'
    )
    const request2 = await proofH.getRequestInfo(voucher2, 0)
    assert.equal(
      request2[1],
      true,
      'The request of the second submission should be resolved'
    )
    assert.equal(
      request1[6].toNumber(),
      0,
      'The request of the second submission has incorrect arbitrator data ID'
    )

    assert.equal(
      submission2[2].toNumber(),
      1,
      'Incorrect index of the second submission'
    )
    assert.equal(submission2[3], true, 'Second submission should be registered')

    // There is no point in checking the data of the 3rd submission in detail.
    assert.equal(
      (await proofH.submissionCounter()).toNumber(),
      3,
      'Incorrect submission count after manual registration'
    )

    await proofH.removeSubmissionManually(voucher2, { from: governor })
    submission2 = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      submission2[3],
      false,
      'Second submission should not be registered after manual removal'
    )

    await expectRevert(
      proofH.addSubmissionManually([voucher2], [''], [], {
        from: governor
      }),
      'Submission already been created'
    )
  })

  it('Should set correct values after creating a request to add new submission', async () => {
    // Change metaevidence so arbitrator data ID is not 0
    await proofH.changeMetaEvidence('1', '2', { from: governor })

    const oldBalance = await web3.eth.getBalance(requester)
    const txAddSubmission = await proofH.addSubmission('evidence1', '', {
      from: requester,
      gasPrice: gasPrice,
      value: 1e18
    })
    const txFee = txAddSubmission.receipt.gasUsed * gasPrice

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(submission[0].toNumber(), 1, 'Submission has incorrect status')
    assert.equal(
      submission[5].toNumber(),
      1,
      'Submission has incorrect number of requests'
    )
    assert.equal(
      submission[3],
      false,
      'Submission should not be registered yet'
    )

    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(
      request[6].toNumber(),
      1,
      'Arbitrator data ID was not set up properly'
    )
    assert.equal(
      request[7],
      '0x0000000000000000000000000000000000000000',
      'Requester should be empty for registration requests'
    )

    const arbitratorData = await proofH.arbitratorDataList(1)
    assert.equal(
      arbitratorData[0],
      arbitrator.address,
      'Arbitrator was not set up properly'
    )
    assert.equal(
      arbitratorData[2],
      arbitratorExtraData,
      'Extra data was not set up properly'
    )

    const round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      6000,
      'Requester paidFees has not been registered correctly'
    )
    assert.equal(
      round[2].toNumber(),
      1,
      'Should register that requester paid his fees'
    )
    assert.equal(
      round[3].toNumber(),
      6000,
      'FeeRewards has not been registered correctly'
    )

    const contribution = await proofH.getContributions(
      requester,
      0,
      0,
      0,
      requester
    )
    assert.equal(
      contribution[1].toNumber(),
      6000,
      'Requester contribution has not been registered correctly'
    )

    const newBalance = await web3.eth.getBalance(requester)
    assert(
      new BN(newBalance).eq(
        new BN(oldBalance).sub(new BN(requesterTotalCost).add(new BN(txFee)))
      ),
      'The requester has incorrect balance after making a submission'
    )

    assert.equal(
      txAddSubmission.logs[0].event,
      'AddSubmission',
      'The event AddSubmission has not been created'
    )
    assert.equal(
      txAddSubmission.logs[0].args._submissionID,
      requester,
      'The event has wrong submission ID'
    )
    assert.equal(
      txAddSubmission.logs[0].args._requestID,
      0,
      'The event has wrong request ID'
    )

    assert.equal(
      txAddSubmission.logs[1].event,
      'Evidence',
      'The event Evidence has not been created'
    )
    assert.equal(
      txAddSubmission.logs[1].args._arbitrator,
      arbitrator.address,
      'The event has wrong arbitrator address'
    )
    const evidenceGroupID = parseInt(requester, 16)
    assert.equal(
      txAddSubmission.logs[1].args._evidenceGroupID,
      evidenceGroupID,
      'The event has wrong evidence group ID'
    )
    assert.equal(
      txAddSubmission.logs[1].args._party,
      requester,
      'The event has wrong requester address'
    )
    assert.equal(
      txAddSubmission.logs[1].args._evidence,
      'evidence1',
      'The event has incorrect evidence'
    )

    await expectRevert(
      proofH.addSubmission('', '', { from: requester, value: 1e18 }),
      'Wrong status'
    )

    // Check that manual actions are not possible as well.
    await expectRevert(
      proofH.addSubmissionManually([requester], [''], [], {
        from: governor
      }),
      'Submission already been created'
    )
    await expectRevert(
      proofH.removeSubmissionManually(requester, { from: governor }),
      'Wrong status'
    )
  })

  it('Should correctly fund the new submission', async () => {
    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: 200
    })

    let round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      200,
      'PaidFees has not been registered correctly'
    )
    assert.equal(
      round[2].toNumber(),
      0,
      'Should not register that the requester paid his fees fully'
    )
    assert.equal(
      round[3].toNumber(),
      200,
      'FeeRewards has not been registered correctly'
    )

    let contribution = await proofH.getContributions(
      requester,
      0,
      0,
      0,
      requester
    )
    assert.equal(
      contribution[1].toNumber(),
      200,
      'Requester contribution has not been registered correctly'
    )

    // Let the requester fund the submission once more to see if the sum of both payments is correct.
    await proofH.fundSubmission(requester, { from: requester, value: 300 })

    round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      500,
      'PaidFees has not been registered correctly after the 2nd payment of the requester'
    )
    assert.equal(
      round[2].toNumber(),
      0,
      'Should not register that requester paid his fees fully after the 2nd payment of the requester'
    )
    assert.equal(
      round[3].toNumber(),
      500,
      'FeeRewards has not been registered correctly after the 2nd payment of the requester'
    )

    contribution = await proofH.getContributions(requester, 0, 0, 0, requester)
    assert.equal(
      contribution[1].toNumber(),
      500,
      'Requester contribution has not been registered correctly after the 2nd payment of the requester'
    )

    // Check that the payment of the first crowdfunder has been registered correctly.
    await proofH.fundSubmission(requester, { from: voucher1, value: 5000 })

    round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      5500,
      'PaidFees has not been registered correctly after the first crowdfunder'
    )
    assert.equal(
      round[2].toNumber(),
      0,
      'Should not register that the requester paid his fees fully after the first crowdfunder'
    )
    assert.equal(
      round[3].toNumber(),
      5500,
      'FeeRewards has not been registered correctly after the first crowdfunder'
    )

    contribution = await proofH.getContributions(requester, 0, 0, 0, voucher1)
    assert.equal(
      contribution[1].toNumber(),
      5000,
      'First crowdfunder contribution has not been registered correctly'
    )

    // Check the second crowdfunder.
    await proofH.fundSubmission(requester, { from: other, value: 1e18 })

    round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      requesterTotalCost,
      'PaidFees has not been registered correctly after the second crowdfunder'
    )
    assert.equal(
      round[2].toNumber(),
      1,
      'Should register that the requester paid his fees fully after the second crowdfunder'
    )
    assert.equal(
      round[3].toNumber(),
      requesterTotalCost,
      'FeeRewards has not been registered correctly after the second crowdfunder'
    )

    contribution = await proofH.getContributions(requester, 0, 0, 0, other)
    assert.equal(
      contribution[1].toNumber(),
      500,
      'Second crowdfunder contribution has not been registered correctly'
    )

    // Check that already registered or absent submission can't be funded.
    await expectRevert(
      proofH.fundSubmission(voucher1, { from: voucher1 }),
      'Wrong status'
    )
    await expectRevert(
      proofH.fundSubmission(other, { from: other }),
      'Wrong status'
    )
  })

  it('Should set correct values after creating a request to remove a submission', async () => {
    await expectRevert(
      proofH.removeSubmission(voucher1, 'evidence1', {
        from: requester,
        value: requesterTotalCost - 1
      }),
      'You must fully fund your side'
    )

    txRemove = await proofH.removeSubmission(voucher1, 'evidence1', {
      from: requester,
      value: requesterTotalCost + 1
    }) // Overpay a little to see if the registered payment is correct.

    const submission = await proofH.getSubmissionInfo(voucher1)
    assert.equal(submission[0].toNumber(), 3, 'Submission has incorrect status')
    assert.equal(
      submission[5].toNumber(),
      2,
      'Submission has incorrect number of requests'
    )
    assert.equal(submission[3], true, 'Submission should still be registered')

    const round = await proofH.getRoundInfo(voucher1, 1, 0, 0)
    assert.equal(
      round[1][1].toNumber(),
      requesterTotalCost,
      'PaidFees has not been registered correctly'
    )
    assert.equal(
      round[2].toNumber(),
      1,
      'Should register that the requester paid his fees fully'
    )
    assert.equal(
      round[3].toNumber(),
      requesterTotalCost,
      'FeeRewards has not been registered correctly'
    )

    const contribution = await proofH.getContributions(
      voucher1,
      1,
      0,
      0,
      requester
    )
    assert.equal(
      contribution[1].toNumber(),
      requesterTotalCost,
      'Requester contribution has not been registered correctly'
    )

    assert.equal(
      txRemove.logs[0].event,
      'RemoveSubmission',
      'The event RemoveSubmission has not been created'
    )
    assert.equal(
      txRemove.logs[0].args._requester,
      requester,
      'The event has wrong requester'
    )
    assert.equal(
      txRemove.logs[0].args._submissionID,
      voucher1,
      'The event has wrong submission'
    )
    assert.equal(
      txRemove.logs[0].args._requestID,
      1,
      'The event has wrong request ID'
    )

    // Check that it's not possible to make a removal request for a submission that is not registered.
    await expectRevert(
      proofH.removeSubmission(other, 'evidence1', {
        from: requester,
        value: requesterTotalCost
      }),
      'Wrong status'
    )

    await proofH.addSubmission('evidence1', '', {
      from: other,
      value: requesterTotalCost
    })
    await expectRevert(
      proofH.removeSubmission(other, 'evidence1', {
        from: requester,
        value: requesterTotalCost
      }),
      'Wrong status'
    )

    // Check that it's not possible to make a request during renewal period.
    await time.increase(submissionDuration - renewalPeriodDuration)
    await expectRevert(
      proofH.removeSubmission(voucher2, 'evidence1', {
        from: requester,
        value: requesterTotalCost
      }),
      "Can't remove after renewal"
    )
  })

  it('Should not be possible to reapply before renewal time or with the wrong status', async () => {
    await expectRevert(
      proofH.reapplySubmission('.json', '', { from: voucher1 }),
      "Can't reapply yet"
    )
    await time.increase(submissionDuration - renewalPeriodDuration)

    await proofH.reapplySubmission('.json', '', { from: voucher1 })

    const submission = await proofH.getSubmissionInfo(voucher1)
    assert.equal(submission[0].toNumber(), 1, 'Submission has incorrect status')
    assert.equal(
      submission[5].toNumber(),
      2,
      'Submission has incorrect number of requests'
    )
    assert.equal(submission[3], true, 'Submission should still be registered')

    await expectRevert(
      proofH.reapplySubmission('.json', '', { from: other }),
      'Wrong status'
    )

    // Check that it's not possible to reapply 2nd time.
    await expectRevert(
      proofH.reapplySubmission('.json', '', { from: voucher1 }),
      'Wrong status'
    )
  })

  it('Should correctly store vouches and change vouching state', async () => {
    await proofH.addSubmission('evidence1', '', { from: requester })

    const txVouchAdd = await proofH.addVouch(requester, { from: voucher1 })

    let isVouched = await proofH.vouches(voucher1, requester)
    assert.equal(
      isVouched,
      true,
      'Should register the vouch for the submission'
    )
    // Check vouching events.
    assert.equal(
      txVouchAdd.logs[0].event,
      'VouchAdded',
      'The event VouchAdded has not been created'
    )
    assert.equal(
      txVouchAdd.logs[0].args._submissionID,
      requester,
      'The event VouchAdded has wrong submission address'
    )
    assert.equal(
      txVouchAdd.logs[0].args._voucher,
      voucher1,
      'The event VouchAdded has wrong voucher address'
    )
    // Check that the vouch can be removed successfully and then add it again.
    const txVouchRemove = await proofH.removeVouch(requester, {
      from: voucher1
    })

    isVouched = await proofH.vouches(voucher1, requester)
    assert.equal(isVouched, false, 'The vouch should be removed')

    assert.equal(
      txVouchRemove.logs[0].event,
      'VouchRemoved',
      'The event VouchRemoved has not been created'
    )
    assert.equal(
      txVouchRemove.logs[0].args._submissionID,
      requester,
      'The event VouchRemoved has wrong submission address'
    )
    assert.equal(
      txVouchAdd.logs[0].args._voucher,
      voucher1,
      'The event VouchRemoved has wrong voucher address'
    )

    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await expectRevert(
      proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
        from: governor
      }),
      'Requester is not funded'
    )

    await proofH.fundSubmission(requester, {
      from: requester,
      value: requesterTotalCost
    })
    // Deliberately add "bad" vouchers to see if the count is correct.
    await proofH.changeStateToPending(
      requester,
      [governor, voucher1, challenger1, voucher2, other],
      [],
      [],
      { from: governor }
    )

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(submission[0].toNumber(), 2, 'Submission has incorrect status')

    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(voucher1Info[4], true, 'Did not register the first vouch')
    const voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(voucher2Info[4], true, 'Did not register the second vouch')

    const storedVouches = (
      await proofH.getNumberOfVouches(requester, 0)
    ).toNumber()
    assert.equal(
      storedVouches,
      2,
      'Incorrect number of vouches stored in submission request'
    )
  })

  it('Check that invalid vouches are not counted', async () => {
    // Change required number of vouches to 1 to make checks more transparent
    await proofH.changeRequiredNumberOfVouches(1, { from: governor })

    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: requesterTotalCost
    })

    // Empty array of vouchers.
    await expectRevert(
      proofH.changeStateToPending(requester, [], [], [], { from: governor }),
      'Not enough valid vouches'
    )
    // Array with voucher who didn't vouch.
    await expectRevert(
      proofH.changeStateToPending(requester, [voucher1], [], [], {
        from: governor
      }),
      'Not enough valid vouches'
    )
    // Voucher who already vouched for a different submission.
    await proofH.addSubmission('evidence1', '', {
      from: requester2,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher2 })
    await proofH.addVouch(requester2, { from: voucher2 })
    await proofH.changeStateToPending(requester2, [voucher2], [], [], {
      from: governor
    })
    await expectRevert(
      proofH.changeStateToPending(requester, [voucher2], [], [], {
        from: governor
      }),
      'Not enough valid vouches'
    )
    // Voucher whose submission time has expired.
    await proofH.changeDurations(9, 0, 0, { from: governor })
    await time.increase(10)

    await proofH.addVouch(requester, { from: voucher1 })
    await expectRevert(
      proofH.changeStateToPending(requester, [voucher1], [], [], {
        from: governor
      }),
      'Not enough valid vouches'
    )

    // Change the submission time and nbVouches back to do another checks.
    await proofH.changeDurations(
      submissionDuration,
      renewalPeriodDuration,
      challengePeriodDuration,
      {
        from: governor
      }
    )
    await proofH.changeRequiredNumberOfVouches(nbVouches, { from: governor })

    // Check that the voucher can't be duplicated.
    await expectRevert(
      proofH.changeStateToPending(requester, [voucher1, voucher1], [], [], {
        from: governor
      }),
      'Not enough valid vouches'
    )
  })

  it('Should not use more vouches than needed', async () => {
    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })
    await proofH.addVouch(requester, { from: voucher3 })
    await proofH.changeStateToPending(
      requester,
      [voucher1, voucher2, voucher3],
      [],
      [],
      { from: governor }
    )
    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      voucher1Info[4],
      true,
      'First voucher should be marked as used'
    )
    const voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      voucher2Info[4],
      true,
      'Second voucher should be marked as used'
    )
    const voucher3Info = await proofH.getSubmissionInfo(voucher3)
    assert.equal(voucher3Info[4], false, 'Third voucher should not be used')
  })

  it('Should allow signed vouches', async () => {
    await proofH.addSubmission('evidence1', '', { from: requester })

    const timeout = (await time.latest()).add(new BN(15768000)).toNumber() // Expires in 6 months

    const vouch1 = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher1
    )

    const vouch2 = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher2
    )

    const vouchInvalid = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: (await time.latest())
              .sub(new BN(1))
              .toNumber()
          }
        },
        voucherTemplate
      ),
      voucher1
    )

    await expectRevert(
      proofH.changeStateToPending(
        requester,
        [],
        [vouch1, vouch2],
        [timeout, timeout],
        {
          from: governor
        }
      ),
      'Requester is not funded'
    )

    await proofH.fundSubmission(requester, {
      from: requester,
      value: requesterTotalCost
    })
    // Deliberately add "bad" voucher to see if the count is correct.
    let txChangeState = await proofH.changeStateToPending(
      requester,
      [],
      [vouch1, vouchInvalid, vouchInvalid, vouch2, vouch2],
      [timeout, timeout, 1, 0, timeout],
      { from: governor }
    )

    // Check vouching events.
    assert.equal(
      txChangeState.logs[0].event,
      'VouchAdded',
      'The first event VouchAdded has not been created'
    )
    assert.equal(
      txChangeState.logs[0].args._submissionID,
      requester,
      'The first event VouchAdded has wrong submission address'
    )
    assert.equal(
      txChangeState.logs[0].args._voucher,
      voucher1,
      'The first event VouchAdded has wrong voucher address'
    )
    assert.equal(
      txChangeState.logs[1].event,
      'VouchAdded',
      'The second event VouchAdded has not been created'
    )
    assert.equal(
      txChangeState.logs[1].args._submissionID,
      requester,
      'The second event VouchAdded has wrong submission address'
    )
    assert.equal(
      txChangeState.logs[1].args._voucher,
      voucher2,
      'The second event VouchAdded has wrong voucher address'
    )

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(submission[0].toNumber(), 2, 'Submission has incorrect status')

    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(voucher1Info[4], true, 'Did not register the first vouch')
    const voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(voucher2Info[4], true, 'Did not register the second vouch')

    const storedVouches = (
      await proofH.getNumberOfVouches(requester, 0)
    ).toNumber()
    assert.equal(
      storedVouches,
      2,
      'Incorrect number of vouches stored in submission request'
    )
  })

  it('Check that invalid signed vouches are not counted', async () => {
    // Change required number of vouches to 1 to make checks more transparent
    await proofH.changeRequiredNumberOfVouches(1, { from: governor })

    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: requesterTotalCost
    })

    // Empty array of vouchers.
    await expectRevert(
      proofH.changeStateToPending(requester, [], [], [], { from: governor }),
      'Not enough valid vouches'
    )
    // Array with voucher who didn't vouch.
    await expectRevert(
      proofH.changeStateToPending(requester, [voucher1], [], [], {
        from: governor
      }),
      'Not enough valid vouches'
    )
    const timeout = (await time.latest()).add(new BN(15768000)).toNumber() // Expires in 6 months

    const vouch2_2 = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester2,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher2
    )

    const vouch2_1 = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher2
    )

    // Voucher who already vouched for a different submission.
    await proofH.addSubmission('evidence1', '', {
      from: requester2,
      value: requesterTotalCost
    })
    await proofH.changeStateToPending(requester2, [], [vouch2_2], [timeout], {
      from: governor
    })
    await expectRevert(
      proofH.changeStateToPending(requester, [], [vouch2_1], [timeout], {
        from: governor
      }),
      'Not enough valid vouches'
    )
    // Voucher whose submission time has expired.
    await proofH.changeDurations(9, 0, 0, { from: governor })
    await time.increase(10)

    const vouch1_1 = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher1
    )

    await expectRevert(
      proofH.changeStateToPending(requester, [], [vouch1_1], [timeout], {
        from: governor
      }),
      'Not enough valid vouches'
    )

    // Change the submission time and nbVouches back to do another checks.
    await proofH.changeDurations(
      submissionDuration,
      renewalPeriodDuration,
      challengePeriodDuration,
      {
        from: governor
      }
    )
    await proofH.changeRequiredNumberOfVouches(nbVouches, { from: governor })

    // Check that the voucher can't be duplicated.
    await expectRevert(
      proofH.changeStateToPending(
        requester,
        [],
        [vouch1_1, vouch1_1],
        [timeout, timeout],
        {
          from: governor
        }
      ),
      'Not enough valid vouches'
    )
  })

  it('Should allow a mixture of signed and stored vouches', async () => {
    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: requesterTotalCost
    })

    const timeout = (await time.latest()).add(new BN(15768000)).toNumber() // Expires in 6 months

    const vouch = await web3.eth.signTypedData(
      Object.assign(
        {
          message: {
            vouchedSubmission: requester,
            voucherExpirationTimestamp: timeout
          }
        },
        voucherTemplate
      ),
      voucher1
    )
    await proofH.addVouch(requester, { from: voucher2 })

    proofH.changeStateToPending(requester, [voucher2], [vouch], [timeout], {
      from: governor
    })

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(submission[0].toNumber(), 2, 'Submission has incorrect status')
    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(voucher1Info[4], true, 'Did not register the first vouch')
    const voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(voucher2Info[4], true, 'Did not register the second vouch')
  })

  it('Should set correct values and create a dispute after the submission is challenged', async () => {
    // Check that the submission with the wrong status can't be challenged.
    await expectRevert(
      proofH.challengeRequest(
        voucher1,
        2,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: 1e18 }
      ),
      'Wrong status'
    )
    await expectRevert(
      proofH.challengeRequest(
        requester,
        2,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: 1e18 }
      ),
      'Wrong status'
    )

    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await expectRevert(
      proofH.challengeRequest(
        requester,
        2,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: 1e18 }
      ),
      'Wrong status'
    )

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    // Check the rest of the require statements as well.
    await expectRevert(
      proofH.challengeRequest(
        requester,
        0,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: 1e18 }
      ),
      'Reason must be specified'
    )
    await expectRevert(
      proofH.challengeRequest(
        requester,
        2,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: arbitrationCost - 1 }
      ),
      'You must fully fund your side'
    )

    const oldBalance = await web3.eth.getBalance(challenger1)
    // Deliberately overpay to see if the payment is registered correctly
    txChallenge = await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      'evidence2',
      { from: challenger1, gasPrice: gasPrice, value: 1e18 }
    )
    const newBalance = await web3.eth.getBalance(challenger1)
    const txFee = txChallenge.receipt.gasUsed * gasPrice

    // Check that the request can't be challenged again with another reason.
    await expectRevert(
      proofH.challengeRequest(
        requester,
        1,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: 1e18 }
      ),
      'The request is disputed'
    )
    await expectRevert(
      proofH.challengeRequest(requester, 3, voucher1, 'evidence2', {
        from: challenger1,
        value: 1e18
      }),
      'Another reason is active'
    )

    assert(
      new BN(newBalance).eq(
        new BN(oldBalance).sub(new BN(arbitrationCost).add(new BN(txFee)))
      ),
      'The challenger has incorrect balance after making a submission'
    )

    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[0], true, 'The request should be disputed')
    // The number of challenges is incremented beforehand so it should be 2.
    assert.equal(
      request[3].toNumber(),
      2,
      'The current reason of the request is incorrect'
    )
    assert.equal(
      request[4].toNumber(),
      1,
      'The number of parallel disputes of the request is incorrect'
    )
    assert.equal(
      request[5].toNumber(),
      1,
      'The lastChallengeID of the request is incorrect'
    )
    assert.equal(request[9].toNumber(), 2, 'Incorrect reasons bitmap value')

    const challengeInfo = await proofH.getChallengeInfo(requester, 0, 0)
    assert.equal(
      challengeInfo[0].toNumber(),
      1,
      'Incorrect lastRoundID after challenge'
    )
    assert.equal(
      challengeInfo[1],
      challenger1,
      'Challenger not set up properly'
    )
    assert.equal(
      challengeInfo[2].toNumber(),
      1,
      'Incorrect dispute ID of the challenge'
    )
    assert.equal(challengeInfo[4].toNumber(), 0, 'Duplicate index should be 0')
    const disputeData = await proofH.arbitratorDisputeIDToDisputeData(
      arbitrator.address,
      1
    )
    assert.equal(disputeData[0].toNumber(), 0, 'Incorrect challengeID')
    assert.equal(
      disputeData[1],
      requester,
      'Incorrect submission ID stored in disputeData struct'
    )

    let round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[1][2].toNumber(),
      1000,
      'Challenger paidFees has not been registered correctly'
    )
    assert.equal(
      round[2].toNumber(),
      0,
      'Should register that challenger paid his fees and set sideFunded back to 0'
    )
    assert.equal(
      round[3].toNumber(),
      6000, // It should stay the same because the value of the deposit get subtracted when the dispute is created.
      'Incorrect feeRewards value after challenge'
    )

    // Also briefly check the round that was created beforehand for the new challenge.
    round = await proofH.getRoundInfo(requester, 0, 1, 0)
    assert.equal(
      round[3].toNumber(),
      0,
      'FeeRewards should be empty for the new challenge'
    )

    const dispute = await arbitrator.disputes(1)
    assert.equal(dispute[0], proofH.address, 'Arbitrable not set up properly')
    assert.equal(
      dispute[1].toNumber(),
      2,
      'Number of choices not set up properly'
    )

    assert.equal(
      txChallenge.logs[1].event,
      'Dispute',
      'The Dispute event has not been created'
    )
    assert.equal(
      txChallenge.logs[1].args._arbitrator,
      arbitrator.address,
      'The Dispute event has wrong arbitrator address'
    )
    assert.equal(
      txChallenge.logs[1].args._disputeID.toNumber(),
      1,
      'The Dispute event has wrong dispute ID'
    )
    assert.equal(
      txChallenge.logs[1].args._metaEvidenceID.toNumber(),
      0,
      'The Dispute event has wrong metaevidence ID'
    )
    const evidenceGroupID = parseInt(requester, 16)
    assert.equal(
      txChallenge.logs[1].args._evidenceGroupID,
      evidenceGroupID,
      'The Dispute event has wrong evidence group ID'
    )
    assert.equal(
      txChallenge.logs[2].event,
      'Evidence',
      'The Evidence event has not been created'
    )
    assert.equal(
      txChallenge.logs[2].args._arbitrator,
      arbitrator.address,
      'The Evidence event has wrong arbitrator address'
    )
    assert.equal(
      txChallenge.logs[2].args._evidenceGroupID,
      evidenceGroupID,
      'The Evidence event has wrong evidence group ID'
    )
    assert.equal(
      txChallenge.logs[2].args._party,
      challenger1,
      'The Evidence event has wrong challenger address'
    )
    assert.equal(
      txChallenge.logs[2].args._evidence,
      'evidence2',
      'The Evidence event has incorrect evidence'
    )
    // Check that the request can't just be executed after challenge.
    await time.increase(challengePeriodDuration + 1)
    await expectRevert(
      proofH.executeRequest(requester, { from: governor }),
      'The request is disputed'
    )
  })

  it('Should not be possible to challenge after timeout', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })
    await time.increase(challengePeriodDuration + 1)
    await expectRevert(
      proofH.challengeRequest(
        requester,
        2,
        '0x0000000000000000000000000000000000000000',
        'evidence2',
        { from: challenger1, value: arbitrationCost }
      ),
      'Time to challenge has passed'
    )
  })

  it('Should set correct values in parallel disputes', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await expectRevert(
      proofH.challengeRequest(
        requester,
        3,
        '0x0000000000000000000000000000000000000000',
        '',
        { from: challenger1, value: arbitrationCost }
      ),
      'Wrong duplicate status'
    )
    await expectRevert(
      proofH.challengeRequest(requester, 3, requester, '', {
        from: challenger1,
        value: arbitrationCost
      }),
      "Can't be a duplicate of itself"
    )

    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger1,
      value: arbitrationCost
    })

    await expectRevert(
      proofH.challengeRequest(requester, 3, voucher2, '', {
        from: challenger1,
        value: arbitrationCost
      }),
      'Duplicate address already used'
    )
    assert.equal(
      await proofH.checkRequestDuplicates(requester, 0, voucher2),
      true,
      'The duplicate should be marked as used'
    )

    await proofH.challengeRequest(requester, 3, voucher3, '', {
      from: challenger2,
      value: arbitrationCost
    })
    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(
      request[4].toNumber(),
      2,
      'The number of parallel disputes of the request is incorrect'
    )
    // The number of challenges is incremented for the new potential challenge.
    assert.equal(
      request[5].toNumber(),
      2,
      'The lastChallengeID of the request is incorrect'
    )
    assert.equal(
      request[9].toNumber(),
      4,
      'The reasons bitmap of the request is incorrect'
    )

    const challengeInfo1 = await proofH.getChallengeInfo(requester, 0, 0)
    assert.equal(
      challengeInfo1[0].toNumber(),
      1,
      'Incorrect lastRoundID of the first challenge'
    )
    assert.equal(
      challengeInfo1[1],
      challenger1,
      'First challenger was not set up properly'
    )
    assert.equal(
      challengeInfo1[2].toNumber(),
      1,
      'Incorrect dispute ID of the first challenge'
    )
    assert.equal(
      challengeInfo1[4].toNumber(),
      1,
      'Duplicate index is incorrect for the first challenge'
    )

    const disputeData1 = await proofH.arbitratorDisputeIDToDisputeData(
      arbitrator.address,
      1
    )
    assert.equal(
      disputeData1[0].toNumber(),
      0,
      'Incorrect challengeID of the first challenge'
    )
    assert.equal(
      disputeData1[1],
      requester,
      'Challenged submission was not set up properly for the first challenge'
    )

    const challengeInfo2 = await proofH.getChallengeInfo(requester, 0, 1)
    assert.equal(
      challengeInfo2[0].toNumber(),
      1,
      'Incorrect lastRoundID of the second challenge'
    )
    assert.equal(
      challengeInfo2[1],
      challenger2,
      'Second challenger was not set up properly'
    )
    assert.equal(
      challengeInfo2[2].toNumber(),
      2,
      'Incorrect dispute ID of the second challenge'
    )
    assert.equal(
      challengeInfo2[4].toNumber(),
      2,
      'Duplicate index is incorrect for the second challenge'
    )
    const disputeData2 = await proofH.arbitratorDisputeIDToDisputeData(
      arbitrator.address,
      2
    )
    assert.equal(
      disputeData2[0].toNumber(),
      1,
      'Incorrect challengeID of the second challenge'
    )
    assert.equal(
      disputeData2[1],
      requester,
      'Challenged submission was not set up properly for the second challenge'
    )

    let round = await proofH.getRoundInfo(requester, 0, 0, 0)
    assert.equal(
      round[3].toNumber(),
      6000,
      'Incorrect feeRewards value for the first challenge'
    )
    round = await proofH.getRoundInfo(requester, 0, 1, 0)
    assert.equal(
      round[3].toNumber(),
      0, // The second challenge doesn't count the requester's payment, so feeRewards should stay 0.
      'Incorrect feeRewards value for the second challenge'
    )
  })

  it('Should set correct values when challenging a removal request', async () => {
    // All checks for correct values have already been done in previous tests. Here just check conditions that are unique for this type of challenge.
    await proofH.removeSubmission(voucher1, '', {
      from: requester,
      value: requesterTotalCost
    })

    await expectRevert(
      proofH.challengeRequest(
        voucher1,
        1,
        '0x0000000000000000000000000000000000000000',
        '',
        { from: challenger1, value: arbitrationCost }
      ),
      'Reason must be left empty'
    )

    await proofH.challengeRequest(
      voucher1,
      0,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )

    const request = await proofH.getRequestInfo(voucher1, 1)
    assert.equal(
      request[3].toNumber(),
      0,
      'The current reason of the removal request should be 0'
    )
    assert.equal(
      request[5].toNumber(),
      1,
      'The lastChallengeID of the removal request is incorrect'
    )
    assert.equal(request[9].toNumber(), 0, 'The reasons bitmap should be empty')
  })

  it('Should successfully execute a request if it has not been challenged', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await expectRevert(
      proofH.executeRequest(requester, { from: governor }),
      "Can't execute yet"
    )

    await time.increase(challengePeriodDuration + 1)

    const oldBalance = await web3.eth.getBalance(requester)
    await proofH.executeRequest(requester, { from: governor })
    const newBalance = await web3.eth.getBalance(requester)

    let submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(submission[3], true, 'The submission should be registered')

    let request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
    assert(
      new BN(newBalance).eq(new BN(oldBalance).add(new BN(requesterTotalCost))),
      'The requester was not reimbursed correctly'
    )

    const contribution = await proofH.getContributions(
      requester,
      0,
      0,
      0,
      requester
    )
    assert.equal(
      contribution[1].toNumber(),
      0,
      'Contribution of the requester should be 0'
    )
    // Check that it's not possible to execute two times in a row.
    await expectRevert(
      proofH.executeRequest(requester, { from: governor }),
      'Incorrect status.'
    )

    // Check that the vouchers have been processed.
    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(voucher1Info[4], false, 'Voucher1 was not processed correctly')
    const voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(voucher2Info[4], false, 'Voucher2 was not processed correctly')

    // Also check removal request.
    await proofH.removeSubmission(requester, '', {
      from: requester2,
      value: requesterTotalCost
    })
    await time.increase(challengePeriodDuration + 1)

    await proofH.executeRequest(requester, { from: governor })
    submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status after removal'
    )
    assert.equal(
      submission[3],
      false,
      'The submission should not be registered after removal'
    )
    request = await proofH.getRequestInfo(requester, 1)
    assert.equal(
      request[1],
      true,
      'The request should be resolved after removal'
    )
  })

  it('Should demand correct appeal fees and register that appeal fee has been paid', async () => {
    let roundInfo
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await expectRevert(
      proofH.fundAppeal(requester, 0, 2, {
        from: challenger1,
        value: 1e18
      }),
      'No dispute to appeal'
    )

    await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )

    await arbitrator.giveRuling(1, 2)

    // Appeal fee is the same as arbitration fee for this arbitrator.
    const loserAppealFee =
      arbitrationCost +
      (arbitrationCost * loserStakeMultiplier) / MULTIPLIER_DIVISOR // 1000 + 1000 * 0.8 = 1800

    await expectRevert.unspecified(
      proofH.fundAppeal(requester, 0, 0, {
        from: challenger1,
        value: loserAppealFee
      }) // Check that not possible to fund 0 side.
    )

    await expectRevert(
      proofH.fundAppeal(requester, 1, 2, {
        from: challenger1,
        value: 1e18
      }),
      'Challenge out of bounds'
    )

    // Deliberately overpay to check that only required fee amount will be registered.
    await proofH.fundAppeal(requester, 0, 1, { from: requester, value: 1e18 })

    await expectRevert(
      proofH.fundAppeal(requester, 0, 1, {
        from: requester,
        value: 1e18
      }),
      'Side is already funded'
    )

    roundInfo = await proofH.getRoundInfo(requester, 0, 0, 1) // Appeal rounds start with 1.

    assert.equal(
      roundInfo[1][1].toNumber(),
      1800,
      'Registered fee of the requester is incorrect'
    )
    assert.equal(
      roundInfo[2].toNumber(),
      1,
      'Did not register that the requester successfully paid his fees'
    )

    assert.equal(
      roundInfo[1][2].toNumber(),
      0,
      'Should not register any payments for challenger'
    )

    assert.equal(roundInfo[3].toNumber(), 1800, 'Incorrect FeeRewards value')

    const winnerAppealFee =
      arbitrationCost +
      (arbitrationCost * winnerStakeMultiplier) / MULTIPLIER_DIVISOR // 1200

    // Increase time to make sure winner can pay in 2nd half.
    await time.increase(appealTimeOut / 2 + 1)

    await proofH.fundAppeal(requester, 0, 2, {
      from: challenger1,
      value: winnerAppealFee
    })

    roundInfo = await proofH.getRoundInfo(requester, 0, 0, 1)

    assert.equal(
      roundInfo[1][2].toNumber(),
      1200,
      'Registered appeal fee of the challenger is incorrect'
    )
    assert.equal(
      roundInfo[2].toNumber(),
      0,
      'Should register that the challenger successfully paid his fees and set sideFunded to default'
    )

    assert.equal(
      roundInfo[3].toNumber(),
      2000, // 1800 + 1200 - 1000
      'Incorrect FeeRewards value after both sides paid their fees'
    )

    // If both sides pay their fees it starts new appeal round. Check that both sides have their values set to default.
    roundInfo = await proofH.getRoundInfo(requester, 0, 0, 2)
    assert.equal(
      roundInfo[2].toNumber(),
      0,
      'sideFunded should be 0 in the new round'
    )

    // Resolve the first challenge to see if the new challenge will set correct values as well.
    await arbitrator.giveRuling(2, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(2, 1)

    await proofH.challengeRequest(
      requester,
      1,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger2, value: arbitrationCost }
    )
    await arbitrator.giveRuling(3, 0) // Give 0 ruling to check shared multiplier this time.

    await proofH.fundAppeal(requester, 1, 1, { from: requester, value: 1e18 })

    roundInfo = await proofH.getRoundInfo(requester, 0, 1, 1)

    assert.equal(
      roundInfo[1][1].toNumber(),
      1500, // With shared multiplier = 5000 the sharedFee is 1500
      'Registered fee of the requester is incorrect'
    )
    assert.equal(
      roundInfo[2].toNumber(),
      1,
      'Did not register that the requester successfully paid his fees'
    )
    assert.equal(roundInfo[3].toNumber(), 1500, 'Incorrect FeeRewards value')

    await proofH.fundAppeal(requester, 1, 2, {
      from: challenger1,
      value: 1500
    })

    roundInfo = await proofH.getRoundInfo(requester, 0, 1, 1)

    assert.equal(
      roundInfo[1][2].toNumber(),
      1500,
      'Registered appeal fee of the challenger is incorrect'
    )
    assert.equal(
      roundInfo[2].toNumber(),
      0,
      'Should register that the challenger successfully paid his fees and set sideFunded to default'
    )

    assert.equal(
      roundInfo[3].toNumber(),
      2000,
      'Incorrect FeeRewards value after both sides paid their fees'
    )

    roundInfo = await proofH.getRoundInfo(requester, 0, 1, 2)
    assert.equal(
      roundInfo[2].toNumber(),
      0,
      'sideFunded should be 0 in the new round'
    )
  })

  it('Should not be possible to fund appeal if the timeout has passed', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })
    await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 1)

    const loserAppealFee =
      arbitrationCost +
      (arbitrationCost * winnerStakeMultiplier) / MULTIPLIER_DIVISOR

    await time.increase(appealTimeOut / 2 + 1)
    await expectRevert(
      proofH.fundAppeal(requester, 0, 2, {
        from: challenger1,
        value: loserAppealFee
      }),
      'Appeal period is over for loser'
    )
    const winnerAppealFee =
      arbitrationCost +
      (arbitrationCost * winnerStakeMultiplier) / MULTIPLIER_DIVISOR

    await time.increase(appealTimeOut / 2 + 1)
    await expectRevert(
      proofH.fundAppeal(requester, 0, 1, {
        from: requester,
        value: winnerAppealFee
      }),
      'Appeal period is over'
    )
  })

  it('Should correctly reset the challenge period if the requester wins', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )

    await arbitrator.giveRuling(1, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)

    let request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[0], false, 'The request should not be disputed')
    assert.equal(
      request[3].toNumber(),
      0,
      'Current reason should be reset to 0'
    )

    // Check that it's not possible to challenge with the same reason.
    await expectRevert(
      proofH.challengeRequest(
        requester,
        2,
        '0x0000000000000000000000000000000000000000',
        '',
        { from: challenger1, value: arbitrationCost }
      ),
      'The reason has already been used'
    )

    // Also check that the execution of the request is still possible if there is no dispute.
    await time.increase(challengePeriodDuration + 1)
    const oldBalance = await web3.eth.getBalance(requester)
    await proofH.executeRequest(requester, { from: governor })
    const newBalance = await web3.eth.getBalance(requester)
    assert(
      new BN(newBalance).eq(new BN(oldBalance).add(new BN(requesterTotalCost))),
      'The requester was not reimbursed correctly'
    )

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(submission[3], true, 'The submission should be registered')
    request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
  })

  it('Should register the submission if the requester won in all 4 reasons', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)

    await proofH.challengeRequest(
      requester,
      1,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(2, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(2, 1)

    // Make a parallel request to see if it's handled correctly.
    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger2,
      value: arbitrationCost
    })
    await arbitrator.giveRuling(3, 1)
    await arbitrator.giveRuling(4, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(3, 1)
    await arbitrator.giveRuling(4, 1)

    // Check that the info stored in the request is correct so far.
    let submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[3],
      false,
      'The submission should not be registered yet'
    )

    let request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], false, 'The request should not be resolved yet')
    assert.equal(request[5].toNumber(), 4, 'Incorrect lastChallengeID')
    assert.equal(request[9].toNumber(), 7, 'Incorrect reasons bitmap')
    // Check the data of a random challenge as well.
    const challengeInfo = await proofH.getChallengeInfo(requester, 0, 3)
    assert.equal(
      challengeInfo[2].toNumber(),
      4,
      'Challenge ID does not correspond with a dispute ID'
    )
    assert.equal(
      challengeInfo[3].toNumber(),
      1,
      'Incorrect ruling of the challenge'
    )

    await proofH.challengeRequest(
      requester,
      4,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger2, value: arbitrationCost }
    )
    await arbitrator.giveRuling(5, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(5, 1)

    request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
    assert.equal(
      request[4].toNumber(),
      0,
      'Should not be any parallel disputes'
    )
    assert.equal(
      request[9].toNumber(),
      15,
      'Incorrect reasons bitmap in the end'
    )

    submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(
      await proofH.isRegistered(requester),
      true,
      'The submission should be registered'
    )
  })

  it('Should set correct values if arbitrator refuses to rule', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    // Make a parallel request to see if it's handled correctly.
    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger2,
      value: arbitrationCost
    })
    await arbitrator.giveRuling(1, 0)
    await arbitrator.giveRuling(2, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 0)
    await arbitrator.giveRuling(2, 1)

    // The requester didn't win the first dispute so his request should be declined in the end.
    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(
      await proofH.isRegistered(requester),
      false,
      'The submission should not be registered'
    )

    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
    assert.equal(request[2], true, 'requsterLost should be marked as true')
    assert.equal(
      request[8],
      '0x0000000000000000000000000000000000000000',
      'Ultimate challenger should not be defined if 0 ruling wins'
    )

    const challengeInfo1 = await proofH.getChallengeInfo(requester, 0, 0)
    assert.equal(
      challengeInfo1[3].toNumber(),
      0,
      'Incorrect ruling of the first challenge'
    )
    const challengeInfo2 = await proofH.getChallengeInfo(requester, 0, 1)
    assert.equal(
      challengeInfo2[3].toNumber(),
      1,
      'Incorrect ruling of the second challenge'
    )
  })

  it('Should set correct values if challenger wins', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(
      requester,
      1,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 2)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 2)

    const submission = await proofH.getSubmissionInfo(requester)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(
      submission[3],
      false,
      'The submission should not be registered'
    )

    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
    assert.equal(request[2], true, 'requsterLost should be marked as true')
    assert.equal(request[8], challenger1, 'Incorrect ultimate challenger')

    const challengeInfo = await proofH.getChallengeInfo(requester, 0, 0)
    assert.equal(challengeInfo[3].toNumber(), 2, 'Incorrect ruling')
  })

  it('Should switch the winning challenger in reason Duplicate', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    // Voucher1 is the earliest submission so challenger2 should be the ultimate challenger in the end.
    await proofH.challengeRequest(requester, 3, voucher3, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger2,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: other,
      value: arbitrationCost
    })
    await arbitrator.giveRuling(1, 2)
    await arbitrator.giveRuling(2, 2)
    await arbitrator.giveRuling(3, 2)
    await time.increase(appealTimeOut + 1)

    await arbitrator.giveRuling(1, 2)
    let request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], false, 'The request should not be resolved yet')
    assert.equal(
      request[8],
      challenger1,
      'Incorrect ultimate challenger after the 1st ruling'
    )

    await arbitrator.giveRuling(2, 2)
    request = await proofH.getRequestInfo(requester, 0)
    assert.equal(
      request[8],
      challenger2,
      'Ultimate challenger should be switched after the 2nd ruling'
    )

    await arbitrator.giveRuling(3, 2)
    request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[1], true, 'The request should be resolved')
    assert.equal(
      request[8],
      challenger2,
      'Ultimate challenger should stay the same after the 3rd ruling'
    )
  })

  it('Should set correct values if requester wins removal request', async () => {
    await proofH.removeSubmission(voucher1, '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.challengeRequest(
      voucher1,
      0,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)

    const submission = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(
      submission[3],
      false,
      'The submission should not be registered'
    )

    const request = await proofH.getRequestInfo(voucher1, 1)
    assert.equal(request[1], true, 'The request should be resolved')

    const challengeInfo = await proofH.getChallengeInfo(voucher1, 1, 0)
    assert.equal(challengeInfo[3].toNumber(), 1, 'Incorrect ruling')
  })

  it('Should set correct values if challenger wins removal request', async () => {
    await proofH.removeSubmission(voucher1, '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.challengeRequest(
      voucher1,
      0,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 2)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 2)

    const submission = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission[0].toNumber(),
      0,
      'The submission should have a default status'
    )
    assert.equal(
      submission[3],
      true,
      'The submission should still be registered'
    )

    const request = await proofH.getRequestInfo(voucher1, 1)
    assert.equal(request[1], true, 'The request should be resolved')

    const challengeInfo = await proofH.getChallengeInfo(voucher1, 1, 0)
    assert.equal(challengeInfo[3].toNumber(), 2, 'Incorrect ruling')
  })

  it('Should change the ruling if the loser paid appeal fee while winner did not', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })
    await proofH.challengeRequest(
      requester,
      2,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 1)

    await proofH.fundAppeal(requester, 0, 2, { from: challenger1, value: 1e18 })

    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)

    const request = await proofH.getRequestInfo(requester, 0)
    assert.equal(request[8], challenger1, 'Incorrect ultimate challenger')
    const challengeInfo = await proofH.getChallengeInfo(requester, 0, 0)
    assert.equal(
      challengeInfo[3].toNumber(),
      2,
      'The ruling should be switched to challenger'
    )
  })

  it('Should process vouches correctly', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(
      requester,
      1,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )
    await arbitrator.giveRuling(1, 2)
    await time.increase(appealTimeOut + 1)
    await expectRevert(
      proofH.processVouches(requester, 0, 1, { from: governor }),
      'Submission must be resolved'
    )
    // Let challenger win to make the test more transparent.
    await arbitrator.giveRuling(1, 2)

    await proofH.processVouches(requester, 0, 1, { from: governor })
    const voucher1Info = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      voucher1Info[4],
      false,
      'First voucher should not be marked as used'
    )
    let voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      voucher2Info[4],
      true,
      'Second voucher should still be marked as used'
    )
    const submission1 = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission1[3],
      true,
      'The first submission should still be registered'
    )

    await proofH.processVouches(requester, 0, 1, { from: governor })
    voucher2Info = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      voucher2Info[4],
      false,
      'Second voucher should not be marked as used'
    )
    const submission2 = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      submission2[3],
      true,
      'The second submission should still be registered'
    )
  })

  it('Should correctly penalize vouchers that vote for a bad submission', async () => {
    // Make it so one of the vouchers is in the middle of reapplication process.
    await time.increase(submissionDuration - renewalPeriodDuration)

    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(
      requester,
      4,
      '0x0000000000000000000000000000000000000000',
      '',
      { from: challenger1, value: arbitrationCost }
    )

    // Change required number of vouches to 1 because the rest 2 are used.
    await proofH.changeRequiredNumberOfVouches(1, { from: governor })
    await proofH.reapplySubmission('', '', {
      from: voucher1,
      value: requesterTotalCost
    })
    await proofH.addVouch(voucher1, { from: voucher3 })
    await proofH.changeStateToPending(voucher1, [voucher3], [], [], {
      from: governor
    })

    await arbitrator.giveRuling(1, 2)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 2)

    await proofH.processVouches(requester, 0, 2, { from: governor })
    let submission1 = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission1[3],
      false,
      'The first submission should not be registered'
    )
    const submission2 = await proofH.getSubmissionInfo(voucher2)
    assert.equal(
      submission2[3],
      false,
      'The second submission should not be registered'
    )

    let request = await proofH.getRequestInfo(voucher1, 1)
    assert.equal(request[2], true, 'requsterLost should be marked as true')
    await time.increase(challengePeriodDuration + 1)
    await proofH.executeRequest(voucher1, { from: governor })

    submission1 = await proofH.getSubmissionInfo(voucher1)
    assert.equal(
      submission1[0].toNumber(),
      0,
      'The first submission should have a default status'
    )
    assert.equal(
      submission1[3],
      false,
      'The first submission still should not be registered'
    )
    request = await proofH.getRequestInfo(voucher1, 1)
    assert.equal(request[1], true, 'Reapplication request should be resolved')
  })

  it('Ultimate challenger should take feeRewards of the first challenge', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger2,
      value: arbitrationCost
    })

    await arbitrator.giveRuling(1, 1)
    await arbitrator.giveRuling(2, 2)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)

    await expectRevert(
      proofH.withdrawFeesAndRewards(challenger2, requester, 0, 0, 0, {
        from: governor
      }),
      'Submission must be resolved'
    )
    await arbitrator.giveRuling(2, 2)

    await expectRevert(
      proofH.withdrawFeesAndRewards(
        '0x0000000000000000000000000000000000000000',
        requester,
        0,
        0,
        0,
        { from: governor }
      ),
      'Beneficiary must not be empty'
    )
    const oldBalanceRequester = await web3.eth.getBalance(requester)
    await proofH.withdrawFeesAndRewards(requester, requester, 0, 0, 0, {
      from: governor
    })
    const newBalanceRequester = await web3.eth.getBalance(requester)
    // Requester's fee of the first dispute should go to the ultimate challenger.
    assert(
      new BN(newBalanceRequester).eq(new BN(oldBalanceRequester)),
      'The balance of the requester should stay the same'
    )

    // Only check the 2nd challenger, because the 1st challenger didn't win a dispute.
    let oldBalanceChallenger = await web3.eth.getBalance(challenger2)
    await proofH.withdrawFeesAndRewards(challenger2, requester, 0, 0, 0, {
      from: governor
    })
    let newBalanceChallenger = await web3.eth.getBalance(challenger2)
    assert(
      new BN(newBalanceChallenger).eq(
        new BN(oldBalanceChallenger).add(new BN(requesterTotalCost))
      ),
      'The challenger has incorrect balance after withdrawing from 0 challenge'
    )
    oldBalanceChallenger = await web3.eth.getBalance(challenger2)
    await proofH.withdrawFeesAndRewards(challenger2, requester, 0, 1, 0, {
      from: governor
    })
    newBalanceChallenger = await web3.eth.getBalance(challenger2)
    assert(
      new BN(newBalanceChallenger).eq(new BN(oldBalanceChallenger)),
      'The challenger should have the same balance after withdrawing from 1 challenge'
    )
  })

  it('Should not withdraw anything from the subsequent challenge', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost * 0.2
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })
    await proofH.fundSubmission(requester, { from: other, value: 1e18 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger2,
      value: arbitrationCost
    })

    await arbitrator.giveRuling(1, 1)
    await arbitrator.giveRuling(2, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 1)
    await arbitrator.giveRuling(2, 1)

    await time.increase(challengePeriodDuration + 1)
    let oldBalanceRequester = await web3.eth.getBalance(requester)
    await proofH.executeRequest(requester, { from: governor })
    let newBalanceRequester = await web3.eth.getBalance(requester)
    assert(
      new BN(newBalanceRequester).eq(
        new BN(oldBalanceRequester).add(new BN(1200)) // The requester only did a partial funding so he should be reimbursed according to that (0.2 * feeRewards).
      ),
      'The balance of the requester is incorrect after withdrawing from 0 challenge'
    )
    const oldBalanceCrowdfunder = await web3.eth.getBalance(other)
    await proofH.withdrawFeesAndRewards(other, requester, 0, 0, 0, {
      from: governor
    })
    const newBalanceCrowdfunder = await web3.eth.getBalance(other)
    assert(
      new BN(newBalanceCrowdfunder).eq(
        new BN(oldBalanceCrowdfunder).add(new BN(4800)) // 0.8 * feeRewards.
      ),
      'The balance of the crowdfunder is incorrect'
    )

    oldBalanceRequester = await web3.eth.getBalance(requester)
    await proofH.withdrawFeesAndRewards(requester, requester, 0, 1, 0, {
      from: governor
    })
    newBalanceRequester = await web3.eth.getBalance(requester)
    assert(
      new BN(newBalanceRequester).eq(new BN(oldBalanceRequester)),
      'The balance of the requester should stay the same'
    )
  })

  it('Should withdraw fees correctly if arbitrator refused to rule', async () => {
    await proofH.addSubmission('', '', {
      from: requester,
      value: requesterTotalCost
    })
    await proofH.addVouch(requester, { from: voucher1 })
    await proofH.addVouch(requester, { from: voucher2 })

    await proofH.changeStateToPending(requester, [voucher1, voucher2], [], [], {
      from: governor
    })

    await proofH.challengeRequest(requester, 3, voucher1, '', {
      from: challenger1,
      value: arbitrationCost
    })
    await proofH.challengeRequest(requester, 3, voucher2, '', {
      from: challenger2,
      value: arbitrationCost
    })

    await arbitrator.giveRuling(1, 0)
    await arbitrator.giveRuling(2, 1)
    await time.increase(appealTimeOut + 1)
    await arbitrator.giveRuling(1, 0)
    await arbitrator.giveRuling(2, 1)

    let oldBalanceRequester = await web3.eth.getBalance(requester)
    await proofH.withdrawFeesAndRewards(requester, requester, 0, 0, 0, {
      from: governor
    })
    let newBalanceRequester = await web3.eth.getBalance(requester)
    assert(
      new BN(newBalanceRequester).eq(
        new BN(oldBalanceRequester).add(new BN(5142)) // 6000/7000 * 6000 = 5142.8
      ),
      'The balance of the requester is incorrect after withdrawing from 0 challenge'
    )
    // Only check the 1st challenger, because the 2nd challenger lost a dispute.
    const oldBalanceChallenger = await web3.eth.getBalance(challenger1)
    await proofH.withdrawFeesAndRewards(challenger1, requester, 0, 0, 0, {
      from: governor
    })
    const newBalanceChallenger = await web3.eth.getBalance(challenger1)
    assert(
      new BN(newBalanceChallenger).eq(
        new BN(oldBalanceChallenger).add(new BN(857)) // 1000/7000 * 6000 = 857.1
      ),
      'The balance of the challenger is incorrect after withdrawing from 0 challenge'
    )

    oldBalanceRequester = await web3.eth.getBalance(requester)
    await proofH.withdrawFeesAndRewards(requester, requester, 0, 1, 0, {
      from: governor
    })
    newBalanceRequester = await web3.eth.getBalance(requester)

    assert(
      new BN(newBalanceRequester).eq(new BN(oldBalanceRequester)),
      'The requester should not get any reward from 1 challenge'
    )
  })

  it('Should make governance changes', async () => {
    await expectRevert(
      proofH.addSubmissionManually([other], [''], [], { from: other }),
      'The caller must be the governor'
    )
    await expectRevert(
      proofH.removeSubmissionManually(voucher1, { from: other }),
      'The caller must be the governor'
    )
    // submissionBaseDeposit
    await expectRevert(
      proofH.changeSubmissionBaseDeposit(22, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeSubmissionBaseDeposit(22, { from: governor })
    assert.equal(
      (await proofH.submissionBaseDeposit()).toNumber(),
      22,
      'Incorrect submissionBaseDeposit value'
    )
    // submissionDuration, renewalPeriodDuration, challengePeriodDuration
    await expectRevert(
      proofH.changeDurations(128, 94, 14, { from: other }),
      'The caller must be the governor'
    )
    await expectRevert(
      proofH.changeDurations(28, 94, 14, { from: governor }),
      'Incorrect inputs'
    )

    await proofH.changeDurations(128, 94, 14, { from: governor })
    assert.equal(
      (await proofH.submissionDuration()).toNumber(),
      128,
      'Incorrect submissionDuration value'
    )
    assert.equal(
      (await proofH.renewalPeriodDuration()).toNumber(),
      94,
      'Incorrect renewalPeriodDuration value'
    )
    assert.equal(
      (await proofH.challengePeriodDuration()).toNumber(),
      14,
      'Incorrect challengePeriodDuration value'
    )
    // requiredNumberOfVouches
    await expectRevert(
      proofH.changeRequiredNumberOfVouches(1223, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeRequiredNumberOfVouches(1223, { from: governor })
    assert.equal(
      (await proofH.requiredNumberOfVouches()).toNumber(),
      1223,
      'Incorrect requiredNumberOfVouches value'
    )
    // sharedStakeMultiplier
    await expectRevert(
      proofH.changeSharedStakeMultiplier(555, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeSharedStakeMultiplier(555, { from: governor })
    assert.equal(
      (await proofH.sharedStakeMultiplier()).toNumber(),
      555,
      'Incorrect sharedStakeMultiplier value'
    )
    // winnerStakeMultiplier
    await expectRevert(
      proofH.changeWinnerStakeMultiplier(2001, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeWinnerStakeMultiplier(2001, { from: governor })
    assert.equal(
      (await proofH.winnerStakeMultiplier()).toNumber(),
      2001,
      'Incorrect winnerStakeMultiplier value'
    )
    // loserStakeMultiplier
    await expectRevert(
      proofH.changeLoserStakeMultiplier(9555, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeLoserStakeMultiplier(9555, { from: governor })
    assert.equal(
      (await proofH.loserStakeMultiplier()).toNumber(),
      9555,
      'Incorrect loserStakeMultiplier value'
    )
    // governor
    await expectRevert(
      proofH.changeGovernor(other, { from: other }),
      'The caller must be the governor'
    )
    await proofH.changeGovernor(other, { from: governor })
    assert.equal(await proofH.governor(), other, 'Incorrect governor value')
    // metaEvidenceUpdates
    await expectRevert(
      proofH.changeMetaEvidence('1', '2', { from: governor }),
      'The caller must be the governor' // Check that the old governor can't change variables anymore.
    )
    await proofH.changeMetaEvidence('1', '2', { from: other })
    let arbitratorData = await proofH.arbitratorDataList(1)
    assert.equal(
      arbitratorData[1].toNumber(),
      1,
      'Incorrect metaEvidenceUpdates value'
    )
    assert.equal(
      (await proofH.getArbitratorDataListCount()).toNumber(),
      2,
      'Incorrect arbitratorData length'
    )
    // arbitrator
    await expectRevert(
      proofH.changeArbitrator(governor, '0xff', { from: governor }),
      'The caller must be the governor'
    )
    await proofH.changeArbitrator(governor, '0xff', { from: other })
    arbitratorData = await proofH.arbitratorDataList(2)
    assert.equal(arbitratorData[0], governor, 'Incorrect arbitrator address')
    assert.equal(arbitratorData[2], '0xff', 'Incorrect extradata')
    assert.equal(
      (await proofH.getArbitratorDataListCount()).toNumber(),
      3,
      'Incorrect arbitratorData length'
    )
  })

  it('Should correctly withdraw the mistakenly added submission', async () => {
    await proofH.addSubmission('evidence1', '', {
      from: requester,
      value: requesterTotalCost * 0.4
    })

    await proofH.fundSubmission(requester, { from: other, value: 1e18 })

    const oldBalanceRequester = await web3.eth.getBalance(requester)
    const txWithdraw = await proofH.withdrawSubmission({
      from: requester,
      gasPrice: gasPrice
    })
    const txFee = txWithdraw.receipt.gasUsed * gasPrice

    const newBalanceRequester = await web3.eth.getBalance(requester)
    const submission = await proofH.getSubmissionInfo(requester)
    const request = await proofH.getRequestInfo(requester, 0)

    assert(
      new BN(newBalanceRequester).eq(
        new BN(oldBalanceRequester).add(
          new BN(requesterTotalCost * 0.4).sub(new BN(txFee))
        )
      ),
      'The requester has incorrect balance after withdrawal'
    )

    const oldBalanceCrowdfunder = await web3.eth.getBalance(other)
    await proofH.withdrawFeesAndRewards(other, requester, 0, 0, 0, {
      from: governor
    })
    const newBalanceCrowdfunder = await web3.eth.getBalance(other)
    assert(
      new BN(newBalanceCrowdfunder).eq(
        new BN(oldBalanceCrowdfunder).add(new BN(requesterTotalCost * 0.6))
      ),
      'The crowdfunder has incorrect balance after withdrawal'
    )

    assert.equal(
      submission[0].toNumber(),
      0,
      'Submission should have a default status'
    )
    assert.equal(request[1], true, 'The request should be resolved')

    await expectRevert(
      proofH.withdrawSubmission({ from: requester }),
      'Wrong status'
    )
  })

  it('Submission should not be registered after expiration', async () => {
    await time.increase(submissionDuration + 1)
    assert.equal(
      await proofH.isRegistered(voucher1),
      false,
      'The submission should not be registered'
    )
  })
})
