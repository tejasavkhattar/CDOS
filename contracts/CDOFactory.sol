pragma solidity ^0.4.18;

import "./CDO.sol";

/**
 * CDOFactory contract
 * This is a wrapper which spits instantiates and records new 
 * instances of CDOs
 */
contract CDOFactory {

	event CDOCreated(address indexed _cdo, address indexed _creator, bool squared);

	address[] public deployedCDOs;

	function createCDO(
		address _termsContract, 
		address _trancheToken,
		address _dummyToken
	) public {

		address cdo = new CDO(
			msg.sender,
			_termsContract,
			_trancheToken,
			_dummyToken,
			false
		);

		deployedCDOs.push(cdo);
		CDOCreated(cdo, msg.sender, false);
	}	
}