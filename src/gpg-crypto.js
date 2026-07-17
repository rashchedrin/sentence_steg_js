/** OpenPGP encryption compatible with system gpg (AES128, adaptive ZIP). */

import * as openpgp from "openpgp";

const GPG_COMPRESSION_CONFIGS = [
  {
    preferredSymmetricAlgorithm: openpgp.enums.symmetric.aes128,
    preferredCompressionAlgorithm: openpgp.enums.compression.zip,
    aeadProtect: false,
  },
  {
    preferredSymmetricAlgorithm: openpgp.enums.symmetric.aes128,
    preferredCompressionAlgorithm: openpgp.enums.compression.uncompressed,
    aeadProtect: false,
  },
];

/**
 * Encrypt payload both with ZIP compression and uncompressed, return the
 * smaller binary ciphertext. Both variants decrypt identically in gpg,
 * so no flag needs to be stored.
 *
 * @param {Uint8Array} payloadBytes shape (payloadLength,)
 * @param {object} recipientOptions openpgp.encrypt options selecting the recipient
 *   (either `passwords` or `encryptionKeys`)
 * @returns {Promise<Uint8Array>} shape (ciphertextLength,)
 */
async function gpgEncryptSmallest(payloadBytes, recipientOptions) {
  /** @type {Uint8Array | null} */
  let smallestCiphertext = null;
  for (const compressionConfig of GPG_COMPRESSION_CONFIGS) {
    const message = await openpgp.createMessage({ binary: payloadBytes });
    const encrypted = await openpgp.encrypt({
      message,
      ...recipientOptions,
      format: "binary",
      config: compressionConfig,
    });
    if (!(encrypted instanceof Uint8Array)) {
      throw new Error(
        `expected Uint8Array from openpgp.encrypt, got ${Object.prototype.toString.call(encrypted)}`,
      );
    }
    if (smallestCiphertext === null || encrypted.length < smallestCiphertext.length) {
      smallestCiphertext = encrypted;
    }
  }
  if (smallestCiphertext === null) {
    throw new Error("expected at least one encryption candidate, got none");
  }
  return smallestCiphertext;
}

/**
 * @param {Uint8Array} payloadBytes
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function gpgSymmetricEncrypt(payloadBytes, password) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  return gpgEncryptSmallest(payloadBytes, { passwords: [password] });
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

/**
 * Encrypt to a public key and return the compact binary OpenPGP message
 * (not ASCII armor — armor is only for display / Kleopatra paste).
 *
 * @param {Uint8Array} payloadBytes
 * @param {string} publicKeyArmored
 * @returns {Promise<Uint8Array>}
 */
export async function gpgPublicKeyEncrypt(payloadBytes, publicKeyArmored) {
  if (!publicKeyArmored.trim()) {
    throw new Error("expected non-empty public key, got empty string");
  }
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  return gpgEncryptSmallest(payloadBytes, { encryptionKeys: publicKey });
}

/**
 * Read the primary user ID and fingerprint of an armored public key.
 *
 * @param {string} publicKeyArmored
 * @returns {Promise<{ userId: string, fingerprint: string, defaultName: string }>}
 */
export async function readPublicKeyMetadata(publicKeyArmored) {
  if (!publicKeyArmored.trim()) {
    throw new Error("expected non-empty public key, got empty string");
  }
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  const fingerprint = publicKey.getFingerprint();
  let userId = "";
  try {
    const primaryUser = await publicKey.getPrimaryUser();
    userId = primaryUser.user.userID ? primaryUser.user.userID.userID : "";
  } catch {
    userId = "";
  }
  const shortFingerprint = fingerprint.slice(-8).toUpperCase();
  const defaultName = userId ? `${userId} (${shortFingerprint})` : shortFingerprint;
  return { userId, fingerprint, defaultName };
}

/**
 * Wrap binary OpenPGP ciphertext as ASCII-armored ``PGP MESSAGE`` for Kleopatra/gpg.
 *
 * Embeds the compact binary form in cover text; armor is only for paste/export.
 * CRC24 checksum is emitted so GnuPG accepts the message reliably.
 *
 * @param {Uint8Array} ciphertextBytes
 * @returns {Promise<string>}
 */
export async function binaryOpenPgpToArmoredMessage(ciphertextBytes) {
  if (!(ciphertextBytes instanceof Uint8Array)) {
    throw new Error(
      `expected Uint8Array ciphertext, got ${Object.prototype.toString.call(ciphertextBytes)}`,
    );
  }
  if (ciphertextBytes.length === 0) {
    throw new Error("expected non-empty OpenPGP ciphertext, got empty bytes");
  }
  await openpgp.readMessage({ binaryMessage: ciphertextBytes });
  // armor(type, body, partIndex, partTotal, customComment, emitChecksum)
  const armoredMessage = openpgp.armor(
    openpgp.enums.armor.message,
    ciphertextBytes,
    undefined,
    undefined,
    undefined,
    true,
  );
  if (typeof armoredMessage !== "string" || !armoredMessage.includes("BEGIN PGP MESSAGE")) {
    throw new Error("expected armored PGP MESSAGE string from openpgp.armor");
  }
  return armoredMessage;
}
