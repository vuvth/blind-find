import * as path from "path";

import { PubKey, Signature, stringifyBigInts } from "maci-crypto";
import { ValueError } from "../smp/exceptions";
import {
  SMPMessage1Wire,
  SMPMessage2Wire,
  SMPMessage3Wire
} from "../smp/v4/serialization";
import { HubRegistry } from "..";
import { BabyJubPoint } from "../smp/v4/babyJub";
import { MerkleProof } from "../interfaces";
import { TEthereumAddress } from "../types";
const snarkjs = require("snarkjs");
const fastfile = require("fastfile");

/**
 * Ref
 *  - maci-circuit: https://github.com/appliedzkp/maci/blob/e5e3c2f9f5f0d6b130b1c4b0ee41e6042c0cbcc0/circuits/ts/index.ts#L161
 */

// TODO: Move to configs.ts?
const circomFilePostfix = ".circom";
const circomDir = `${__dirname}/../../circuits`;
const buildDir = `${__dirname}/../../build`;
const proofOfSMPPath = path.join(circomDir, "instance/proofOfSMP.circom");
const proofSuccessfulSMPPath = path.join(
  circomDir,
  "instance/proofSuccessfulSMP.circom"
);

// TODO: make it configurable
const API_ENDPOINT = "http://localhost:5000";

function getPath(filename: string) {
  const path = (process as any).browser ? API_ENDPOINT : buildDir;
  return `${path}/${filename}`;
}

type ProofOfSMPInput = {
  h2: BigInt;
  h3: BigInt;
  r4h: BigInt;
  msg1: SMPMessage1Wire;
  msg2: SMPMessage2Wire;
  msg3: SMPMessage3Wire;
  proof: MerkleProof;
  hubRegistry: HubRegistry;
  pubkeyC: PubKey;
  pubkeyHub: PubKey;
  sigJoinMsgC: Signature;
  sigJoinMsgHub: Signature;
};

type ProofSuccessfulSMPInput = {
  a3: BigInt;
  pa: BabyJubPoint;
  ph: BabyJubPoint;
  rh: BabyJubPoint;
  pubkeyA: PubKey;
  sigRh: Signature;
};

type TProof = { proof: any; publicSignals: any };
type TProofIndirectConnection = {
  pubkeyA: PubKey;
  pubkeyC: PubKey;
  adminAddress: TEthereumAddress;
  proofOfSMP: TProof;
  proofSuccessfulSMP: TProof;
};

const genProofOfSMP = async (inputs: ProofOfSMPInput) => {
  const args = proofOfSMPInputsToCircuitArgs(inputs);
  return await genProof(proofOfSMPPath, args);
};

const proofOfSMPInputsToCircuitArgs = (inputs: ProofOfSMPInput) => {
  if (!inputs.hubRegistry.verify()) {
    throw new ValueError("registry is invalid");
  }
  const args = stringifyBigInts({
    merklePathElements: inputs.proof.pathElements,
    merklePathIndices: inputs.proof.indices,
    merkleRoot: inputs.proof.root,
    sigHubRegistryR8: inputs.hubRegistry.sig.R8,
    sigHubRegistryS: inputs.hubRegistry.sig.S,
    adminAddress: inputs.hubRegistry.adminAddress,
    pubkeyC: inputs.pubkeyC,
    sigCR8: inputs.sigJoinMsgC.R8,
    sigCS: inputs.sigJoinMsgC.S,
    pubkeyHub: inputs.pubkeyHub,
    sigJoinMsgHubR8: inputs.sigJoinMsgHub.R8,
    sigJoinMsgHubS: inputs.sigJoinMsgHub.S,
    h2: inputs.h2,
    h3: inputs.h3,
    r4h: inputs.r4h,
    g2h: inputs.msg1.g2a.point,
    g2hProofC: inputs.msg1.g2aProof.c,
    g2hProofD: inputs.msg1.g2aProof.d,
    g3h: inputs.msg1.g3a.point,
    g3hProofC: inputs.msg1.g3aProof.c,
    g3hProofD: inputs.msg1.g3aProof.d,
    g2a: inputs.msg2.g2b.point,
    g2aProofC: inputs.msg2.g2bProof.c,
    g2aProofD: inputs.msg2.g2bProof.d,
    g3a: inputs.msg2.g3b.point,
    g3aProofC: inputs.msg2.g3bProof.c,
    g3aProofD: inputs.msg2.g3bProof.d,
    pa: inputs.msg2.pb.point,
    qa: inputs.msg2.qb.point,
    paqaProofC: inputs.msg2.pbqbProof.c,
    paqaProofD0: inputs.msg2.pbqbProof.d0,
    paqaProofD1: inputs.msg2.pbqbProof.d1,
    ph: inputs.msg3.pa.point,
    qh: inputs.msg3.qa.point,
    phqhProofC: inputs.msg3.paqaProof.c,
    phqhProofD0: inputs.msg3.paqaProof.d0,
    phqhProofD1: inputs.msg3.paqaProof.d1,
    rh: inputs.msg3.ra.point,
    rhProofC: inputs.msg3.raProof.c,
    rhProofD: inputs.msg3.raProof.d
  });
  return args;
};

