/* eslint-env node */
'use strict'

import { expect } from 'chai'

import { parseEther } from 'ethers-v6'
import { SubmitRetryableMessageDataParser } from '../../src/lib/message/messageDataParser'

describe('SubmitRetryableMessageDataParser', () => {
  it('does parse l1 to l2 message', async () => {
    const messageDataParser = new SubmitRetryableMessageDataParser()
    // taken from https://etherscan.io/tx/0x83636bc9e73b4065d1e5d69b52e43ec05a9430a0cb270c8f595ac22399fe3c20#eventlog
    const retryableData =
      '0x000000000000000000000000467194771DAE2967AEF3ECBEDD3BF9A310C76C650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030346F1C785E00000000000000000000000000000000000000000000000000000053280CF1490000000000000000000000007F869DC59A96E798E759030B3C39398BA584F0870000000000000000000000007F869DC59A96E798E759030B3C39398BA584F08700000000000000000000000000000000000000000000000000000000000210F100000000000000000000000000000000000000000000000000000000172C586500000000000000000000000000000000000000000000000000000000000001442E567B360000000000000000000000006B175474E89094C44DA98B954EEDEAC495271D0F0000000000000000000000007F869DC59A96E798E759030B3C39398BA584F0870000000000000000000000007F869DC59A96E798E759030B3C39398BA584F08700000000000000000000000000000000000000000000003871022F1082344C7700000000000000000000000000000000000000000000000000000000000000A000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

    const res = messageDataParser.parse(retryableData)

    expect(res.callValueRefundAddress).to.eq(
      '0x7F869dC59A96e798e759030b3c39398ba584F087'
    )
    expect(res.data).to.eq(
      '0x2E567B360000000000000000000000006B175474E89094C44DA98B954EEDEAC495271D0F0000000000000000000000007F869DC59A96E798E759030B3C39398BA584F0870000000000000000000000007F869DC59A96E798E759030B3C39398BA584F08700000000000000000000000000000000000000000000003871022F1082344C7700000000000000000000000000000000000000000000000000000000000000A000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    )
    expect(res.destAddress).to.eq('0x467194771dAe2967Aef3ECbEDD3Bf9a310C76C65')
    expect(res.excessFeeRefundAddress).to.eq(
      '0x7F869dC59A96e798e759030b3c39398ba584F087'
    )
    expect(res.gasLimit === BigInt('0x0210f1'), 'incorrect gas limit').to.be
      .true
    expect(res.l1Value === BigInt('0x30346f1c785e'), 'incorrect l1 value').to.be
      .true
    expect(res.l2CallValue === BigInt(0), 'incorrect l2 call value').to.be.true
    expect(
      res.maxFeePerGas === BigInt('0x172c5865'),
      'incorrect max fee per gas'
    ).to.be.true
    expect(
      res.maxSubmissionFee === BigInt('0x53280cf149'),
      'incorrect max submission fee'
    ).to.be.true
  })

  // left a separate test here for eth deposits done via a retryable
  // we dont normally use this method for depositing eth - we have a separate message type for that
  // but depositing eth via retryables is still valid so I've left this test here
  it('does parse eth deposit in an l1 to l2 message', async () => {
    const messageDataParser = new SubmitRetryableMessageDataParser()
    // taken from https://etherscan.io/tx/0xfe54a8166c62cf65468234c728249c28997904d6988913625ca5c4e249d06058#eventlog
    const retryableData =
      '0x000000000000000000000000F71946496600E1E1D47B8A77EB2F109FD82DC86A0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001A078F0000D790000000000000000000000000000000000000000000000000000000000370E285A0C000000000000000000000000F71946496600E1E1D47B8A77EB2F109FD82DC86A000000000000000000000000F71946496600E1E1D47B8A77EB2F109FD82DC86A000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

    const res = messageDataParser.parse(retryableData)

    expect(res.callValueRefundAddress).to.eq(
      '0xf71946496600e1e1d47b8A77EB2f109Fd82dc86a'
    )
    expect(res.data).to.eq('0x')
    expect(res.destAddress).to.eq('0xf71946496600e1e1d47b8A77EB2f109Fd82dc86a')
    expect(res.excessFeeRefundAddress).to.eq(
      '0xf71946496600e1e1d47b8A77EB2f109Fd82dc86a'
    )
    expect(res.gasLimit === BigInt(0), 'incorrect gas limit').to.be.true
    expect(res.l1Value === parseEther('30.01'), 'incorrect l1 value').to.be.true
    expect(res.l2CallValue === BigInt(0), 'incorrect l2 call value').to.be.true
    expect(res.maxFeePerGas === BigInt(0), 'incorrect max fee per gas').to.be
      .true
    expect(
      res.maxSubmissionFee === BigInt('0x370e285a0c'),
      'incorrect max submission fee'
    ).to.be.true
  })
})
