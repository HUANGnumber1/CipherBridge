import { UserRegistryABI } from '../abis/UserRegistryContract';
import { AccessControlABI } from '../abis/AccessControl';
import { BankRegistryABI } from '../abis/BankRegistryContract';
import { DataStorageABI } from '../abis/DataStorageContract';
import { TaskManagementABI } from '../abis/TaskManagementContract';


export const contractAddresses = {
  AccessControl: '0x9d4e764dfa453238BeCCe857973682bc810DE7ff',
  BankRegistry: '0xD4ae737D77C4f8A507e3fF04dAf43ab74fad5E80',
  DataStorage: '0x0CD1358A923533263E3a6F0822508aB419a7ef6C',
  TaskManagement: '0xAcCC396A91A82d179a430225A2AFA32b5F355b0D',
  UserRegistry: '0x2F07acb5F4812E6Ea3170278eD9F3F96c3E7a70F'
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