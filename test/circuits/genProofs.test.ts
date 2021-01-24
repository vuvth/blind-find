import {
  genProofOfSMP,
  genProofSuccessfulSMP,
  verifyProofOfSMP,
  verifyProofSuccessfulSMP,
  verifyProofIndirectConnection,
  TProof
} from "../../src/circuits/ts";
import { proofIndirectConnectionInputsFactory } from "../../src/factories";
import { babyJubPointFactory } from "../../src/smp/v4/factories";
import { bigIntFactoryExclude, factoryExclude } from "../utils";

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe("Test `genProof` and `verifyProof`", function() {
  this.timeout(300000);

  const inputs = proofIndirectConnectionInputsFactory(32);
  let proofOfSMP: TProof;
  let proofSuccessfulSMP: TProof;

  before(async () => {
    proofOfSMP = await genProofOfSMP(inputs);
    proofSuccessfulSMP = await genProofSuccessfulSMP(inputs);
  });

  it("proofOfSMP succeeds", async () => {
    const res = await verifyProofOfSMP(proofOfSMP);
    expect(res).to.be.true;
    // Invalid public
    const invalidPublicSignals = [...proofOfSMP.publicSignals];
    invalidPublicSignals[0] = bigIntFactoryExclude(invalidPublicSignals);
    expect(
      verifyProofOfSMP({
        proof: proofOfSMP.proof,
        publicSignals: invalidPublicSignals
      })
    ).to.be.rejected;
  });

  it("proofSuccessfulSMP succeeds", async () => {
    const res = await verifyProofSuccessfulSMP(proofSuccessfulSMP);
    expect(res).to.be.true;

    // Invalid public
    const invalidPublicSignals = [...proofSuccessfulSMP.publicSignals];
    invalidPublicSignals[0] = bigIntFactoryExclude(invalidPublicSignals);
    expect(
      verifyProofSuccessfulSMP({
        proof: proofSuccessfulSMP.proof,
        publicSignals: invalidPublicSignals
      })
      ).to.be.rejected;
  });

  it("proof indirect connection (proofOfSMP and proofSuccessfulSMP)", async () => {
    const res = await verifyProofIndirectConnection({
      pubkeyA: inputs.pubkeyA,
      pubkeyC: inputs.pubkeyC,
      adminAddress: inputs.adminAddress,
      merkleRoot: inputs.root,
      proofOfSMP,
      proofSuccessfulSMP
    });
    expect(res).to.be.true;

    // Fails when invalid public keys are passed.
    const anotherPubkey = factoryExclude(
      [inputs.pubkeyA, inputs.pubkeyC],
      () => {
        return babyJubPointFactory().point;
      },
      (a, b) => a === b
    );
    const anotherRoot = bigIntFactoryExclude([inputs.root]);
    const anotherAdminAddress = bigIntFactoryExclude([inputs.adminAddress]);
    // Wrong pubkeyA
    expect(
      await verifyProofIndirectConnection({
        pubkeyA: anotherPubkey,
        pubkeyC: inputs.pubkeyC,
        adminAddress: inputs.adminAddress,
        merkleRoot: inputs.root,
        proofOfSMP,
        proofSuccessfulSMP
      })
    ).to.be.false;
    // Wrong pubkeyC
    expect(
      await verifyProofIndirectConnection({
        pubkeyA: inputs.pubkeyA,
        pubkeyC: anotherPubkey,
        adminAddress: inputs.adminAddress,
        merkleRoot: inputs.root,
        proofOfSMP,
        proofSuccessfulSMP
      })
    ).to.be.false;
    // Wrong pubkeyAdmin
    expect(
      await verifyProofIndirectConnection({
        pubkeyA: inputs.pubkeyA,
        pubkeyC: inputs.pubkeyC,
        adminAddress: anotherAdminAddress,
        merkleRoot: inputs.root,
        proofOfSMP,
        proofSuccessfulSMP
      })
    ).to.be.false;
    // Wrong root
    expect(
      await verifyProofIndirectConnection({
        pubkeyA: inputs.pubkeyA,
        pubkeyC: inputs.pubkeyC,
        adminAddress: inputs.adminAddress,
        merkleRoot: anotherRoot,
        proofOfSMP,
        proofSuccessfulSMP
      })
    ).to.be.false;
  });
});