const verifyProofOfSMP = async (proof: TProof) => {
  return await verifyProof(proofOfSMPPath, proof);
};

const proofSuccessfulSMPInputsToCircuitArgs = (
  inputs: ProofSuccessfulSMPInput
) => {
  return stringifyBigInts({
    a3: inputs.a3,
    pa: inputs.pa.point,
    ph: inputs.ph.point,
    rh: inputs.rh.point,
    pubkeyA: inputs.pubkeyA,
    sigRhR8: inputs.sigRh.R8,
    sigRhS: inputs.sigRh.S
  });
};

const genProofSuccessfulSMP = async (inputs: ProofSuccessfulSMPInput) => {
  return await genProof(
    proofSuccessfulSMPPath,
    proofSuccessfulSMPInputsToCircuitArgs(inputs)
  );
};

const verifyProofSuccessfulSMP = async (proof: TProof) => {
  return await verifyProof(proofSuccessfulSMPPath, proof);
};

const getCircuitName = (circomFileBasename: string): string => {
  if (
    circomFileBasename.slice(
      circomFileBasename.length - circomFilePostfix.length
    ) !== circomFilePostfix
  ) {
    throw new ValueError(
      `circom file must have postifx ${circomFilePostfix}: circomFile=${circomFileBasename}`
    );
  }
  return circomFileBasename.slice(
    0,
    circomFileBasename.length - circomFilePostfix.length
  );
};

/**
 * Find the circuit file under `circuits/`. Compile it and generate the proof with `inputs`.
 * @param circomFullPath
 * @param inputs
 * @param circuit
 */
const genProof = async (circomFullPath: string, inputs: any) => {
  const circomFileBasename = path.basename(circomFullPath);
  const circuitName = getCircuitName(circomFileBasename);
  const circuitR1csPath = `${circuitName}.r1cs`;
  const wasmPath = `${circuitName}.wasm`;
  const paramsPath = `${circuitName}.params`;
  const zkeyPath = `${circuitName}.zkey`;
  return await genProofAndPublicSignals(
    inputs,
    circuitR1csPath,
    wasmPath,
    paramsPath,
    zkeyPath
  );
};

const genProofAndPublicSignals = async (
  inputs: any,
  circuitR1csFilename: string,
  circuitWasmFilename: string,
  paramsFilename: string,
  zkeyFilename: string
) => {
  const wasmPath = getPath(circuitWasmFilename);
  const zkeyPath = getPath(zkeyFilename);
  return await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);
};

const verifyProof = async (circomFilePath: string, proof: TProof) => {
  const circuitName = getCircuitName(path.basename(circomFilePath));
  const zkeyFd = await fastfile.readExisting(getPath(`${circuitName}.zkey.json`));
  const decoded = new TextDecoder().decode(await zkeyFd.read(zkeyFd.totalSize))
  const zkey = JSON.parse(decoded)
  return await snarkjs.groth16.verify(zkey, proof.publicSignals, proof.proof);
};

