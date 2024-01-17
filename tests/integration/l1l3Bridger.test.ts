import {
  config,
  getSigner,
  setupNetworks,
  testSetup,
} from '../../scripts/testSetup'
import {
  Address,
  Erc20L1L3Bridger,
  L1Network,
  L1ToL2MessageStatus,
  L2Network,
  getL1Network,
  getL2Network,
} from '../../src'
import { L2ForwarderContractsDeployer__factory } from '../../src/lib/abi/factories/L2ForwarderContractsDeployer__factory'
import { TestERC20__factory } from '../../src/lib/abi/factories/TestERC20__factory'
import { TestERC20 } from '../../src/lib/abi/TestERC20'
import { L1Teleporter__factory } from '../../src/lib/abi/factories/L1Teleporter__factory'
import { fundL1, fundL2, skipIfMainnet } from './testHelpers'
import { BigNumber, ethers } from 'ethers'
import {
  EthL1L3Bridger,
  RelayedErc20L1L3Bridger,
} from '../../src/lib/assetBridger/l1l3Bridger'
import { expect } from 'chai'
import { networks } from '../../src/lib/dataEntities/networks'

type Unwrap<T> = T extends Promise<infer U> ? U : T

function poll(
  fn: () => Promise<boolean>,
  pollInterval: number
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const result = await fn()
        if (result === true) {
          clearInterval(interval)
          resolve(true)
        }
      } catch (e) {
        clearInterval(interval)
        reject(e)
      }
    }, pollInterval)
  })
}

