// 用 deployments.json 回填前端 contracts.ts（依据 resume_zhixing.sh 第4步）
const fs = require('fs');
const ROOT = '/root/Bisai';
const dp = JSON.parse(fs.readFileSync(ROOT + '/FHE-Protocol/deployments.json', 'utf8'));
const map = {
  AccessControl: dp.accessControl,
  BankRegistry:  dp.bankRegistry,
  DataStorage:   dp.dataStorage,
  TaskManagement:dp.taskManagement,
  UserRegistry:  dp.userRegistry,
};
const file = ROOT + '/FHE-Frontend/src/config/contracts.ts';
let s = fs.readFileSync(file, 'utf8');
for (const [k, addr] of Object.entries(map)) {
  const re = new RegExp('(' + k + ":\\s*')(0x[0-9a-fA-F]{40})(')");
  if (!re.test(s)) { console.error('未匹配到 ' + k); process.exit(1); }
  s = s.replace(re, '$1' + addr + '$3');
}
fs.writeFileSync(file, s);
console.log('contracts.ts updated:');
for (const [k, a] of Object.entries(map)) console.log('  ' + k + ' = ' + a);
