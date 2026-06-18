/** Symmetric encryption compatible with Python gpg --symmetric (AES128 + ZIP). */

import * as openpgp from "openpgp";

/**
 * @param {Uint8Array} payloadBytes
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function gpgSymmetricEncrypt(payloadBytes, password) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  const message = await openpgp.createMessage({ binary: payloadBytes });
  const encrypted = await openpgp.encrypt({
    message,
    passwords: [password],
    format: "binary",
    config: {
      preferredSymmetricAlgorithm: openpgp.enums.symmetric.aes128,
      preferredCompressionAlgorithm: openpgp.enums.compression.zip,
      aeadProtect: false,
    },
  });
  if (encrypted instanceof Uint8Array) {
    return encrypted;
  }
  throw new Error("expected binary OpenPGP output from encrypt");
}

/**
 * @param {Uint8Array} ciphertextBytes
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function gpgSymmetricDecrypt(ciphertextBytes, password) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  const message = await openpgp.readMessage({ binaryMessage: ciphertextBytes });
  const { data } = await openpgp.decrypt({
    message,
    passwords: [password],
    format: "binary",
  });
  if (data instanceof Uint8Array) {
    return data;
  }
  throw new Error("expected binary payload from decrypt");
}
