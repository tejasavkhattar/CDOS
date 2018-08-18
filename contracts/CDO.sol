pragma solidity ^0.4.18;

// Internal dependencies
import "./TermsContract.sol";
import "./test/dummy_tokens/DummyToken.sol";

// External dependencies
import "zeppelin-solidity/contracts/token/ERC721/ERC721Receiver.sol";
import "./TrancheToken.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * The CDO contract does this and that...
 */
contract CDO is ERC721Receiver{
    using SafeMath for *;

    address public creator;
    bool public finalized;
    uint public expectedRepayment;

    //3 tranches ->> 1 tranache tokenID = 5% of CDO value
    uint256[5] public seniors;
    uint256[3] public mezzanines;
    uint256[2] public juniors;

    uint256[] public underlyingDebtAssets;
    // mapping of tranche token ID to repayment entitlements
    mapping(uint256 => uint) internal entitlements;

    bool public squared;

    //tokenID to tranchID
    mapping (uint256 => uint256) tokenIDToTranch;

    TermsContract internal termsContract;
    TrancheToken internal trancheToken;
    DummyToken internal principalToken;

    // uint internal totalWithdrawn;
    uint internal seniorWithdrawn=0;
    uint internal mezzanineWithdrawn=0;
    uint internal juniorWithdrawn=0;

    event CDOFinalized(uint _timestamp);
    
    function CDO(address _creator,
        address _termsContract,
        address _tranchToken,
        address _pricipalToken,
        bool _squared
    ) public {
        creator = _creator;
        termsContract = TermsContract(_termsContract);
        trancheToken = TrancheToken(_tranchToken);
        principalToken = DummyToken(_pricipalToken);
        squared = _squared;
        finalized = false;

        // the following sets `creator` as the owner
        // of all CDO shares/NF Tranche tokens
        for(uint i=0; i<seniors.length; i++){
            seniors[i] = trancheToken.mintCDOTrancheToken(this, creator);
            tokenIDToTranch[seniors[i]] = 1;
        }

        for(i=0; i<mezzanines.length; i++){
            mezzanines[i] = trancheToken.mintCDOTrancheToken(this, creator);
            tokenIDToTranch[mezzanines[i]] = 2;
        }

        for(i=0; i<juniors.length; i++){
            juniors[i] = trancheToken.mintCDOTrancheToken(this, creator);
            tokenIDToTranch[juniors[i]] = 3;
        }
    }

    /**
     * Receive debt repayment
     */
    function () public payable {}

    /**
     * Receive `DebtToken`s, the underlying debts of this CDO.
     */
    function onERC721Received(
        address _from,
        uint256 _tokenId,
        bytes
    )
        public
        returns(bytes4)
    {
        require(!finalized);
        require(_from == creator);
        expectedRepayment = expectedRepayment.add(
            termsContract.getExpectedRepaymentValue(
                bytes32(_tokenId),
                termsContract.getTermEndTimestamp(bytes32(_tokenId))
            )
        );

        underlyingDebtAssets.push(_tokenId);

        return ERC721Receiver.ERC721_RECEIVED;
    }

    /**
     * Functions only to be called by the CDO creator
     */

    function finalize() public{
        require (!finalized);
        require(msg.sender == creator);
        require(underlyingDebtAssets.length == 3);
        finalized = true;
        CDOFinalized(block.timestamp);
    }

    /**
     * Public Functions
     */

     function getTotalUnderlyingDebtAssets() public view returns(uint)  {
         return underlyingDebtAssets.length;
     }
     
    // senior tranche consists of 50% of CDO
    function getTotalSeniorsPayout() public view returns(uint){
        return (expectedRepayment.mul(50)).div(100);
    }

    // mezzanine tranche consists of 30% of CDO
    function getTotalMezzaninesPayout() public view returns(uint){
        return (expectedRepayment.mul(30)).div(100);
    }

    // junior tranche consists of 20% of CDO
    function getTotalJuniorsPayout() public view returns(uint){
        return (expectedRepayment.mul(20)).div(100);
    }

    function seniorEntitlements()
        public
        view
        returns (uint)
    {
        uint _seniorEntitlements;
        for (uint i=0; i < seniors.length; i++) {
            _seniorEntitlements += entitlements[seniors[i]];
        }
        return _seniorEntitlements;
    }

    function mezzanineEntitlements()
        public
        view
        returns (uint)
    {
        uint _mezzanineEntitlements;
        for (uint i=0; i < mezzanines.length; i++) {
            _mezzanineEntitlements += entitlements[mezzanines[i]];
        }
        return _mezzanineEntitlements;
    }

    function juniorEntitlements()
        public
        view
        returns (uint)
    {
        uint _juniorEntitlements;
        for (uint i=0; i < juniors.length; i++) {
            _juniorEntitlements += entitlements[juniors[i]];
        }
        return _juniorEntitlements;
    }

    function allocatedEntitlements()
        public
        view
        returns (uint)
    {
        return seniorEntitlements() + mezzanineEntitlements() + juniorEntitlements();
    }

    function remainingSeniorEntitlement() public returns(uint){
        return getTotalSeniorsPayout() - seniorWithdrawn - seniorEntitlements();
    }

    function remainingMezzanineEntitlement() public returns(uint){
        return getTotalMezzaninesPayout() - mezzanineWithdrawn - mezzanineEntitlements();
    }

    function remainingJuniorEntitlement() public returns(uint){
        return getTotalJuniorsPayout() - juniorWithdrawn - juniorEntitlements();
    }

    // updates entitlement states for each tranche whenever called &
    // then transfers valid entitlement to "_to", if any
    //TO-DO -> implement a mechanism where tranche tokens are minted on-demand
    // when someone invests in the CDO 
    // ERROR - This function reverts if too many tranche tokens need to be minted
    function withdraw(uint256 _tokenId, address _to) public {
        require(trancheToken.ownerOf(_tokenId) == msg.sender);
        require(finalized);

        uint unallocatedEntitlements =
            principalToken.balanceOf(this) - allocatedEntitlements();

        if(unallocatedEntitlements > 0){
            uint256 unallocatedSeniorEntitlements = 
            (unallocatedEntitlements < remainingSeniorEntitlement())
            ?unallocatedEntitlements: remainingSeniorEntitlement();

            for(uint i=0; i<seniors.length; i++){
                entitlements[seniors[i]] += unallocatedSeniorEntitlements/seniors.length;
            }

            unallocatedEntitlements.sub(unallocatedSeniorEntitlements);

            if(unallocatedEntitlements > 0){
                uint256 unallocatedMezzanineEntitlements = 
                (unallocatedEntitlements < remainingMezzanineEntitlement())
                ?unallocatedEntitlements: remainingMezzanineEntitlement();

                for(i=0; i<mezzanines.length; i++){
                    entitlements[mezzanines[i]]+= unallocatedMezzanineEntitlements/mezzanines.length;
                }

                unallocatedEntitlements.sub(unallocatedMezzanineEntitlements);

                if(unallocatedEntitlements > 0){
                    uint256 unallocatedJuniorEntitlements = unallocatedEntitlements;
                }

                for(i=0; i<juniors.length; i++){
                    entitlements[juniors[i]]+= unallocatedJuniorEntitlements/juniors.length;
                }
            }
        }

        //entitlements updates completed

        uint entitlement = entitlements[_tokenId];
        require (entitlement >0);
        entitlements[_tokenId] = 0;
        if(tokenIDToTranch[_tokenId] == 1){
            seniorWithdrawn += entitlement;
        }else if(tokenIDToTranch[_tokenId] == 2){
            mezzanineWithdrawn += entitlement;
        }else if(tokenIDToTranch[_tokenId] == 3){
            juniorWithdrawn += entitlement;
        }

        principalToken.transfer(_to, entitlement);
    }
}