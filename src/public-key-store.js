/** Persist named GPG public keys in the browser via localStorage. */

const STORAGE_KEY = "grammar-steg.public-keys.v1";

/**
 * @typedef {object} SavedPublicKey
 * @property {string} name
 * @property {string} armored
 * @property {string} fingerprint
 */

/**
 * @returns {Storage}
 */
function requireLocalStorage() {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is not available in this environment");
  }
  return localStorage;
}

/**
 * Load all saved public keys, sorted by name.
 *
 * side-effects: reads localStorage
 *
 * @returns {SavedPublicKey[]}
 */
export function loadSavedPublicKeys() {
  const rawValue = requireLocalStorage().getItem(STORAGE_KEY);
  if (rawValue === null) {
    return [];
  }
  const parsedValue = JSON.parse(rawValue);
  if (!Array.isArray(parsedValue)) {
    throw new Error(`expected stored public keys array, got ${typeof parsedValue}`);
  }
  const savedPublicKeys = parsedValue.map((entry, entryIndex) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`expected object at public key index ${entryIndex}, got ${typeof entry}`);
    }
    const { name, armored, fingerprint } = entry;
    if (typeof name !== "string" || typeof armored !== "string" || typeof fingerprint !== "string") {
      throw new Error(`expected string name/armored/fingerprint at index ${entryIndex}`);
    }
    return { name, armored, fingerprint };
  });
  savedPublicKeys.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  return savedPublicKeys;
}

/**
 * Persist the given list of public keys, replacing any previous list.
 *
 * side-effects: writes localStorage
 *
 * @param {SavedPublicKey[]} savedPublicKeys
 * @returns {void}
 */
function writeSavedPublicKeys(savedPublicKeys) {
  requireLocalStorage().setItem(STORAGE_KEY, JSON.stringify(savedPublicKeys));
}

/**
 * Add or replace a public key by name, then return the updated sorted list.
 *
 * side-effects: writes localStorage
 *
 * @param {SavedPublicKey} publicKeyToSave
 * @returns {SavedPublicKey[]}
 */
export function savePublicKey(publicKeyToSave) {
  if (!publicKeyToSave.name.trim()) {
    throw new Error("expected non-empty key name, got empty string");
  }
  if (!publicKeyToSave.armored.trim()) {
    throw new Error("expected non-empty armored key, got empty string");
  }
  const savedPublicKeys = loadSavedPublicKeys();
  const existingIndex = savedPublicKeys.findIndex((entry) => entry.name === publicKeyToSave.name);
  if (existingIndex >= 0) {
    savedPublicKeys[existingIndex] = publicKeyToSave;
  } else {
    savedPublicKeys.push(publicKeyToSave);
  }
  writeSavedPublicKeys(savedPublicKeys);
  return loadSavedPublicKeys();
}

/**
 * Delete a saved public key by name, then return the updated sorted list.
 *
 * side-effects: writes localStorage
 *
 * @param {string} name
 * @returns {SavedPublicKey[]}
 */
export function deletePublicKey(name) {
  const savedPublicKeys = loadSavedPublicKeys().filter((entry) => entry.name !== name);
  writeSavedPublicKeys(savedPublicKeys);
  return savedPublicKeys;
}
