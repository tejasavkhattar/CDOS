import { BigNumber } from "bignumber.js";

import * as ABIDecoder from "abi-decoder";
import * as chai from "chai";
import * as _ from "lodash";
import * as moment from "moment";
import * as Web3 from "web3";
import * as Units from "./test_utils/units";
import * as utils from "./test_utils/utils";

import { DebtKernelContract } from "../../types/generated/debt_kernel";
import { DebtRegistryContract } from "../../types/generated/debt_registry";
import { DebtTokenContract } from "../../types/generated/debt_token";
import { DummyTokenContract } from "../../types/generated/dummy_token";
import { TokenRegistryContract } from "../../types/generated/token_registry";
import { RepaymentRouterContract } from "../../types/generated/repayment_router";
import { SimpleInterestTermsContractContract as SimpleInterestTermsContract } from "../../types/generated/simple_interest_terms_contract";
import { TokenTransferProxyContract } from "../../types/generated/token_transfer_proxy";

import { DebtKernelErrorCodes } from "../../types/errors";
import { DebtOrder, SignedDebtOrder } from "../../types/kernel/debt_order";

import { BigNumberSetup } from "./test_utils/bignumber_setup";
import ChaiSetup from "./test_utils/chai_setup";
import { INVALID_OPCODE, REVERT_ERROR } from "./test_utils/constants";

import { SimpleInterestParameters } from "./factories/terms_contract_parameters";
import { DebtOrderFactory } from "./factories/debt_order_factory";

import { CDOFactoryContract } from "../../types/generated/c_d_o_factory";
import { CDOContract } from "../../types/generated/cdo";
import { TrancheTokenContract } from "../../types/generated/tranche_token";

import { TxDataPayable } from "../../types/common";

import leftPad = require("left-pad");

// Configure BigNumber exponentiation
BigNumberSetup.configure();

// Set up Chai
ChaiSetup.configure();
const expect = chai.expect;

// const simpleInterestTermsContract = artifacts.require("SimpleInterestTermsContract");
// const CDOFactory = artifacts.require("CDOFactory");
// const CDO = artifacts.require("CDO");
// const TrancheToken = artifacts.require("TrancheToken");

