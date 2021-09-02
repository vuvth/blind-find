import { executeCircuit, getSignalByName } from "maci-circuits";

import { compileCircuit } from "./utils";
import { bigIntFactoryExclude, deepcopyRawObj } from "../utils";
import { hubRegistryTreeFactory, proofOfSMPInputsFactory } from ".././factories";
import { proofOfSMPInputsToCircuitArgs } from "../../src/circuits";

import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { genKeypair } from "maci-crypto";

chai.use(chaiAsPromised);
const expect = chai.expect;

describe("proof of smp", function() {
  this.timeout(300000);
  let circuit;
  const hub = genKeypair();
  const tree = hubRegistryTreeFactory([hub], 32);
  const hubRegistry = tree.leaves[0];
  const s = proofOfSMPInputsFactory(
    hub,
    hubRegistry,
    tree.tree.genMerklePath(0),
    hubRegistry.toObj().adminAddress
  );
  const args = proofOfSMPInputsToCircuitArgs(s);

  before(async () => {
    circuit = await compileCircuit("testProofOfSMP.circom");
  });

  const verifyProofOfSMP = async args => {
    const witness = await executeCircuit(circuit, args);
    const res = getSignalByName(circuit, witness, "main.valid").toString();

    return res === "1";
  };

  it("succeeds", async () => {
    // Succeeds
    expect(await verifyProofOfSMP(args)).to.be.true;
  });

  it("fails if msg1 is malformed", async () => {
    const argsInvalidMsg1 = deepcopyRawObj(args);
    argsInvalidMsg1.g2hProofC = bigIntFactoryExclude([args.g2hProofC]);
    await expect(verifyProofOfSMP(argsInvalidMsg1)).to.be.rejected;
  });

  it("fails if msg2 is malformed", async () => {
    const argsInvalidMsg2 = deepcopyRawObj(args);
    argsInvalidMsg2.g2bProofD = bigIntFactoryExclude([args.g2bProofD]);
    await expect(verifyProofOfSMP(argsInvalidMsg2)).to.be.rejected;
  });

  it("fails if msg3 is malformed", async () => {
    const argsInvalidMsg3 = deepcopyRawObj(args);
    argsInvalidMsg3.paqaProofD1 = bigIntFactoryExclude([args.paqaProofD1]);
    await expect(verifyProofOfSMP(argsInvalidMsg3)).to.be.rejected;
  });
});
