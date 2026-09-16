import { UserRegistryABI } from '../abis/UserRegistryContract';
import { AccessControlABI } from '../abis/AccessControl';
import { BankRegistryABI } from '../abis/BankRegistryContract';
import { DataStorageABI } from '../abis/DataStorageContract';
import { TaskManagementABI } from '../abis/TaskManagementContract';


export const contractAddresses = {
  // Keep these synchronized with FHE-Protocol/deployments.json for the local
  // Hardhat demonstration network.
  AccessControl: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  UserRegistry: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  BankRegistry: '0x0B306BF915C4d645ff596e518fAf3F9669b97016',
  DataStorage: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
  TaskManagement: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE'
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
