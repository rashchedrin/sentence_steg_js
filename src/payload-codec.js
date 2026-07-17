/** Encode and decode steganographic payloads with optional GPG encryption. */

import { bitsToBytes, bytesToBits } from "./binary-payload.js";
import { generateText, parseText } from "./codec.js";
import {
  binaryOpenPgpToArmoredMessage,
  gpgPublicKeyEncrypt,
  gpgSymmetricDecrypt,
  gpgSymmetricEncrypt,
} from "./gpg-crypto.js";
import { GrammarSteg } from "./grammar-base.js";

/**
 * @typedef {object} PayloadEncryptOptions
 * @property {string | null} [password]
 * @property {string | null} [publicKeyArmored]
 */

/**
 * @typedef {object} PayloadDecryptOptions
 * @property {string | null} [password]
 */

/**
 * @param {PayloadEncryptOptions} [cryptoOptions]
 * @returns {PayloadEncryptOptions}
 */
function normalizeEncryptOptions(cryptoOptions = {}) {
  assertCryptoOptionsObject(cryptoOptions, "encrypt");
  const password = cryptoOptions.password ?? null;
  const publicKeyArmored = cryptoOptions.publicKeyArmored ?? null;
  if (password !== null && publicKeyArmored !== null) {
    throw new Error("expected either password or public key encryption, not both");
  }
  return { password, publicKeyArmored };
}

/**
 * @param {PayloadDecryptOptions} [cryptoOptions]
 * @returns {PayloadDecryptOptions}
 */
function normalizeDecryptOptions(cryptoOptions = {}) {
  assertCryptoOptionsObject(cryptoOptions, "decrypt");
  return { password: cryptoOptions.password ?? null };
}

/**
 * @param {unknown} cryptoOptions
 * @param {string} operationName
 * @returns {void}
 */
function assertCryptoOptionsObject(cryptoOptions, operationName) {
  if (cryptoOptions === null || typeof cryptoOptions !== "object" || Array.isArray(cryptoOptions)) {
    throw new Error(
      `expected ${operationName} options object, got ${Object.prototype.toString.call(cryptoOptions)}`,
    );
  }
}

/**
 * @param {Uint8Array} payloadBytes
 * @param {PayloadEncryptOptions} [cryptoOptions]
 * @returns {Promise<Uint8Array>}
 */
export async function prepareEmbeddedBytes(payloadBytes, cryptoOptions = {}) {
  const { password, publicKeyArmored } = normalizeEncryptOptions(cryptoOptions);
  if (password !== null) {
    if (!password) {
      throw new Error("expected non-empty password, got empty string");
    }
    return gpgSymmetricEncrypt(payloadBytes, password);
  }
  if (publicKeyArmored !== null) {
    if (!publicKeyArmored.trim()) {
      throw new Error("expected non-empty public key, got empty string");
    }
    return gpgPublicKeyEncrypt(payloadBytes, publicKeyArmored);
  }
  return payloadBytes;
}

/**
 * @param {Uint8Array} embeddedBytes
 * @param {PayloadDecryptOptions} [cryptoOptions]
 * @returns {Promise<Uint8Array>}
 */
export async function restorePayloadBytes(embeddedBytes, cryptoOptions = {}) {
  const { password } = normalizeDecryptOptions(cryptoOptions);
  if (password !== null) {
    if (!password) {
      throw new Error("expected non-empty password, got empty string");
    }
    return gpgSymmetricDecrypt(embeddedBytes, password);
  }
  return embeddedBytes;
}

/**
 * @param {Uint8Array} payloadBytes
 * @param {GrammarSteg} grammar
 * @param {PayloadEncryptOptions} [cryptoOptions]
 * @returns {Promise<string>}
 */
export async function encodeBytesToCoverText(payloadBytes, grammar, cryptoOptions = {}) {
  const embeddedBytes = await prepareEmbeddedBytes(payloadBytes, cryptoOptions);
  const payloadBits = bytesToBits(embeddedBytes);
  return generateText(payloadBits, grammar);
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @param {PayloadDecryptOptions} [cryptoOptions]
 * @returns {Promise<{ embeddedBits: string, payloadBytes: Uint8Array }>}
 */
export async function decodeCoverTextToBytes(coverText, grammar, cryptoOptions = {}) {
  const embeddedBits = await parseText(coverText, grammar);
  const embeddedBytes = bitsToBytes(embeddedBits);
  const payloadBytes = await restorePayloadBytes(embeddedBytes, cryptoOptions);
  return { embeddedBits, payloadBytes };
}

/**
 * Extract embedded bytes and wrap them as armored PGP MESSAGE (no private-key decrypt).
 *
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @returns {Promise<{ embeddedBits: string, payloadBytes: Uint8Array, armoredPgpMessage: string }>}
 */
export async function decodeCoverTextToArmoredPgpMessage(coverText, grammar) {
  const { embeddedBits, payloadBytes } = await decodeCoverTextToBytes(coverText, grammar, {});
  const armoredPgpMessage = await binaryOpenPgpToArmoredMessage(payloadBytes);
  return { embeddedBits, payloadBytes, armoredPgpMessage };
}

/**
 * @param {string} payloadText
 * @param {GrammarSteg} grammar
 * @param {PayloadEncryptOptions} [cryptoOptions]
 * @returns {Promise<string>}
 */
export async function encodeTextToCoverText(payloadText, grammar, cryptoOptions = {}) {
  const payloadBytes = new TextEncoder().encode(payloadText);
  return encodeBytesToCoverText(payloadBytes, grammar, cryptoOptions);
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @param {PayloadDecryptOptions} [cryptoOptions]
 * @returns {Promise<{ embeddedBits: string, payloadBytes: Uint8Array }>}
 */
export async function decodeCoverTextToText(coverText, grammar, cryptoOptions = {}) {
  return decodeCoverTextToBytes(coverText, grammar, cryptoOptions);
}
