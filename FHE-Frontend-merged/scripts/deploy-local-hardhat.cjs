const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC_URL = 'http://127.0.0.1:8545';
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FIRST_DEPLOYMENT_NONCE = 13;

// These are the addresses intentionally used by src/config/contracts.ts and
// FHE-Protocol/deployments.json for the local Hardhat demonstration.
const expectedAddresses = {
  AccessControl: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  UserRegistryContract: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  BankRegistryContract: '0x0B306BF915C4d645ff596e518fAf3F9669b97016',
  DataStorageContract: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
  TaskManagementContract: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE'
};

const artifact = (name) => {
  const artifactPath = path.resolve(
    process.cwd(),
    '../FHE-Protocol/artifacts/contracts',
    `${name}.sol`,
    `${name}.json`
  );
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
};

const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (network.chainId !== 20200) {
    throw new Error(`Expected local Hardhat chain 20200, received ${network.chainId}`);
  }

  const signer = provider.getSigner(DEPLOYER);
  let nonce = await provider.getTransactionCount(DEPLOYER);
  if (nonce > FIRST_DEPLOYMENT_NONCE) {
    throw new Error(
      `Deployer nonce is ${nonce}; start a fresh Hardhat node before deploying this demo.`
    );
  }

  // The repository deployment addresses were created beginning at nonce 13.
  // Padding only the ephemeral local chain preserves those addresses without
  // modifying FHE-Protocol/deployments.json.
  while (nonce < FIRST_DEPLOYMENT_NONCE) {
    const paddingTx = await signer.sendTransaction({ to: DEPLOYER, value: 0 });
    await paddingTx.wait();
    nonce += 1;
  }

  const deploy = async (name, args = []) => {
    const source = artifact(name);
    const factory = new ethers.ContractFactory(source.abi, source.bytecode, signer);
    const contract = await factory.deploy(...args);
    await contract.deployTransaction.wait();
    const expected = expectedAddresses[name];
    if (!sameAddress(contract.address, expected)) {
      throw new Error(`${name} deployed to ${contract.address}; expected ${expected}`);
    }
    console.log(`${name}: ${contract.address}`);
    return contract.address;
  };

  const accessControl = await deploy('AccessControl');
  await deploy('UserRegistryContract', [accessControl]);
  await deploy('BankRegistryContract', [accessControl]);
  await deploy('DataStorageContract', [accessControl]);
  await deploy('TaskManagementContract', [accessControl]);
  console.log('Local contracts match the merged frontend configuration.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
