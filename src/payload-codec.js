/** Encode and decode steganographic payloads with optional GPG encryption. */

import { bitsToBytes, bytesToBits } from "./binary-payload.js";
import { generateText, parseText } from "./codec.js";
import { gpgSymmetricDecrypt, gpgSymmetricEncrypt } from "./gpg-crypto.js";
import { GrammarSteg } from "./grammar-base.js";

/**
 * @param {Uint8Array} payloadBytes
 * @param {string | null} password
 * @returns {Promise<Uint8Array>}
 */
export async function prepareEmbeddedBytes(payloadBytes, password) {
  if (password === null) {
    return payloadBytes;
  }
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  return gpgSymmetricEncrypt(payloadBytes, password);
}

/**
 * @param {Uint8Array} embeddedBytes
 * @param {string | null} password
 * @returns {Promise<Uint8Array>}
 */
export async function restorePayloadBytes(embeddedBytes, password) {
  if (password === null) {
    return embeddedBytes;
  }
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  return gpgSymmetricDecrypt(embeddedBytes, password);
}

/**
 * @param {Uint8Array} payloadBytes
 * @param {GrammarSteg} grammar
 * @param {string | null} password
 * @returns {Promise<string>}
 */
export async function encodeBytesToCoverText(payloadBytes, grammar, password = null) {
  const embeddedBytes = await prepareEmbeddedBytes(payloadBytes, password);
  const payloadBits = bytesToBits(embeddedBytes);
  return generateText(payloadBits, grammar);
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @param {string | null} password
 * @returns {Promise<{ embeddedBits: string, payloadBytes: Uint8Array }>}
 */
export async function decodeCoverTextToBytes(coverText, grammar, password = null) {
  const embeddedBits = await parseText(coverText, grammar);
  const embeddedBytes = bitsToBytes(embeddedBits);
  const payloadBytes = await restorePayloadBytes(embeddedBytes, password);
  return { embeddedBits, payloadBytes };
}

/**
 * @param {string} payloadText
 * @param {GrammarSteg} grammar
 * @param {string | null} password
 * @returns {Promise<string>}
 */
export async function encodeTextToCoverText(payloadText, grammar, password = null) {
  const payloadBytes = new TextEncoder().encode(payloadText);
  return encodeBytesToCoverText(payloadBytes, grammar, password);
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @param {string | null} password
 * @returns {Promise<{ embeddedBits: string, payloadBytes: Uint8Array }>}
 */
export async function decodeCoverTextToText(coverText, grammar, password = null) {
  return decodeCoverTextToBytes(coverText, grammar, password);
}