describe('L1 to L3 Bridging', () => {
  // let setup: Unwrap<ReturnType<typeof testSetup>>
  const l2JsonRpcProvider = new ethers.providers.JsonRpcProvider(
    process.env['ARB_URL']
  )
  let l2Network: L2Network
  let l3Network: L2Network

  let l1Signer: ethers.Signer
  let l2Signer: ethers.Signer
  let l3Provider: ethers.providers.JsonRpcProvider

  // setup for all test cases
  before(async function () {
    await skipIfMainnet(this)

    const setup = await testSetup()

    l2Network = setup.l1Network as L2Network
    l3Network = setup.l2Network

    l1Signer = getSigner(
      new ethers.providers.JsonRpcProvider(process.env['ETH_URL']),
      ethers.utils.hexlify(ethers.utils.randomBytes(32))
    )
    l2Signer = getSigner(
      l2JsonRpcProvider,
      ethers.utils.hexlify(ethers.utils.randomBytes(32))
    )
    l3Provider = new ethers.providers.JsonRpcProvider(process.env['ORBIT_URL'])

    // fund signers on L1 and L2
    await fundL1(l1Signer, ethers.utils.parseEther('10'))
    await fundL2(l2Signer, ethers.utils.parseEther('10'))
  })

  describe('ETH Bridging', () => {
    describe('EthL1L3Bridger', () => {
      let l1l3Bridger: EthL1L3Bridger

      before(() => {
        l1l3Bridger = new EthL1L3Bridger(l3Network)
      })

      // send some eth to L3 with custom l3 recipient and l2 refund address
      // makes sure that appropriate amounts land at the right places
      it('happy path', async () => {
        const l3Recipient = ethers.utils.hexlify(ethers.utils.randomBytes(20))
        const l2RefundAddress = ethers.utils.hexlify(
          ethers.utils.randomBytes(20)
        )

        const depositTx = await l1l3Bridger.deposit(
          {
            amount: ethers.utils.parseEther('0.1'),
            to: l3Recipient,
            l2RefundAddress: l2RefundAddress,
          },
          l1Signer,
          l2Signer.provider!,
          l3Provider
        )

        const depositReceipt = await depositTx.wait()

        // poll status
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2Signer.provider!,
            l3Provider
          )
          return status.completed
        }, 1000)

        // check eth balances
        const l3Balance = await l3Provider.getBalance(l3Recipient)
        expect(l3Balance.gt(ethers.utils.parseEther('0.1'))).to.be.true

        const l2Balance = await l2Signer.provider!.getBalance(l2RefundAddress)
        expect(l2Balance.gt(ethers.utils.parseEther('0'))).to.be.true
      })
    })
  })

  describe('ERC20 Bridging', () => {
    let l1Token: TestERC20

    // deploy teleporter contracts and mock token
    before(async function () {
      // deploy teleporter contracts (todo: this should maybe be done in gen:network in the future)
      const l2ContractsDeployer =
        await new L2ForwarderContractsDeployer__factory(l2Signer).deploy()
      await l2ContractsDeployer.deployed()

      const l2ForwarderImplAddr = await l2ContractsDeployer.implementation()
      const l2ForwarderFactory = await l2ContractsDeployer.factory()

      const l1Teleporter = await new L1Teleporter__factory(l1Signer).deploy(
        l2ForwarderFactory,
        l2ForwarderImplAddr
      )
      await l1Teleporter.deployed()

      // set the teleporter on the l2Network
      l2Network.teleporterAddresses = {
        l1Teleporter: l1Teleporter.address,
        l2ForwarderFactory,
      }

      // deploy the mock token
      l1Token = await new TestERC20__factory(l1Signer).deploy()
      await l1Token.deployed()
      await (await l1Token.connect(l1Signer).mint()).wait()
    })

    describe('BaseErc20L1L3Bridger', () => {
      // use Erc20L1L3Bridger to test base class
      let l1l3Bridger: Erc20L1L3Bridger

      // create the bridger and approve the teleporter
      before(async () => {
        l1l3Bridger = new Erc20L1L3Bridger(l3Network)
      })

      it('getL2ERC20Address', async () => {
        // use weth to test, since we already know its addresses
        const l1Weth = l2Network.tokenBridge.l1Weth
        const l2Weth = l2Network.tokenBridge.l2Weth
        const ans = await l1l3Bridger.getL2ERC20Address(
          l1Weth,
          l1Signer.provider!
        )
        expect(ans).to.eq(l2Weth)
      })

      it('getL3ERC20Address', async () => {
        // use weth to test, since we already know its addresses
        const l1Weth = l2Network.tokenBridge.l1Weth
        const l3Weth = l3Network.tokenBridge.l2Weth
        const ans = await l1l3Bridger.getL3ERC20Address(
          l1Weth,
          l1Signer.provider!,
          l2Signer.provider!
        )
        expect(ans).to.eq(l3Weth)
      })

      it('getL1L2GatewayAddress', async () => {
        // test weth and default gateway
        const l1Weth = l2Network.tokenBridge.l1Weth
        const l1l2WethGateway = l2Network.tokenBridge.l1WethGateway

        const wethAns = await l1l3Bridger.getL1L2GatewayAddress(
          l1Weth,
          l1Signer.provider!
        )

        expect(wethAns).to.eq(l1l2WethGateway)

        // test default gateway
        const l1l2Gateway = l2Network.tokenBridge.l1ERC20Gateway
        const defaultAns = await l1l3Bridger.getL1L2GatewayAddress(
          l1Token.address,
          l1Signer.provider!
        )
        expect(defaultAns).to.eq(l1l2Gateway)
      })

      it('getL2L3GatewayAddress', async () => {
        // test weth and default gateway
        const l1Weth = l2Network.tokenBridge.l1Weth
        const l2l3WethGateway = l3Network.tokenBridge.l1WethGateway

        const wethAns = await l1l3Bridger.getL2L3GatewayAddress(
          l1Weth,
          l1Signer.provider!,
          l2Signer.provider!
        )

        expect(wethAns).to.eq(l2l3WethGateway)

        // test default gateway
        const l2l3Gateway = l3Network.tokenBridge.l1ERC20Gateway
        const defaultAns = await l1l3Bridger.getL2L3GatewayAddress(
          l1Token.address,
          l1Signer.provider!,
          l2Signer.provider!
        )
        expect(defaultAns).to.eq(l2l3Gateway)
      })

      // todo: disabled
    })

    describe('Erc20L1L3Bridger', () => {
      let l1l3Bridger: Erc20L1L3Bridger
      const amount = BigNumber.from(100)

      // create the bridger and approve the teleporter
      before(async () => {
        l1l3Bridger = new Erc20L1L3Bridger(l3Network)
      })

      it('approves', async () => {
        // approve the teleporter
        await (
          await l1l3Bridger.approveToken(
            {
              erc20L1Address: l1Token.address,
            },
            l1Signer
          )
        ).wait()
      })

      it('should throw if using non-default gateway and gas overrides not passed', async () => {
        try {
          await l1l3Bridger.getDepositRequest(
            {
              erc20L1Address: l2Network.tokenBridge.l1Weth,
              amount: BigNumber.from(1),
            },
            l1Signer,
            l2Signer.provider!,
            l3Provider
          )
          throw new Error()
        } catch (e: any) {
          expect(e.message).to.eq(
            'Cannot estimate gas for custom l1l2 gateway, please provide gas params'
          )
        }

        // l1 to l2 default but l2 to l3 gateway non default, we have to register a custom one
      })

      it('happy path', async () => {
        const l3Recipient = ethers.utils.hexlify(ethers.utils.randomBytes(20))

        const depositTx = await l1l3Bridger.deposit(
          {
            erc20L1Address: l1Token.address,
            to: l3Recipient,
            amount,
          },
          l1Signer,
          l2Signer.provider!,
          l3Provider
        )

        const depositReceipt = await depositTx.wait()

        // poll status
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
          return status.completed
        }, 1000)

        // make sure the tokens have landed in the right place
        const l3TokenAddr = await l1l3Bridger.getL3ERC20Address(
          l1Token.address,
          l1Signer.provider!,
          l2Signer.provider!
        )
        const l3Token = l1l3Bridger.getL3TokenContract(l3TokenAddr, l3Provider)

        const l3Balance = await l3Token.balanceOf(l3Recipient)

        expect(l3Balance.eq(amount)).to.be.true
      })

      it('should report correct status when second step is frontran', async () => {
        const adjustedL3GasPrice = (await l3Provider.getGasPrice()).mul(3)
        const depositTx = await l1l3Bridger.deposit(
          {
            erc20L1Address: l1Token.address,
            amount,
            overrides: {
              manualGasParams: {
                ...l1l3Bridger.defaultRetryableGasParams,
                l2ForwarderFactoryGasLimit: BigNumber.from(10), // make sure the second step retryable fails
              },
              l3GasPrice: {
                base: adjustedL3GasPrice,
                percentIncrease: BigNumber.from(0),
              },
            },
          },
          l1Signer,
          l2Signer.provider!,
          l3Provider
        )

        const depositReceipt = await depositTx.wait()

        // poll status until first step completes
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
          return status.bridgeToL2.status === L1ToL2MessageStatus.REDEEMED
        }, 1000)

        // make sure we have FUNDS_DEPOSITED_ON_L2 and undefined
        const statusAfterStep1 = await l1l3Bridger.getDepositStatus(
          depositReceipt,
          l2JsonRpcProvider,
          l3Provider
        )
        expect(statusAfterStep1.retryableL2ForwarderCall.status).to.eq(
          L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2
        )
        expect(statusAfterStep1.l2ForwarderCall).to.be.undefined
        expect(statusAfterStep1.bridgeToL3.status).to.eq(
          L1ToL2MessageStatus.NOT_YET_CREATED
        )

        // relay the second step (use the RelayedErc20L1L3Bridger to do this)
        const l1SignerAddr = await l1Signer.getAddress()
        const relayTx = await RelayedErc20L1L3Bridger.relayDeposit(
          {
            owner: new Address(l1SignerAddr).applyAlias().value,
            token: await l1l3Bridger.getL2ERC20Address(
              l1Token.address,
              l1Signer.provider!
            ),
            router: l3Network.tokenBridge.l1GatewayRouter,
            to: l1SignerAddr, // here we're doubling this test to make sure it defaults to the signer when "to" is not passed to deposit
            gasLimit:
              l1l3Bridger.defaultRetryableGasParams.l2l3TokenBridgeGasLimit,
            gasPrice: adjustedL3GasPrice,
            relayerPayment: BigNumber.from(0),
            chainId: l2Network.chainID,
          },
          l2Signer
        )

        await relayTx.wait()

        // make sure we get FUNDS_DEPOSITED_ON_L2 and the relay tx receipt
        const statusAfterStep2 = await l1l3Bridger.getDepositStatus(
          depositReceipt,
          l2JsonRpcProvider,
          l3Provider
        )
        expect(statusAfterStep2.bridgeToL2.status).to.eq(
          L1ToL2MessageStatus.REDEEMED
        )
        expect(statusAfterStep2.retryableL2ForwarderCall.status).to.eq(
          L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2
        )
        expect(statusAfterStep2.l2ForwarderCall?.transactionHash).to.eq(
          relayTx.hash
        )
        expect(statusAfterStep2.bridgeToL3.status).to.eq(
          L1ToL2MessageStatus.NOT_YET_CREATED
        )

        // make sure we get the correct final result on L3
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
          return status.completed
        }, 1000)

        const statusAfterStep3 = await l1l3Bridger.getDepositStatus(
          depositReceipt,
          l2JsonRpcProvider,
          l3Provider
        )
        expect(statusAfterStep3.completed).to.be.true
        expect(statusAfterStep3.retryableL2ForwarderCall.status).to.eq(
          L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2
        )
        expect(statusAfterStep3.l2ForwarderCall?.transactionHash).to.eq(
          relayTx.hash
        )
        expect(statusAfterStep3.bridgeToL3.status).to.eq(
          L1ToL2MessageStatus.REDEEMED
        )
      })
    })

    describe('RelayedErc20L1L3Bridger', () => {
      let l1l3Bridger: RelayedErc20L1L3Bridger
      const amount = BigNumber.from(200)

      // create the bridger and approve the teleporter
      before(async () => {
        l1l3Bridger = new RelayedErc20L1L3Bridger(l3Network)
      })

      it('approves', async () => {
        await (
          await l1l3Bridger.approveToken(
            {
              erc20L1Address: l1Token.address,
            },
            l1Signer
          )
        ).wait()
      })

      // should throw if gas overrides not passed when using non default gateway
      // test relayer stuff
      // don't need to test rescue here i think

      it('happy path', async () => {
        const l3Recipient = ethers.utils.getAddress(
          ethers.utils.hexlify(ethers.utils.randomBytes(20))
        )

        const depositResult = await l1l3Bridger.deposit(
          {
            erc20L1Address: l1Token.address,
            to: l3Recipient,
            amount,
          },
          l1Signer,
          l2Signer.provider!,
          l3Provider
        )

        const depositReceipt = await depositResult.tx.wait()

        // make sure relayer info was encoded correctly
        const parsedRelayerInfo =
          RelayedErc20L1L3Bridger.parseRelayerInfoFromTx({
            to: depositResult.tx.to!,
            data: depositResult.tx.data,
          })
        // include a hardcoded check so that the test fails if the data format changes
        expect(Object.keys(depositResult.relayerInfo).length).to.eq(8)

        expect(depositResult.relayerInfo.chainId)
          .to.eq(parsedRelayerInfo.chainId)
          .to.eq(l2Network.chainID)
        expect(depositResult.relayerInfo.owner).to.eq(parsedRelayerInfo.owner)
        expect(depositResult.relayerInfo.token).to.eq(parsedRelayerInfo.token)
        expect(depositResult.relayerInfo.router).to.eq(parsedRelayerInfo.router)
        expect(depositResult.relayerInfo.to).to.eq(parsedRelayerInfo.to)
        expect(
          BigNumber.from(depositResult.relayerInfo.gasLimit).eq(
            parsedRelayerInfo.gasLimit
          )
        ).to.be.true
        expect(
          BigNumber.from(depositResult.relayerInfo.gasPrice).eq(
            parsedRelayerInfo.gasPrice
          )
        ).to.be.true
        expect(
          BigNumber.from(depositResult.relayerInfo.relayerPayment).eq(
            parsedRelayerInfo.relayerPayment
          )
        ).to.be.true

        // wait until first step finishes
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
          return status.bridgeToL2.status === L1ToL2MessageStatus.REDEEMED
        }, 1000)

        // make sure status shows that l2 forwarder hasn't been called yet
        expect(
          (
            await l1l3Bridger.getDepositStatus(
              depositReceipt,
              l2JsonRpcProvider,
              l3Provider
            )
          ).l2ForwarderCall
        ).to.be.undefined

        // relay
        const relayTx = await RelayedErc20L1L3Bridger.relayDeposit(
          depositResult.relayerInfo,
          l2Signer
        )

        await relayTx.wait()

        // make sure status is updated
        expect(
          await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
        ).to.be.not.undefined

        // wait for third step to finish
        await poll(async () => {
          const status = await l1l3Bridger.getDepositStatus(
            depositReceipt,
            l2JsonRpcProvider,
            l3Provider
          )
          return status.completed
        }, 1000)

        // make sure the tokens have landed in the right place
        const l3TokenAddr = await l1l3Bridger.getL3ERC20Address(
          l1Token.address,
          l1Signer.provider!,
          l2Signer.provider!
        )
        const l3Token = l1l3Bridger.getL3TokenContract(l3TokenAddr, l3Provider)

        const l3Balance = await l3Token.balanceOf(l3Recipient)

        if (!l3Balance.eq(amount)) {
          throw new Error('L3 balance is incorrect')
        }
      })
    })
  })
})
