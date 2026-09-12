// 链上验证：读取部署地址 → 校验 admin/银行角色/用户注册（用已充值的部署账户）
const fs = require('fs');
const path = require('path');
const { ethers } = require(path.join('/root/Bisai/FHE-Protocol', 'node_modules', 'ethers'));

const ROOT = '/root/Bisai';
const RPC = 'http://127.0.0.1:8545';
const PK = '0x264f1815624a86a569e96f500bb1c1c5f65d580881fd6d6e675532640d86c248';

const dp = JSON.parse(fs.readFileSync(path.join(ROOT, 'FHE-Protocol', 'deployments.json'), 'utf8'));
const art = (n) => JSON.parse(fs.readFileSync(
  path.join(ROOT, 'FHE-Protocol', 'artifacts', 'contracts', n + '.sol', n + '.json'), 'utf8')).abi;

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  console.log('deployer =', wallet.address);

  const ac = new ethers.Contract(dp.accessControl, art('AccessControl'), wallet);
  console.log('isAdmin(deployer) =', await ac.isAdmin(wallet.address));
  if (!(await ac.isAdmin(wallet.address))) throw new Error('deployer is not admin');

  // addBank 为 public 权限，直接调用后校验角色
  await (await ac.addBank(wallet.address)).wait();
  console.log('isBank(deployer)   =', await ac.isBank(wallet.address));

  const ur = new ethers.Contract(dp.userRegistry, art('UserRegistryContract'), wallet);
  const pk = '0x' + 'ab'.repeat(32);
  await (await ur.registerUser(pk, 'fhe_pk_placeholder', 'serverKey')).wait();
  const u = await ur.users(wallet.address);
  console.log('user.isActive      =', u.isActive, ' id =', u.id.toString());
  console.log('accessControl.isRegisteredUser =', await ac.isRegisteredUser(wallet.address));
  if (!u.isActive) throw new Error('user registration failed');

  console.log('CHAIN TEST PASSED');
})().catch((e) => { console.error('CHAIN TEST FAILED:', e.message || e); process.exit(1); });
