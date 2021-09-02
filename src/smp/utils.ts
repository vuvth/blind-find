import BN from "bn.js";

import { ValueError } from "./exceptions";
import { TEndian } from "./types";

/**
 * Modular operation for `BigInt`.
 * @param a Number to be reduced
 * @param modulus Modulus
 */
export const bigIntMod = (a: BigInt, modulus: BigInt): BigInt => {
  const res =  BigInt(a) % BigInt(modulus);
  if (res < 0) {
    return res + BigInt(modulus);
  } else {
    return res;
  }
};

/**
 * Safely cast a `BigInt` to `Number`.
 * @param a Number to be cast.
 */
export const bigIntToNumber = (a: BigInt): number => {
  if (
    a > BigInt(Number.MAX_SAFE_INTEGER) ||
    a < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new ValueError(
      "unsafe to cast the integer because it's out of range of `Number`"
    );
  }
  return Number(a);
};

/**
 * Serialize `value` to its binary representation. [[BN]] is to perform [de]serialization.
 *
 * @param value - The integer to be serialized.
 * @param size - Number of bytes the binary representation should occupy.
 * @param endian - Endian the binary representation should follow.
 */
export const bigIntToUint8Array = (
  value: BigInt,
  endian: TEndian,
  size?: number
): Uint8Array => {
  return new Uint8Array(new BN(value.toString()).toArray(endian, size));
};

/**
 * Parse a number from its binary representation. [[BN]] is to perform [de]serialization.
 */
export const uint8ArrayToBigInt = (a: Uint8Array, endian: TEndian): BigInt => {
  return BigInt(new BN(a, undefined, endian).toString());
};

/**
 * Concatenate two `Uint8Array` into one.
 */
export const concatUint8Array = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  let c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
};
