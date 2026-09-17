const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC_URL = 'http://127.0.0.1:8545';
const API_URL = 'http://127.0.0.1:3000';
const FAUCET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const addresses = {
  userRegistry: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  bankRegistry: '0x0B306BF915C4d645ff596e518fAf3F9669b97016',
  dataStorage: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
  taskManagement: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE'
};

const artifact = (name) => JSON.parse(fs.readFileSync(path.resolve(
  process.cwd(), '../FHE-Protocol/artifacts/contracts', `${name}.sol`, `${name}.json`
), 'utf8'));

async function api(pathname, body) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const faucet = provider.getSigner(FAUCET);
  const clientWallet = ethers.Wallet.createRandom();
  const bankWallet = ethers.Wallet.createRandom();

  // This is the same RPC signer and wait-for-confirmation model used by both
  // wallet modal implementations, without storing a private key in source.
  for (const wallet of [clientWallet, bankWallet]) {
    const funding = await faucet.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther('10')
    });
    await funding.wait();
    const balance = await provider.getBalance(wallet.address);
    if (!balance.eq(ethers.utils.parseEther('10'))) {
      throw new Error(`Funding confirmation failed for ${wallet.address}`);
    }
  }

  const client = clientWallet.connect(provider);
  const bank = bankWallet.connect(provider);
  const keys = await api('/generate_keys', { public_key: client.address });
  const userRegistry = new ethers.Contract(addresses.userRegistry, artifact('UserRegistryContract').abi, client);
  const bankRegistry = new ethers.Contract(addresses.bankRegistry, artifact('BankRegistryContract').abi, bank);
  const dataStorage = new ethers.Contract(addresses.dataStorage, artifact('DataStorageContract').abi, bank);
  const taskManagementForClient = new ethers.Contract(addresses.taskManagement, artifact('TaskManagementContract').abi, client);
  const taskManagementForBank = taskManagementForClient.connect(bank);

  const fhePublicKeyCommitment = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(keys.fhe_public_key)
  );
  await (await userRegistry.registerUser(client.address, fhePublicKeyCommitment, 'serverKey')).wait();
  await (await bankRegistry.registerBank(bank.address)).wait();

  await api('/get_public_key', { public_key: client.address });
  const encrypted = await api('/encrypt', {
    public_key: client.address,
    data_type: 'monthly_income',
    value: 100
  });
  const block = await provider.getBlock('latest');
  await (await dataStorage.storeUserData(
    client.address,
    'monthly_income',
    block.timestamp + 30 * 24 * 60 * 60,
    encrypted.encrypted_value
  )).wait();

  const createReceipt = await (await taskManagementForClient.createTask(bank.address, 'loan')).wait();
  const created = createReceipt.events.find((event) => event.event === 'TaskCreated');
  const taskId = created.args.taskId.toString();
  const storedData = await dataStorage.getDataByUserAndType(client.address, 'monthly_income');
  const computation = await api('/compute', {
    public_key: client.address,
    task_id: taskId,
    data_type: 'monthly_income',
    encrypted_values: storedData.map((entry) => entry.encryptedData)
  });
  await (await taskManagementForBank.completeTask(taskId, computation.result)).wait();

  const decrypted = await api('/decrypt', {
    public_key: client.address,
    data_type: 'monthly_income',
    encrypted_value: computation.result
  });
  if (decrypted.value !== 100) {
    throw new Error(`Expected decrypted result 100, received ${decrypted.value}`);
  }
  const signature = await client.signMessage(ethers.utils.arrayify(ethers.utils.id(decrypted.value.toString())));
  await (await taskManagementForClient.publishTaskResult(taskId, signature)).wait();

  const published = await taskManagementForClient.getUserCompletedAndPublishedTasks(client.address);
  if (published.length !== 1 || !published[0].isPublished) {
    throw new Error('Published task was not returned with isPublished=true');
  }
  console.log(`Verified client ${client.address} and bank ${bank.address}: funded, registered, encrypted, computed, decrypted, and published task ${taskId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
