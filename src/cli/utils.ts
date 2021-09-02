import {
  genPubKey,
  Keypair,
  PrivKey,
  PubKey,
  stringifyBigInts,
  unstringifyBigInts
} from "maci-crypto";
import { Point } from "../smp/v4/serialization";
import { getPubkeyB64 } from "../utils";

export const objToBase64 = (obj: any): string => {
  const objWithBigIntStringified = stringifyBigInts(obj);
  const objInString = JSON.stringify(objWithBigIntStringified);
  // Parsed with utf-8 encoding
  const objInBuffer = Buffer.from(objInString, "utf-8");
  // To base64
  return objInBuffer.toString("base64");
};

export const base64ToObj = (b64string: string): any => {
  // Parse base64 string to buffer
  const objInBuffer = Buffer.from(b64string, "base64");
  // Decode the buffer with ubf-8
  const objInString = objInBuffer.toString("utf-8");
  const objWithBigIntStringified = JSON.parse(objInString);
  return unstringifyBigInts(objWithBigIntStringified);
};

export const privkeyToKeypair = (privkey: PrivKey): Keypair => {
  return {
    privKey: privkey,
    pubKey: genPubKey(privkey)
  };
};

export const pubkeyToCLIFormat = (pubkey: PubKey) => {
  return getPubkeyB64(pubkey);
}

export const pubkeyFromCLIFormat = (s: string) => {
  return Point.deserialize(Buffer.from(s, "base64")).point;
}

export const keypairToCLIFormat = (keypair: Keypair) => {
  return {
    privKey: stringifyBigInts(keypair.privKey),
    pubKey: stringifyBigInts(keypair.pubKey),
    pubKeyBase64Encoded: pubkeyToCLIFormat(keypair.pubKey)
  };
};

export const objToJSONString = (obj: any) => {
  return JSON.stringify(stringifyBigInts(obj), null, "\t");
}

export const jsonStringToObj = (s: string) => {
  return unstringifyBigInts(JSON.parse(s));
}

export const printObj = (s: any) => {
  if (typeof s === "string") {
    console.log(s);
  } else {
    const prettified = objToJSONString(s);
    console.log(prettified);
  }
};