export const parseProofOfSMPPublicSignals = (publicSignals: string[]) => {
  const mappedSignals = publicSignals.map(BigInt);
  if (mappedSignals.length !== 39) {
    throw new ValueError(
      `length of publicSignals is not correct: publicSignals=${mappedSignals}`
    );
  }
  // Ignore the first `1n`.
  const pubkeyC = mappedSignals.slice(1, 3);
  const adminAddress = mappedSignals[3];
  const merkleRoot = mappedSignals[4];
  const pa = new BabyJubPoint(mappedSignals.slice(21, 23));
  const ph = new BabyJubPoint(mappedSignals.slice(28, 30));
  const rh = new BabyJubPoint(mappedSignals.slice(35, 37));
  return {
    pubkeyC,
    adminAddress,
    merkleRoot,
    pa,
    ph,
    rh
  };
};

const parseProofSuccessfulSMPPublicSignals = (publicSignals: string[]) => {
  const mappedSignals = publicSignals.map(BigInt);
  if (mappedSignals.length !== 9) {
    throw new ValueError(
      `length of publicSignals is not correct: publicSignals=${mappedSignals}`
    );
  }
  // Ignore the first `1n`.
  const pubkeyA = mappedSignals.slice(1, 3);
  const pa = new BabyJubPoint(mappedSignals.slice(3, 5));
  const ph = new BabyJubPoint(mappedSignals.slice(5, 7));
  const rh = new BabyJubPoint(mappedSignals.slice(7, 9));
  return {
    pubkeyA,
    pa,
    ph,
    rh
  };
};

const isPubkeySame = (a: PubKey, b: PubKey) => {
  return a.length === b.length && a[0] === b[0] && a[1] === b[1];
};

const verifyProofIndirectConnection = async (
  proof: TProofIndirectConnection,
  validMerkleRoots: Set<BigInt>
) => {
  if (!(await verifyProofOfSMP(proof.proofOfSMP))) {
    return false;
  }
  const resProofOfSMP = parseProofOfSMPPublicSignals(
    proof.proofOfSMP.publicSignals
  );
  if (!(await verifyProofSuccessfulSMP(proof.proofSuccessfulSMP))) {
    return false;
  }
  const resProofSuccessfulSMP = parseProofSuccessfulSMPPublicSignals(
    proof.proofSuccessfulSMP.publicSignals
  );
  /**
   * Check pubkeys in `proofOfSMP` and `proofSuccessfulSMP`.
   */
  if (!isPubkeySame(resProofSuccessfulSMP.pubkeyA, proof.pubkeyA)) {
    return false;
  }
  if (!isPubkeySame(resProofOfSMP.pubkeyC, proof.pubkeyC)) {
    return false;
  }
  if (resProofOfSMP.adminAddress !== proof.adminAddress) {
    return false;
  }
  /**
   * Check merkle root
   */
  if (!validMerkleRoots.has(resProofOfSMP.merkleRoot)) {
    return false;
  }
  /**
   * Confirm the smp messages in `proofOfSMP` match the ones in `proofSuccessfulSMP`.
   */
  if (!resProofOfSMP.pa.equal(resProofSuccessfulSMP.pa)) {
    return false;
  }
  if (!resProofOfSMP.ph.equal(resProofSuccessfulSMP.ph)) {
    return false;
  }
  if (!resProofOfSMP.rh.equal(resProofSuccessfulSMP.rh)) {
    return false;
  }
  return true;
};

export {
  genProofOfSMP,
  verifyProofOfSMP,
  proofOfSMPInputsToCircuitArgs,
  genProofSuccessfulSMP,
  proofSuccessfulSMPInputsToCircuitArgs,
  verifyProofSuccessfulSMP,
  verifyProofIndirectConnection,
  TProof,
  TProofIndirectConnection
};
