/** Compact password encryption: Argon2id + AES-256-GCM with optional deflate. */

import { argon2idAsync } from "@noble/hashes/argon2.js";

/** Wire-format version byte for this gcmwrap container. */
export const GCMWRAP_VERSION = 0x01;

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + SALT_LENGTH;
const MIN_CIPHERTEXT_LENGTH = HEADER_LENGTH + TAG_LENGTH + 1;

/** Soft cap: abort inflate with a warning if the payload expands past this. */
export const GCMWRAP_MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/** Argon2id parameters (interactive, OWASP-style). */
const ARGON2_OPTIONS = {
  t: 2,
  m: 19_456,
  p: 1,
  dkLen: KEY_LENGTH + NONCE_LENGTH,
};

const FLAG_RAW = 0x00;
const FLAG_DEFLATE = 0x01;

/**
 * Thrown when deflate payload expands past the configured warning threshold.
 */
export class GcmwrapInflateLimitError extends Error {
  /**
   * @param {number} inflatedByteCount
   * @param {number} maxInflatedBytes
   */
  constructor(inflatedByteCount, maxInflatedBytes) {
    super(
      `предупреждение: после распаковки gcmwrap больше ${maxInflatedBytes} байт `
        + `(уже ${inflatedByteCount}); возможна zip-bomb — расшифровка прервана`,
    );
    this.name = "GcmwrapInflateLimitError";
    /** @type {number} */
    this.inflatedByteCount = inflatedByteCount;
    /** @type {number} */
    this.maxInflatedBytes = maxInflatedBytes;
  }
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
  let totalLength = 0;
  for (const part of parts) {
    totalLength += part.length;
  }
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function deflateBytes(bytes) {
  const compressedStream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}

/**
 * Inflate deflate bytes, aborting with a warning if the expansion exceeds maxInflatedBytes.
 *
 * @param {Uint8Array} bytes
 * @param {number} maxInflatedBytes
 * @returns {Promise<Uint8Array>}
 */
async function inflateBytes(bytes, maxInflatedBytes) {
  if (maxInflatedBytes < 1) {
    throw new Error(`expected maxInflatedBytes >= 1, got ${maxInflatedBytes}`);
  }
  const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = decompressedStream.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!(value instanceof Uint8Array)) {
      throw new Error(
        `expected Uint8Array inflate chunk, got ${Object.prototype.toString.call(value)}`,
      );
    }
    totalLength += value.length;
    if (totalLength > maxInflatedBytes) {
      await reader.cancel();
      throw new GcmwrapInflateLimitError(totalLength, maxInflatedBytes);
    }
    chunks.push(value);
  }
  return concatBytes(chunks);
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<{ aesKey: CryptoKey, nonce: Uint8Array }>}
 */
async function deriveAesKeyAndNonce(password, salt) {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`expected salt length ${SALT_LENGTH}, got ${salt.length}`);
  }
  const passwordBytes = new TextEncoder().encode(password);
  const derived = await argon2idAsync(passwordBytes, salt, ARGON2_OPTIONS);
  if (derived.length !== KEY_LENGTH + NONCE_LENGTH) {
    throw new Error(
      `expected Argon2id output length ${KEY_LENGTH + NONCE_LENGTH}, got ${derived.length}`,
    );
  }
  const keyBytes = derived.slice(0, KEY_LENGTH);
  const nonce = derived.slice(KEY_LENGTH);
  const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return { aesKey, nonce };
}

/**
 * Build AEAD plaintext: compression flag byte + payload (raw or deflated).
 * Tries both encodings and keeps the shorter one.
 *
 * @param {Uint8Array} payloadBytes
 * @returns {Promise<Uint8Array>}
 */
async function buildPlaintextWithBestCompression(payloadBytes) {
  const rawPlaintext = concatBytes([new Uint8Array([FLAG_RAW]), payloadBytes]);
  const deflatedPayload = await deflateBytes(payloadBytes);
  const deflatedPlaintext = concatBytes([new Uint8Array([FLAG_DEFLATE]), deflatedPayload]);
  if (deflatedPlaintext.length < rawPlaintext.length) {
    return deflatedPlaintext;
  }
  return rawPlaintext;
}

/**
 * Encrypt payload with password. Format: version || salt || ciphertext||tag.
 *
 * @param {Uint8Array} payloadBytes
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function gcmwrapEncrypt(payloadBytes, password) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  if (!(payloadBytes instanceof Uint8Array)) {
    throw new Error(
      `expected Uint8Array payload, got ${Object.prototype.toString.call(payloadBytes)}`,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const { aesKey, nonce } = await deriveAesKeyAndNonce(password, salt);
  const plaintext = await buildPlaintextWithBestCompression(payloadBytes);
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext),
  );
  return concatBytes([new Uint8Array([GCMWRAP_VERSION]), salt, ciphertextWithTag]);
}

/**
 * Try to decrypt a gcmwrap blob. Returns null when the blob is not this format
 * or authentication fails (wrong password / corrupted data).
 * Re-throws GcmwrapInflateLimitError (zip-bomb warning threshold).
 *
 * @param {Uint8Array} ciphertextBytes
 * @param {string} password
 * @param {number} [maxInflatedBytes]
 * @returns {Promise<Uint8Array | null>}
 */
export async function gcmwrapTryDecrypt(
  ciphertextBytes,
  password,
  maxInflatedBytes = GCMWRAP_MAX_INFLATED_BYTES,
) {
  if (!password) {
    throw new Error("expected non-empty password, got empty string");
  }
  if (!(ciphertextBytes instanceof Uint8Array)) {
    throw new Error(
      `expected Uint8Array ciphertext, got ${Object.prototype.toString.call(ciphertextBytes)}`,
    );
  }
  if (ciphertextBytes.length < MIN_CIPHERTEXT_LENGTH) {
    return null;
  }
  if (ciphertextBytes[0] !== GCMWRAP_VERSION) {
    return null;
  }
  const salt = ciphertextBytes.slice(1, HEADER_LENGTH);
  const sealedBytes = ciphertextBytes.slice(HEADER_LENGTH);
  try {
    const { aesKey, nonce } = await deriveAesKeyAndNonce(password, salt);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, sealedBytes),
    );
    if (plaintext.length < 1) {
      return null;
    }
    const compressionFlag = plaintext[0];
    const bodyBytes = plaintext.slice(1);
    if (compressionFlag === FLAG_RAW) {
      if (bodyBytes.length > maxInflatedBytes) {
        throw new GcmwrapInflateLimitError(bodyBytes.length, maxInflatedBytes);
      }
      return bodyBytes;
    }
    if (compressionFlag === FLAG_DEFLATE) {
      return inflateBytes(bodyBytes, maxInflatedBytes);
    }
    return null;
  } catch (error) {
    if (error instanceof GcmwrapInflateLimitError) {
      throw error;
    }
    return null;
  }
}
