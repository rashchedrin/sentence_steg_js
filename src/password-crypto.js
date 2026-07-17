/** Registry of password-based payload encryption versions. */

import { gpgSymmetricDecrypt, gpgSymmetricEncrypt } from "./gpg-crypto.js";
import { gcmwrapEncrypt, gcmwrapTryDecrypt } from "./gcmwrap.js";

/**
 * @typedef {object} PasswordCryptoVersion
 * @property {string} versionId
 * @property {string} displayName
 * @property {(payloadBytes: Uint8Array, password: string) => Promise<Uint8Array>} encrypt
 * @property {(ciphertextBytes: Uint8Array, password: string) => Promise<Uint8Array | null>} tryDecrypt
 */

/**
 * @typedef {object} PasswordDecryptCandidate
 * @property {string} versionId
 * @property {string} displayName
 * @property {Uint8Array} payloadBytes
 */

/**
 * Ambiguous decrypt: more than one password-crypto version authenticated the blob.
 */
export class AmbiguousPasswordDecryptError extends Error {
  /**
   * @param {PasswordDecryptCandidate[]} candidates
   */
  constructor(candidates) {
    if (!Array.isArray(candidates) || candidates.length < 2) {
      throw new Error(
        `expected at least 2 decrypt candidates for ambiguity, got ${candidates?.length}`,
      );
    }
    const versionLabels = candidates.map((candidate) => candidate.displayName).join(", ");
    super(
      `несколько методов парольной расшифровки успешно сработали (${versionLabels}); `
        + "выберите один явно",
    );
    this.name = "AmbiguousPasswordDecryptError";
    /** @type {PasswordDecryptCandidate[]} */
    this.candidates = candidates;
  }
}

/**
 * @param {Uint8Array} ciphertextBytes
 * @param {string} password
 * @returns {Promise<Uint8Array | null>}
 */
async function gpgTryDecrypt(ciphertextBytes, password) {
  try {
    return await gpgSymmetricDecrypt(ciphertextBytes, password);
  } catch {
    return null;
  }
}

/** Newest first — default encrypt version is index 0. */
const PASSWORD_CRYPTO_VERSIONS = /** @type {PasswordCryptoVersion[]} */ ([
  {
    versionId: "v2-gcmwrap",
    displayName: "версия 2: gcmwrap",
    encrypt: gcmwrapEncrypt,
    tryDecrypt: gcmwrapTryDecrypt,
  },
  {
    versionId: "v1-gpg",
    displayName: "версия 1: GPG",
    encrypt: gpgSymmetricEncrypt,
    tryDecrypt: gpgTryDecrypt,
  },
]);

/**
 * @returns {PasswordCryptoVersion[]}
 */
export function listPasswordCryptoVersions() {
  return PASSWORD_CRYPTO_VERSIONS.map((version) => ({ ...version }));
}

/**
 * @returns {string}
 */
export function defaultPasswordCryptoVersionId() {
  return PASSWORD_CRYPTO_VERSIONS[0].versionId;
}

/**
 * @param {string} versionId
 * @returns {PasswordCryptoVersion}
 */
export function getPasswordCryptoVersion(versionId) {
  const version = PASSWORD_CRYPTO_VERSIONS.find((entry) => entry.versionId === versionId);
  if (!version) {
    const knownIds = PASSWORD_CRYPTO_VERSIONS.map((entry) => entry.versionId).join(", ");
    throw new Error(`unknown password crypto version ${JSON.stringify(versionId)}; known: ${knownIds}`);
  }
  return version;
}

/**
 * @param {Uint8Array} payloadBytes
 * @param {string} password
 * @param {string} [versionId]
 * @returns {Promise<Uint8Array>}
 */
export async function encryptWithPassword(payloadBytes, password, versionId = defaultPasswordCryptoVersionId()) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  const version = getPasswordCryptoVersion(versionId);
  return version.encrypt(payloadBytes, password);
}

/**
 * Try every registered password-crypto version. On a single success return the
 * payload; on none throw; on several throw AmbiguousPasswordDecryptError.
 *
 * @param {Uint8Array} ciphertextBytes
 * @param {string} password
 * @returns {Promise<{ payloadBytes: Uint8Array, versionId: string, displayName: string }>}
 */
export async function decryptWithPassword(ciphertextBytes, password) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  /** @type {PasswordDecryptCandidate[]} */
  const successes = [];
  for (const version of PASSWORD_CRYPTO_VERSIONS) {
    const payloadBytes = await version.tryDecrypt(ciphertextBytes, password);
    if (payloadBytes === null) {
      continue;
    }
    successes.push({
      versionId: version.versionId,
      displayName: version.displayName,
      payloadBytes,
    });
  }
  if (successes.length === 0) {
    throw new Error("не удалось расшифровать паролем ни одним из известных методов");
  }
  if (successes.length > 1) {
    throw new AmbiguousPasswordDecryptError(successes);
  }
  return {
    payloadBytes: successes[0].payloadBytes,
    versionId: successes[0].versionId,
    displayName: successes[0].displayName,
  };
}
