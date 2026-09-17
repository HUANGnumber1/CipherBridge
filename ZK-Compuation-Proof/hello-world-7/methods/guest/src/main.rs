#![no_main]
#![no_std]

extern crate alloc;
use alloc::vec::Vec;
use risc0_zkvm::guest::env;

//use concrete_ntt::prime64::Plan;

use tfhe::core_crypto::entities::*;
use tfhe::core_crypto::commons::parameters::*;
use tfhe::core_crypto::algorithms::*;
//use tfhe::core_crypto::prelude::*;
//use rayon::prelude::*;

risc0_zkvm::guest::entry!(main);
//use serde::Deserialize;

fn main(){

    let serialized_std_bootstrapping_key: Vec<u8> = env::read();
    let serialized_ntt_bsk: Vec<u8> = env::read();
    let serialized_lwe_ciphertext_in: Vec<u8> = env::read();
    let serialized_accumulator: Vec<u8> = env::read();
    let serialized_pbs: Vec<u8> = env::read();

    //let result: LweBootstrapKeyOwned<u64> = bincode::deserialize(&std_bootstrapping_key).unwrap();
    let std_bootstrapping_key: LweBootstrapKeyOwned<u64> = match bincode::deserialize(&serialized_std_bootstrapping_key) {
       Ok(res) => res,
        Err(_) => {
            // Handle the error appropriately, perhaps by logging or signaling failure
            // Since panicking might be acceptable in this context, you can use panic!
            panic!("Deserialization failed");
        }
    };

    let mut ntt_bsk: NttLweBootstrapKeyOwned<u64> = match bincode::deserialize(&serialized_ntt_bsk) {
        Ok(res) => res,
         Err(_) => {
            // Handle the error appropriately, perhaps by logging or signaling failure
            // Since panicking might be acceptable in this context, you can use panic!
            panic!("Deserialization failed");
        }
    };

    let lwe_ciphertext_in: LweCiphertextOwned<u64> = match bincode::deserialize(&serialized_lwe_ciphertext_in) {
        Ok(res) => res,
         Err(_) => {
            // Handle the error appropriately, perhaps by logging or signaling failure
            // Since panicking might be acceptable in this context, you can use panic!
            panic!("Deserialization failed");
        }
    };

    let mut accumulator: GlweCiphertextOwned<u64> = match bincode::deserialize(&serialized_accumulator) {
        Ok(res) => res,
         Err(_) => {
            // Handle the error appropriately, perhaps by logging or signaling failure
            // Since panicking might be acceptable in this context, you can use panic!
            panic!("Deserialization failed");
        }
    };

    let mut pbs_multiplication_ct: LweCiphertextOwned<u64> = match bincode::deserialize(&serialized_pbs) {
        Ok(res) => res,
         Err(_) => {
            // Handle the error appropriately, perhaps by logging or signaling failure
            // Since panicking might be acceptable in this context, you can use panic!
            panic!("Deserialization failed");
        }
    };

     par_convert_standard_lwe_bootstrap_key_to_ntt64(&std_bootstrapping_key, &mut ntt_bsk);
     blind_rotate_ntt64_assign(&lwe_ciphertext_in, &mut accumulator, &ntt_bsk);

     extract_lwe_sample_from_glwe_ciphertext(
        &accumulator,
        &mut pbs_multiplication_ct,
        MonomialDegree(0),
    );

    //let poly_size = 16;
    //let ciphertext_modulus: u64 = 18446744069414584321;

    //let plan = Plan::try_new(poly_size, ciphertext_modulus).unwrap();
    //let mut ntt = std_bootstrapping_key.clone();
    //plan.fwd(&mut ntt);
    
    env::commit(&pbs_multiplication_ct);
    //Ok(())
}
