const CDOFactory = artifacts.require("CDOFactory");
const TrancheToken = artifacts.require("TrancheToken");

module.exports = (deployer) => {
  deployer.deploy(TrancheToken);
  deployer.deploy(CDOFactory);
};