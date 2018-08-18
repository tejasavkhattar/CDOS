pragma solidity ^0.4.18;

import "zeppelin-solidity/contracts/token/ERC721/ERC721Token.sol";

contract TrancheToken is ERC721Token {
    /// mapping from tokenId's to CDO contract instances
    mapping(uint256 => address) internal tokenIdToCDO;

    uint256 internal _tokenIdCounter;

    function TrancheToken() public ERC721Token("Tranche Token", "TT"){}

    function mintCDOTrancheToken(address cdo, address _creator) public returns(uint256 tokenId){
        tokenId = _tokenIdCounter;
        super._mint(_creator, tokenId);
        tokenIdToCDO[tokenId] = cdo;
        _tokenIdCounter++;
    }
}