contract("Collateralized Debt Obligation", async (ACCOUNTS) => {
    let repaymentRouter: RepaymentRouterContract;
    let kernel: DebtKernelContract;
    let debtToken: DebtTokenContract;
    let principalToken: DummyTokenContract;
    let termsContract: SimpleInterestTermsContract;
    let tokenTransferProxy: TokenTransferProxyContract;

    let cdoFactory: CDOFactoryContract;
    let cdo : CDOContract;
    let trancheToken : TrancheTokenContract;

    let orderFactory: DebtOrderFactory;

    const CONTRACT_OWNER = ACCOUNTS[0];

    const DEBTOR_1 = ACCOUNTS[1];
    const DEBTOR_2 = ACCOUNTS[2];
    const DEBTOR_3 = ACCOUNTS[3];
    const DEBTORS = [DEBTOR_1, DEBTOR_2, DEBTOR_3];

    const CREDITOR_1 = ACCOUNTS[4];
    const CREDITOR_2 = ACCOUNTS[5];
    const CREDITOR_3 = ACCOUNTS[6];
    const CREDITORS = [CREDITOR_1, CREDITOR_2, CREDITOR_3];

    const PAYER = ACCOUNTS[7];

    const LOAN_AGGREGATOR = ACCOUNTS[9];

    const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

    const TX_DEFAULTS = { from: CONTRACT_OWNER, gas: 4000000 };

    let tokenIds : BigNumber[] = new Array();

    let agreementIds : string[] = new Array();

    before(async () => {
        const dummyTokenRegistryContract = await TokenRegistryContract.deployed(web3, TX_DEFAULTS);
        const dummyREPTokenAddress = await dummyTokenRegistryContract.getTokenAddressBySymbol.callAsync(
            "REP",
        );
        const dummyREPTokenIndex = await dummyTokenRegistryContract.getTokenIndexBySymbol.callAsync(
            "REP",
        );

        principalToken = await DummyTokenContract.at(dummyREPTokenAddress, web3, TX_DEFAULTS);

        kernel = await DebtKernelContract.deployed(web3, TX_DEFAULTS);
        debtToken = await DebtTokenContract.deployed(web3, TX_DEFAULTS);
        tokenTransferProxy = await TokenTransferProxyContract.deployed(web3, TX_DEFAULTS);
        termsContract = await SimpleInterestTermsContract.deployed(web3, TX_DEFAULTS);
        repaymentRouter = await RepaymentRouterContract.deployed(web3, TX_DEFAULTS);
        cdoFactory = await CDOFactoryContract.deployed(web3, TX_DEFAULTS);
        trancheToken = await TrancheTokenContract.deployed(web3, TX_DEFAULTS);

        await principalToken.setBalance.sendTransactionAsync(CREDITOR_1, Units.ether(100));
        await principalToken.setBalance.sendTransactionAsync(CREDITOR_2, Units.ether(100));
        await principalToken.setBalance.sendTransactionAsync(CREDITOR_3, Units.ether(100));

        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: DEBTOR_1 },
        );
        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: DEBTOR_2 },
        );
        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: DEBTOR_3 },
        );

        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: CREDITOR_1 },
        );
        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: CREDITOR_2 },
        );
        await principalToken.approve.sendTransactionAsync(
            tokenTransferProxy.address,
            Units.ether(100),
            { from: CREDITOR_3 },
        );

        const termsContractParameters = SimpleInterestParameters.pack({
            principalTokenIndex: dummyREPTokenIndex, // Our migrations set REP up to be at index 0 of the registry
            principalAmount: Units.ether(1), // principal of 1 ether
            interestRateFixedPoint: Units.interestRateFixedPoint(2.5), // interest rate of 2.5%
            amortizationUnitType: new BigNumber(1), // The amortization unit type (weekly)
            termLengthUnits: new BigNumber(4), // Term length in amortization units.
        });

        const defaultOrderParams = {
            creditorFee: Units.ether(0),
            debtKernelContract: kernel.address,
            debtOrderVersion: kernel.address,
            debtTokenContract: debtToken.address,
            debtor: DEBTOR_1,
            debtorFee: Units.ether(0),
            expirationTimestampInSec: new BigNumber(
                moment()
                    .add(1, "days")
                    .unix(),
            ),
            issuanceVersion: repaymentRouter.address,
            orderSignatories: { debtor: DEBTOR_1, creditor: CREDITOR_1 },
            principalAmount: Units.ether(1),
            principalTokenAddress: principalToken.address,
            relayer: NULL_ADDRESS,
            relayerFee: Units.ether(0),
            termsContract: termsContract.address,
            termsContractParameters,
            underwriter: NULL_ADDRESS,
            underwriterFee: Units.ether(0),
            underwriterRiskRating: Units.underwriterRiskRatingFixedPoint(0),
        };

        orderFactory = new DebtOrderFactory(defaultOrderParams);

        ABIDecoder.addABI(repaymentRouter.abi);
    });

    after(() => {
        ABIDecoder.removeABI(repaymentRouter.abi);
    });

    describe("CDO Tests", () => {
        let signedDebtOrder: SignedDebtOrder;
        let agreementId: string;
        let receipt: Web3.TransactionReceipt;

        before(async () => {
            // NOTE: For purposes of this assignment, we hard code a default principal + interest amount of 1.1 ether
            // If you're interested in how to vary this amount, poke around in the setup code above :)
            signedDebtOrder = await orderFactory.generateDebtOrder({
                creditor: CREDITOR_2,
                debtor: DEBTOR_2,
                orderSignatories: { debtor: DEBTOR_2, creditor: CREDITOR_2 },
            });

            // The unique id we use to refer to the debt agreement is the hash of its associated issuance commitment.
            agreementId = signedDebtOrder.getIssuanceCommitment().getHash();

            // Creditor fills the signed debt order, creating a debt agreement with a unique associated debt token
            const txHash = await kernel.fillDebtOrder.sendTransactionAsync(
                signedDebtOrder.getCreditor(),
                signedDebtOrder.getOrderAddresses(),
                signedDebtOrder.getOrderValues(),
                signedDebtOrder.getOrderBytes32(),
                signedDebtOrder.getSignaturesV(),
                signedDebtOrder.getSignaturesR(),
                signedDebtOrder.getSignaturesS(),
            );

            receipt = await web3.eth.getTransactionReceipt(txHash);
        });

        it("should issue creditor a unique debt token", async () => {
            await expect(
                debtToken.ownerOf.callAsync(new BigNumber(agreementId)),
            ).to.eventually.equal(CREDITOR_2);

            const expectedTermEnd:BigNumber = await termsContract.getTermEndTimestamp.callAsync(
                agreementId
            );

            const expectedRepayment:BigNumber = await termsContract.getExpectedRepaymentValue.callAsync(
                agreementId,
                expectedTermEnd
            );

            console.log("expected value :", web3.fromWei(expectedRepayment.toNumber(), "ether"));
        });

        it("should allow debtor to make repayment", async () => {
            const creditorBalanceBefore = await principalToken.balanceOf.callAsync(CREDITOR_2);

            await repaymentRouter.repay.sendTransactionAsync(
                agreementId,
                Units.ether(1), // amount
                principalToken.address, // token type
                { from: DEBTOR_2 },
            );

            await expect(
                principalToken.balanceOf.callAsync(CREDITOR_2),
            ).to.eventually.bignumber.equal(creditorBalanceBefore.plus(Units.ether(1)));
        });

        it("should allow creditor to transfer debt token to different address", async () => {
            await debtToken.transfer.sendTransactionAsync(
                CREDITOR_1, // to
                new BigNumber(agreementId), // tokenId
                { from: CREDITOR_2 },
            );

            await expect(
                debtToken.ownerOf.callAsync(new BigNumber(agreementId)),
            ).to.eventually.equal(CREDITOR_1);
        });

        it("should allow creation of multiple debt agreements", async() => {
            let i: number;
            for(i=0; i<DEBTORS.length; i++){
                signedDebtOrder = await orderFactory.generateDebtOrder({
                    creditor: CREDITORS[i],
                    debtor: DEBTORS[i],
                    orderSignatories: { debtor: DEBTORS[i], creditor: CREDITORS[i] },
                });

                // The unique id we use to refer to the debt agreement is the hash of its associated issuance commitment.
                agreementId = signedDebtOrder.getIssuanceCommitment().getHash();
                tokenIds.push(new BigNumber(agreementId));
                agreementIds.push(agreementId);

                // Creditor fills the signed debt order, creating a debt agreement with a unique associated debt token
                const txHash = await kernel.fillDebtOrder.sendTransactionAsync(
                    signedDebtOrder.getCreditor(),
                    signedDebtOrder.getOrderAddresses(),
                    signedDebtOrder.getOrderValues(),
                    signedDebtOrder.getOrderBytes32(),
                    signedDebtOrder.getSignaturesV(),
                    signedDebtOrder.getSignaturesR(),
                    signedDebtOrder.getSignaturesS(),
                );

                receipt = await web3.eth.getTransactionReceipt(txHash);

                await expect(
                    debtToken.ownerOf.callAsync(tokenIds[i]),
                ).to.eventually.equal(CREDITORS[i]);

                //transfer debt tokens to a loan agreegator
                await debtToken.transfer.sendTransactionAsync(
                    LOAN_AGGREGATOR, // to
                    tokenIds[i], // tokenId
                    { from: CREDITORS[i] },
                );

                //check new owner is Loan aggregator
                await expect(
                    debtToken.ownerOf.callAsync(tokenIds[i]),
                ).to.eventually.equal(LOAN_AGGREGATOR);
            }

            expect(tokenIds.length).to.equal(DEBTORS.length);
        });

        // before(async () => {
        //     await
        // });

        it("should allow a LOAN_AGGREGATOR to create a CDO via CDOFactory", async()=>{

            const txHash = await cdoFactory.createCDO.sendTransactionAsync(
                termsContract.address,
                trancheToken.address,
                principalToken.address,
                { from: LOAN_AGGREGATOR }
            );

            // console.log("txHash: ", txHash);
            receipt = await web3.eth.getTransactionReceipt(txHash);
            // console.log("receipt :", receipt);

            const _cdoAddress = await cdoFactory.deployedCDOs.callAsync(new BigNumber(0));
            cdo = await CDOContract.at(_cdoAddress, web3, TX_DEFAULTS);

            await expect(
                cdo.creator.callAsync()
            ).to.eventually.equal(LOAN_AGGREGATOR);

            await expect(
                cdo.squared.callAsync()
            ).to.eventually.equal(false);

            await expect(
                cdo.finalized.callAsync()
            ).to.eventually.equal(false);

            await expect(
                cdo.expectedRepayment.callAsync()
            ).to.eventually.bignumber.equal(0);

            await expect(
                cdo.expectedRepayment.callAsync()
            ).to.eventually.bignumber.equal(0);
        });

        it("should fail if CDO creator to finalize the CDO before adding debt assets", async()=>{
            await expect(
                cdo.finalize.sendTransactionAsync({ from: LOAN_AGGREGATOR })
            ).to.eventually.be.rejectedWith(REVERT_ERROR);
        });

        it("should update underlyingDebtAssets with 3 DebtTokens", async()=>{
            let i: number;
            for(i=0; i<tokenIds.length; i++){
                //transfer debt tokens to CDO
                await debtToken.transfer.sendTransactionAsync(
                    cdo.address, // to
                    tokenIds[i], // tokenId
                    { from: LOAN_AGGREGATOR }
                );
                await expect(
                    debtToken.ownerOf.callAsync(tokenIds[i]),
                ).to.eventually.equal(cdo.address);

                const collateralTokenId : BigNumber = await cdo.underlyingDebtAssets.callAsync(
                    new BigNumber(i)
                );
                expect(collateralTokenId).to.bignumber.equal(tokenIds[i]);
            }

            console.log("total expected repayment = ", web3.fromWei(
                (await cdo.expectedRepayment.callAsync()).toNumber(),
                "ether"
                )
            );
        });

        it("should allow CDO creator to finalize the CDO after all debt tokens have been added", async()=>{
            await cdo.finalize.sendTransactionAsync({ from: LOAN_AGGREGATOR });

            await expect(
                cdo.finalized.callAsync()
            ).to.eventually.equal(true);
        });

        it("creator must be the owner of all tranche tokens", async()=>{

            const nftSenior = await cdo.seniors.callAsync(new BigNumber(0));
            await expect(
                trancheToken.ownerOf.callAsync(nftSenior)
            ).to.eventually.equal(LOAN_AGGREGATOR);
        });
        it("CDO should allow repayments", async()=>{
            await principalToken.setBalance.sendTransactionAsync(DEBTORS[0], Units.ether(1.25));
            const debtorBalanceBefore = await principalToken.balanceOf.callAsync(DEBTORS[0]);
            const creditorBalanceBefore = await principalToken.balanceOf.callAsync(cdo.address);

            const txHash = await repaymentRouter.repay.sendTransactionAsync(
                agreementIds[0],
                Units.ether(1.025), // amount
                principalToken.address, // token type
                { from: DEBTORS[0] },
            );

            receipt = await web3.eth.getTransactionReceipt(txHash);

            const debtorBalanceAfter = await principalToken.balanceOf.callAsync(DEBTORS[0]);
            const creditorBalanceAfter = await principalToken.balanceOf.callAsync(cdo.address);

            await expect(
                principalToken.balanceOf.callAsync(cdo.address),
            ).to.eventually.bignumber.equal(creditorBalanceBefore.plus(Units.ether(1.025)));

        });

        it("person should be able to withdraw funds from senior tranche", async()=>{
            const nftSenior = await cdo.seniors.callAsync(new BigNumber(0));
            const creatorBalanceBefore = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            await expect(
              trancheToken.ownerOf.callAsync(nftSenior)
            ).to.eventually.equal(LOAN_AGGREGATOR);

            const txHash = await cdo.withdraw.sendTransactionAsync(
                nftSenior,
                LOAN_AGGREGATOR,
                {from:LOAN_AGGREGATOR}
            );

            const creatorBalanceAfter = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);

            await expect(
                principalToken.balanceOf.callAsync(LOAN_AGGREGATOR),
            ).to.eventually.bignumber.equal(creatorBalanceBefore.plus(Units.ether(0.205)));
        });

        it("person owning a slice of mezzanine/junior tranche should not receive anything", async ()=>{
            const nftMezzanine = await cdo.mezzanines.callAsync(new BigNumber(0));
            const creatorBalanceBefore = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('before | mezzanine : ', web3.fromWei(creatorBalanceBefore.toNumber(), 'ether'));

            await cdo.withdraw.sendTransactionAsync(
              nftMezzanine,
              LOAN_AGGREGATOR,
              {from:LOAN_AGGREGATOR}
            );

            const creatorBalanceAfter = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('after | mezzanine: ', web3.fromWei(creatorBalanceAfter.toNumber(), 'ether'));
            await expect(
                principalToken.balanceOf.callAsync(LOAN_AGGREGATOR),
            ).to.eventually.bignumber.equal(creatorBalanceBefore);

            const nftJunior = await cdo.juniors.callAsync(new BigNumber(0));
            const creatorBalanceBeforeJ = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('before | mezzanine : ', web3.fromWei(creatorBalanceBeforeJ.toNumber(), 'ether'));

            await cdo.withdraw.sendTransactionAsync(
              nftJunior,
              LOAN_AGGREGATOR,
              {from:LOAN_AGGREGATOR}
            );

            const creatorBalanceAfterJ = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('after | junior : ', web3.fromWei(creatorBalanceAfterJ.toNumber(), 'ether'));
            await expect(
                principalToken.balanceOf.callAsync(LOAN_AGGREGATOR),
            ).to.eventually.bignumber.equal(creatorBalanceBeforeJ);
        });

        it("should update entitlements when 2nd loan is repaid", async()=>{
            await repaymentRouter.repay.sendTransactionAsync(
                agreementIds[1],
                Units.ether(1.025), // amount
                principalToken.address, // token type
                { from: DEBTORS[1] },
            );

            const nftMezzanine = await cdo.mezzanines.callAsync(new BigNumber(1));
            const creatorBalanceBefore = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('before: ', web3.fromWei(creatorBalanceBefore.toNumber(), 'ether'));
            
            await expect(
              trancheToken.ownerOf.callAsync(nftMezzanine)
            ).to.eventually.equal(LOAN_AGGREGATOR);

            await cdo.withdraw.sendTransactionAsync(
              nftMezzanine,
              LOAN_AGGREGATOR,
              {from:LOAN_AGGREGATOR}
            );

            const creatorBalanceAfter = await principalToken.balanceOf.callAsync(LOAN_AGGREGATOR);
            console.log('after: ', web3.fromWei(creatorBalanceAfter.toNumber(), 'ether'));
            await expect(
                principalToken.balanceOf.callAsync(LOAN_AGGREGATOR),
            ).to.eventually.bignumber.equal(creatorBalanceBefore.plus(Units.ether(0.5125/3)));
        });
    });
});