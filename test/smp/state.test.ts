import { SMPStateMachine } from "../../src/smp/v4/state";
import { SMPNotFinished, ValueError } from "../../src/smp/exceptions";
import {
  tlvFactory,
  smpMessage1Factory,
  smpMessage2Factory,
  smpMessage3Factory,
  smpMessage4Factory
} from "../../src/smp/v4/factories";
import { BaseSMPMessage } from "../../src/smp/msgs";

import { expect } from "chai";

describe("test `SMPStateMachine`", () => {
  it("secret types", () => {
    expect(() => {
      // A `number` is fine to be a secret
      new SMPStateMachine(1);
      // A `string` is fine to be a secret
      new SMPStateMachine("secret");
      // A `BigInt` is fine to be a secret
      new SMPStateMachine(BigInt(1));
      // A `Uint8Array` is fine too.
      new SMPStateMachine(new Uint8Array([1]));
    });
  });
});

describe("test `SMPStateMachine` succeeds", () => {
  const string0 = "string0";
  const string1 = "string1";
  it("same secrets", () => {
    expect(smp(string0, string0)).to.be.true;
  });
  it("different secrets", () => {
    expect(smp(string0, string1)).to.be.false;
  });
});

function expectToThrowWhenReceive(s: SMPStateMachine, msgs: BaseSMPMessage[]) {
  for (const msg of msgs) {
    expect(() => {
      s.transit(msg.toTLV());
    }).to.throw(ValueError);
  }
}

describe("test `SMPStateMachine` fails", () => {
  it("transit fails when wrong messages are received", () => {
    const x = "x";
    const y = "y";
    const aliceState1 = new SMPStateMachine(x);
    const bobState1 = new SMPStateMachine(y);

    // Fails when `SMPMessage` is of wrong format
    expect(() => {
      aliceState1.transit(tlvFactory());
    }).to.throw(ValueError);
    // Fails when `SMPState1` receives messages other than `null` and `SMPMessage1`.
    expectToThrowWhenReceive(aliceState1, [
      smpMessage2Factory(),
      smpMessage3Factory(),
      smpMessage4Factory()
    ]);

    const msg1 = aliceState1.transit(null);
    const aliceState2 = aliceState1;

    // Fails when `SMPMessage` is of wrong format
    expect(() => {
      aliceState2.transit(tlvFactory());
    }).to.throw(ValueError);
    // Fails when `SMPState2` receives messages other than `SMPMessage2`.
    expectToThrowWhenReceive(aliceState2, [
      smpMessage1Factory(),
      smpMessage3Factory(),
      smpMessage4Factory()
    ]);

    const msg2 = bobState1.transit(msg1);
    const bobState3 = bobState1;

    // Fails when `SMPMessage` is of wrong format
    expect(() => {
      bobState3.transit(tlvFactory());
    }).to.throw(ValueError);
    // Fails when `SMPState3` receives messages other than `SMPMessage3`.
    expectToThrowWhenReceive(bobState3, [
      smpMessage1Factory(),
      smpMessage2Factory(),
      smpMessage4Factory()
    ]);

    const msg3 = aliceState2.transit(msg2);
    const aliceState4 = aliceState2;

    // Fails when `SMPMessage` is of wrong format
    expect(() => {
      aliceState4.transit(tlvFactory());
    }).to.throw(ValueError);
    // Fails when `SMPState4` receives messages other than `SMPMessage4`.
    expectToThrowWhenReceive(aliceState4, [
      smpMessage1Factory(),
      smpMessage2Factory(),
      smpMessage3Factory()
    ]);

    const msg4 = bobState3.transit(msg3);
    aliceState4.transit(msg4);
    // Both finished
  });
});

function expectSMPFinished(
  stateMachine: SMPStateMachine,
  isFinished: boolean,
  result?: boolean
): void {
  expect(stateMachine.isFinished()).to.eql(isFinished);
  if (isFinished) {
    if (result === undefined) {
      throw new Error(
        "`stateMachine` has finished, the expected result should be provided."
      );
    }
    expect(stateMachine.getResult()).to.eql(result);
  } else {
    expect(() => {
      stateMachine.getResult();
    }).to.throw(SMPNotFinished);
  }
}

function smp(x: string, y: string): boolean {
  const alice = new SMPStateMachine(x);
  const bob = new SMPStateMachine(y);
  expectSMPFinished(alice, false);
  expectSMPFinished(bob, false);

  const msg1 = alice.transit(null); // Initiate SMP
  expectSMPFinished(alice, false);
  const msg2 = bob.transit(msg1);
  expectSMPFinished(bob, false);
  const msg3 = alice.transit(msg2);
  expectSMPFinished(alice, false);
  const msg4 = bob.transit(msg3);
  expectSMPFinished(bob, true, x === y);
  alice.transit(msg4);
  expectSMPFinished(alice, true, x === y);
  const resAlice = alice.getResult();
  const resBob = bob.getResult();
  if (resAlice === null) {
    throw new Error("result should have been set on Alice side");
  }
  if (resBob === null) {
    throw new Error("result should have been set on Bob side");
  }
  if (resAlice !== resBob) {
    throw new Error("Alice and Bob got different results");
  }
  return resAlice;
}
