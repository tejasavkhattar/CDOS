import React, {Component} from 'react';
import web3 from '../utils/web3Config';
import Dharma from "@dharmaprotocol/dharma.js";

import DebtKernel from '../build/contracts/DebtKernel.json';
import DebtRegistry from '../build/contracts/DebtRegistry.json';
import DebtToken from '../build/contracts/DebtToken.json';
import DummyToken from '../build/contracts/DummyToken.json';
import TokenRegistry from '../build/contracts/TokenRegistry.json';
import RepaymentRouter from '../build/contracts/RepaymentRouter.json';
import SimpleInterestTermsContract from '../build/contracts/SimpleInterestTermsContract.json';
import TokenTransferProxy from '../build/contracts/TokenTransferProxy.json';

import CDOFactory from '../build/contracts/CDOFactory.json';
import TrancheToken from '../build/contracts/TrancheToken.json';

import getContractInstance from '../utils/getContract';
export default class Index extends Component{

	state = {};

	static async getInitialProps(){
		const debtKernel = await getContractInstance(DebtKernel);
		return { address:debtKernel.address};
	}

	render(){
		return(
			<body>
				<h1>Hello world</h1>
				<h1>{this.props.address}</h1>
			</body>
		);
	}
}