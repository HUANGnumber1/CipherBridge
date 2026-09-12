import { UserRegistryABI } from '../abis/UserRegistryContract';
import { AccessControlABI } from '../abis/AccessControl';
import { BankRegistryABI } from '../abis/BankRegistryContract';
import { DataStorageABI } from '../abis/DataStorageContract';
import { TaskManagementABI } from '../abis/TaskManagementContract';

export const contractAddresses = {
  AccessControl: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  BankRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  DataStorage: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  TaskManagement: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  UserRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
};

export const contractConfig = {
  AccessControl: {
    address: contractAddresses.AccessControl,
    abi: AccessControlABI
  },
  BankRegistry: {
    address: contractAddresses.BankRegistry,
    abi: BankRegistryABI
  },
  DataStorage: {
    address: contractAddresses.DataStorage,
    abi: DataStorageABI
  },
  TaskManagement: {
    address: contractAddresses.TaskManagement,
    abi: TaskManagementABI
  },
  UserRegistry: {
    address: contractAddresses.UserRegistry,
    abi: UserRegistryABI
  }
};

export default contractConfig; 
