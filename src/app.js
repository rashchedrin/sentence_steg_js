/** Client-side Web UI for grammar steg (no backend). */

import { bytesToBits, bytesToUtf8TextIfValid, bitsToBytes } from "./binary-payload.js";
import { generateText, parseText } from "./codec.js";
import {
  createGrammar,
  DEFAULT_GRAMMAR_VERSION_ID,
  listGrammarDefinitions,
} from "./grammars.js";
import {
  AmbiguousPasswordDecryptError,
  decodeCoverTextToArmoredPgpMessage,
  encodeBytesToCoverText,
  encodeTextToCoverText,
  prepareEmbeddedBytes,
  restorePayloadBytes,
} from "./payload-codec.js";
import { readPublicKeyMetadata } from "./gpg-crypto.js";
import {
  deletePublicKey,
  loadSavedPublicKeys,
  savePublicKey,
} from "./public-key-store.js";
import {
  defaultPasswordCryptoVersionId,
  listPasswordCryptoVersions,
} from "./password-crypto.js";

const tabButtons = document.querySelectorAll(".tab");
const panels = {
  encode: document.getElementById("panel-encode"),
  decode: document.getElementById("panel-decode"),
  about: document.getElementById("panel-about"),
};

const grammarVersionSelect = document.getElementById("grammar-version");
const grammarDescription = document.getElementById("grammar-description");
const corpusStatus = document.getElementById("corpus-status");
const aboutBitsPerSentence = document.getElementById("about-bits-per-sentence");
const aboutDiffusionDescription = document.getElementById("about-diffusion-description");

const encodeModeInputs = document.querySelectorAll('input[name="encode-mode"]');
const encodeBitsPanel = document.getElementById("encode-bits-panel");
const encodeFilePanel = document.getElementById("encode-file-panel");
const encodeTextPanel = document.getElementById("encode-text-panel");
const encodeCryptoSection = document.getElementById("encode-crypto-section");
const encodeBitsCryptoHint = document.getElementById("encode-bits-crypto-hint");
const encodeInput = document.getElementById("encode-input");
const encodeTextInput = document.getElementById("encode-text-input");
const encodeFileInput = document.getElementById("encode-file");
const encodeFileInfo = document.getElementById("encode-file-info");
const encodeOutput = document.getElementById("encode-output");
const encodeStats = document.getElementById("encode-stats");
const encodeButton = document.getElementById("encode-button");
const encodeClear = document.getElementById("encode-clear");
const encodeCopy = document.getElementById("encode-copy");
const encodeDownload = document.getElementById("encode-download");
const encodeUsePassword = document.getElementById("encode-use-password");
const encodePassword = document.getElementById("encode-password");
const encodePasswordCryptoVersion = document.getElementById("encode-password-crypto-version");
const encodeUsePublicKey = document.getElementById("encode-use-public-key");
const encodePublicKey = document.getElementById("encode-public-key");
const encodeSavedPublicKey = document.getElementById("encode-saved-public-key");
const encodeDeletePublicKey = document.getElementById("encode-delete-public-key");
const encodePublicKeyName = document.getElementById("encode-public-key-name");
const encodeSavePublicKey = document.getElementById("encode-save-public-key");

/** Warn (confirm) when encoding a file larger than this many bytes. */
const LARGE_FILE_WARN_BYTES = 256 * 1024;

const decodeInput = document.getElementById("decode-input");
const decodeUtf8Section = document.getElementById("decode-utf8-section");
const decodeTextSectionTitle = document.getElementById("decode-text-section-title");
const decodeUtf8Output = document.getElementById("decode-utf8-output");
const decodeOutput = document.getElementById("decode-output");
const decodeStats = document.getElementById("decode-stats");
const decodeButton = document.getElementById("decode-button");
const decodeClear = document.getElementById("decode-clear");
const decodeCopy = document.getElementById("decode-copy");
const decodeUtf8Copy = document.getElementById("decode-utf8-copy");
const decodeDownload = document.getElementById("decode-download");
const decodeUsePassword = document.getElementById("decode-use-password");
const decodePassword = document.getElementById("decode-password");
const decodeAsPgpMessage = document.getElementById("decode-as-pgp-message");

const passwordCryptoCollisionDialog = document.getElementById("password-crypto-collision-dialog");
const passwordCryptoCollisionForm = document.getElementById("password-crypto-collision-form");
const passwordCryptoCollisionOptions = document.getElementById("password-crypto-collision-options");
const passwordCryptoCollisionOk = document.getElementById("password-crypto-collision-ok");

const messageBox = document.getElementById("message");

/** @type {boolean} Whether the user typed a custom key name (suppresses auto-fill). */
let g_publicKeyNameEditedManually = false;

/** @type {string} */
let lastEncodedCoverText = "";

/** @type {string} */
let lastDecodedBits = "";

/** @type {string | null} */
let lastDecodedUtf8Text = null;

/** @type {Uint8Array | null} */
let lastDecodedBytes = null;

/** @type {boolean} */
let corpusReady = false;

/** @type {import("./grammar-base.js").GrammarSteg | null} */
let activeGrammar = null;

/** @type {Map<string, import("./corpus.js").SentenceCorpus>} */
const loadedCorporaByUrl = new Map();

/**
 * @param {string} text
 * @returns {void}
 */
function showMessage(text) {
  if (!text) {
    messageBox.hidden = true;
    messageBox.textContent = "";
    return;
  }
  messageBox.hidden = false;
  messageBox.textContent = text;
}

/**
 * @returns {"bits" | "file" | "text"}
 */
function selectedEncodeMode() {
  const checked = document.querySelector('input[name="encode-mode"]:checked');
  if (checked && checked.value === "file") {
    return "file";
  }
  if (checked && checked.value === "text") {
    return "text";
  }
  return "bits";
}

/**
 * @param {number} byteCount
 * @returns {string}
 */
function formatByteCount(byteCount) {
  if (byteCount < 1024) {
    return `${byteCount} байт`;
  }
  if (byteCount < 1024 * 1024) {
    return `${(byteCount / 1024).toFixed(1)} КиБ`;
  }
  return `${(byteCount / (1024 * 1024)).toFixed(1)} МиБ`;
}

/**
 * Bits mode embeds raw bits; password/pubkey crypto must not appear available.
 *
 * @returns {void}
 */
function updateEncodeModePanels() {
  const encodeMode = selectedEncodeMode();
  encodeBitsPanel.hidden = encodeMode !== "bits";
  encodeFilePanel.hidden = encodeMode !== "file";
  encodeTextPanel.hidden = encodeMode !== "text";
  const bitsMode = encodeMode === "bits";
  encodeCryptoSection.hidden = bitsMode;
  encodeBitsCryptoHint.hidden = !bitsMode;
  if (bitsMode) {
    encodeUsePassword.checked = false;
    encodeUsePublicKey.checked = false;
    updateEncodeCryptoFieldState();
  }
}

/**
 * @param {import("./payload-codec.js").PayloadEncryptOptions} encryptOptions
 * @returns {boolean} false if the user cancelled
 */
function confirmUnencryptedEncodeIfNeeded(encryptOptions) {
  const hasPassword = encryptOptions.password !== undefined && encryptOptions.password !== null;
  const hasPublicKey = (
    encryptOptions.publicKeyArmored !== undefined
    && encryptOptions.publicKeyArmored !== null
  );
  if (hasPassword || hasPublicKey) {
    return true;
  }
  return window.confirm(
    "Предупреждение: данные будут встроены без шифрования.\n"
      + "Любой, кто знает алгоритм и версию, сможет извлечь содержимое.\n\n"
      + "Продолжить без пароля и без публичного ключа?",
  );
}

/**
 * @param {number} fileByteCount
 * @returns {boolean} false if the user cancelled
 */
function confirmLargeFileEncodeIfNeeded(fileByteCount) {
  if (fileByteCount <= LARGE_FILE_WARN_BYTES) {
    return true;
  }
  return window.confirm(
    `Предупреждение: файл большой (${formatByteCount(fileByteCount)}).\n`
      + "Кодирование может занять много памяти и времени, cover-текст будет очень длинным.\n\n"
      + "Продолжить?",
  );
}

/**
 * @returns {import("./payload-codec.js").PayloadEncryptOptions}
 */
function selectedEncryptOptions() {
  if (encodeUsePassword.checked && encodeUsePublicKey.checked) {
    throw new Error("Выберите либо пароль, либо публичный ключ — не оба сразу");
  }
  if (encodeUsePassword.checked) {
    const passwordValue = encodePassword.value;
    if (!passwordValue) {
      throw new Error("Укажите пароль");
    }
    const passwordCryptoVersionId = encodePasswordCryptoVersion.value
      || defaultPasswordCryptoVersionId();
    return { password: passwordValue, passwordCryptoVersionId };
  }
  if (encodeUsePublicKey.checked) {
    const publicKeyArmored = encodePublicKey.value;
    if (!publicKeyArmored.trim()) {
      throw new Error("Вставьте публичный ключ GPG");
    }
    return { publicKeyArmored };
  }
  return {};
}

/**
 * @returns {import("./payload-codec.js").PayloadDecryptOptions & { asPgpMessage: boolean }}
 */
function selectedDecryptOptions() {
  if (decodeUsePassword.checked && decodeAsPgpMessage.checked) {
    throw new Error("Выберите либо расшифровку паролем, либо вывод как PGP MESSAGE");
  }
  if (decodeUsePassword.checked) {
    const passwordValue = decodePassword.value;
    if (!passwordValue) {
      throw new Error("Укажите пароль");
    }
    return { password: passwordValue, asPgpMessage: false };
  }
  return { asPgpMessage: decodeAsPgpMessage.checked };
}

/**
 * @param {HTMLInputElement} usePasswordInput
 * @param {HTMLInputElement} passwordInput
 * @returns {void}
 */
function updatePasswordFieldState(usePasswordInput, passwordInput) {
  passwordInput.disabled = !usePasswordInput.checked;
  if (!usePasswordInput.checked) {
    passwordInput.value = "";
  }
}

/**
 * @returns {void}
 */
function updateEncodeCryptoFieldState() {
  updatePasswordFieldState(encodeUsePassword, encodePassword);
  encodePasswordCryptoVersion.disabled = !encodeUsePassword.checked;
  const usePublicKey = encodeUsePublicKey.checked;
  encodePublicKey.disabled = !usePublicKey;
  encodeSavedPublicKey.disabled = !usePublicKey;
  encodePublicKeyName.disabled = !usePublicKey;
  encodeSavePublicKey.disabled = !usePublicKey;
  if (!usePublicKey) {
    encodePublicKey.value = "";
    encodePublicKeyName.value = "";
    encodeSavedPublicKey.value = "";
    g_publicKeyNameEditedManually = false;
  }
  updateDeletePublicKeyButtonState();
}

/**
 * @returns {void}
 */
function populatePasswordCryptoVersionSelect() {
  encodePasswordCryptoVersion.replaceChildren();
  for (const version of listPasswordCryptoVersions()) {
    const optionElement = document.createElement("option");
    optionElement.value = version.versionId;
    optionElement.textContent = version.displayName;
    encodePasswordCryptoVersion.appendChild(optionElement);
  }
  encodePasswordCryptoVersion.value = defaultPasswordCryptoVersionId();
}

/**
 * Ask the user which ambiguous password-decrypt candidate to keep.
 *
 * @param {import("./password-crypto.js").PasswordDecryptCandidate[]} candidates
 * @returns {Promise<Uint8Array | null>}
 */
function choosePasswordDecryptCandidate(candidates) {
  return new Promise((resolve) => {
    passwordCryptoCollisionOptions.replaceChildren();
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const labelElement = document.createElement("label");
      const radioInput = document.createElement("input");
      radioInput.type = "radio";
      radioInput.name = "password-crypto-collision-choice";
      radioInput.value = String(candidateIndex);
      radioInput.checked = candidateIndex === 0;
      const caption = document.createElement("span");
      caption.textContent = (
        `${candidate.displayName} `
        + `(${candidate.payloadBytes.length} байт)`
      );
      labelElement.append(radioInput, caption);
      passwordCryptoCollisionOptions.appendChild(labelElement);
    }

    /**
     * @param {Event} event
     * @returns {void}
     */
    function onClose(event) {
      passwordCryptoCollisionDialog.removeEventListener("close", onClose);
      if (passwordCryptoCollisionDialog.returnValue !== "ok") {
        resolve(null);
        return;
      }
      const checked = passwordCryptoCollisionForm.querySelector(
        'input[name="password-crypto-collision-choice"]:checked',
      );
      if (!(checked instanceof HTMLInputElement)) {
        resolve(null);
        return;
      }
      const candidateIndex = Number.parseInt(checked.value, 10);
      if (
        !Number.isInteger(candidateIndex)
        || candidateIndex < 0
        || candidateIndex >= candidates.length
      ) {
        resolve(null);
        return;
      }
      resolve(candidates[candidateIndex].payloadBytes);
    }

    passwordCryptoCollisionDialog.addEventListener("close", onClose);
    passwordCryptoCollisionOk.value = "ok";
    passwordCryptoCollisionDialog.showModal();
  });
}

/**
 * @returns {void}
 */
function updateDeletePublicKeyButtonState() {
  const hasSelection = Boolean(encodeSavedPublicKey.value);
  encodeDeletePublicKey.hidden = !hasSelection;
  encodeDeletePublicKey.disabled = !hasSelection || !encodeUsePublicKey.checked;
}

/**
 * Refresh the saved-key combo box options from storage.
 *
 * @param {string} [selectedName]
 * @returns {void}
 */
function refreshSavedPublicKeyOptions(selectedName = "") {
  const savedPublicKeys = loadSavedPublicKeys();
  while (encodeSavedPublicKey.options.length > 1) {
    encodeSavedPublicKey.remove(1);
  }
  for (const savedPublicKey of savedPublicKeys) {
    const optionElement = document.createElement("option");
    optionElement.value = savedPublicKey.name;
    optionElement.textContent = savedPublicKey.name;
    encodeSavedPublicKey.appendChild(optionElement);
  }
  const hasSelected = savedPublicKeys.some((entry) => entry.name === selectedName);
  encodeSavedPublicKey.value = hasSelected ? selectedName : "";
  updateDeletePublicKeyButtonState();
}

/**
 * Fill the name field with the key's default name unless the user edited it.
 *
 * @returns {Promise<void>}
 */
async function autofillPublicKeyName() {
  if (g_publicKeyNameEditedManually) {
    return;
  }
  const publicKeyArmored = encodePublicKey.value.trim();
  if (!publicKeyArmored) {
    encodePublicKeyName.value = "";
    return;
  }
  try {
    const { defaultName } = await readPublicKeyMetadata(publicKeyArmored);
    if (!g_publicKeyNameEditedManually) {
      encodePublicKeyName.value = defaultName;
    }
  } catch {
    // Invalid/incomplete key: leave the name empty, validation happens on save/encode.
  }
}

/**
 * @returns {void}
 */
function updateDecodeCryptoFieldState() {
  updatePasswordFieldState(decodeUsePassword, decodePassword);
}

/**
 * @param {string | null} textValue
 * @param {string} [sectionTitle]
 * @returns {void}
 */
function setDecodeTextOutput(textValue, sectionTitle = "UTF-8 текст") {
  lastDecodedUtf8Text = textValue;
  if (decodeTextSectionTitle) {
    decodeTextSectionTitle.textContent = sectionTitle;
  }
  if (textValue === null) {
    decodeUtf8Section.hidden = true;
    decodeUtf8Output.textContent = "";
    decodeUtf8Copy.hidden = true;
    return;
  }
  decodeUtf8Section.hidden = false;
  decodeUtf8Output.textContent = textValue === "" ? "(пустой текст)" : textValue;
  decodeUtf8Copy.hidden = false;
}

/**
 * @param {number} bitCount
 * @param {number} byteCount
 * @param {number} textByteCount
 * @param {number | null} sizeExpansion
 * @returns {string}
 */
function formatEncodeStats(bitCount, byteCount, textByteCount, sizeExpansion) {
  const payloadStats = `${bitCount} бит, ${byteCount} байт`;
  if (sizeExpansion === null || byteCount === 0) {
    return payloadStats;
  }
  const expansionLabel = Number.isInteger(sizeExpansion)
    ? String(sizeExpansion)
    : sizeExpansion.toFixed(1);
  return (
    `${payloadStats}. Текст занимает в ${expansionLabel} раза больше места, `
    + `чем исходные данные (${textByteCount} байт UTF-8 против ${byteCount} байт)`
  );
}

/**
 * @param {number} bitCount
 * @param {number} byteCount
 * @returns {string}
 */
function formatDecodeStats(bitCount, byteCount) {
  return `${bitCount} бит, ${byteCount} байт`;
}

/**
 * @param {string} text
 * @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const originalLabel = button.textContent;
  button.textContent = "Скопировано";
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1200);
}

/**
 * @param {boolean} ready
 * @returns {void}
 */
function setCorpusReady(ready) {
  corpusReady = ready;
  encodeButton.disabled = !ready;
  decodeButton.disabled = !ready;
}

/**
 * @returns {import("./grammar-base.js").GrammarSteg}
 */
function requireActiveGrammar() {
  if (!activeGrammar) {
    throw new Error("grammar is not loaded");
  }
  return activeGrammar;
}

/**
 * @returns {void}
 */
function updateGrammarDescription() {
  if (!activeGrammar) {
    return;
  }
  grammarDescription.textContent = activeGrammar.description;
  if (aboutDiffusionDescription) {
    aboutDiffusionDescription.textContent = activeGrammar.diffusionSummary;
  }
}

/**
 * @returns {void}
 */
function populateGrammarVersionSelect() {
  for (const grammarDefinition of listGrammarDefinitions()) {
    const optionElement = document.createElement("option");
    optionElement.value = grammarDefinition.versionId;
    optionElement.textContent = grammarDefinition.displayName;
    grammarVersionSelect.appendChild(optionElement);
  }
  grammarVersionSelect.value = DEFAULT_GRAMMAR_VERSION_ID;
}

/**
 * @param {string} versionId
 * @returns {Promise<void>}
 */
async function activateGrammarVersion(versionId) {
  setCorpusReady(false);
  corpusStatus.textContent = "Загрузка корпуса предложений (~70 МБ)…";
  const grammar = createGrammar(versionId);
  const cachedCorpus = loadedCorporaByUrl.get(grammar.corpusUrl);
  if (cachedCorpus) {
    grammar.setCorpus(cachedCorpus);
  } else {
    await grammar.loadCorpus();
    loadedCorporaByUrl.set(grammar.corpusUrl, grammar.activeCorpus());
  }
  activeGrammar = grammar;
  const corpus = grammar.activeCorpus();
  corpusStatus.textContent = (
    `Корпус загружен: ${corpus.corpusSize.toLocaleString("ru-RU")} предложений, `
    + `${corpus.bitsPerSentence} бит на предложение`
  );
  if (aboutBitsPerSentence) {
    aboutBitsPerSentence.textContent = String(corpus.bitsPerSentence);
  }
  updateGrammarDescription();
  setCorpusReady(true);
}

/**
 * @param {"encode" | "decode" | "about"} tabName
 * @returns {void}
 */
function activateTab(tabName) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  Object.entries(panels).forEach(([name, panel]) => {
    const isActive = name === tabName;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab);
    showMessage("");
  });
});

grammarVersionSelect.addEventListener("change", async () => {
  showMessage("");
  grammarVersionSelect.disabled = true;
  try {
    await activateGrammarVersion(grammarVersionSelect.value);
  } catch (error) {
    corpusStatus.textContent = "Не удалось загрузить корпус";
    setCorpusReady(false);
    showMessage(error instanceof Error ? error.message : String(error));
  } finally {
    grammarVersionSelect.disabled = false;
  }
});

encodeModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    updateEncodeModePanels();
    showMessage("");
  });
});

encodeFileInput.addEventListener("change", () => {
  const selectedFile = encodeFileInput.files && encodeFileInput.files[0];
  if (!selectedFile) {
    encodeFileInfo.textContent = "Файл не выбран";
    return;
  }
  let infoText = `${selectedFile.name} (${formatByteCount(selectedFile.size)})`;
  if (selectedFile.size > LARGE_FILE_WARN_BYTES) {
    infoText += (
      ` — предупреждение: файл больше ${formatByteCount(LARGE_FILE_WARN_BYTES)}, `
      + "кодирование может быть тяжёлым"
    );
  }
  encodeFileInfo.textContent = infoText;
});

encodeButton.addEventListener("click", async () => {
  if (!corpusReady) {
    return;
  }
  const grammar = requireActiveGrammar();
  showMessage("");
  encodeButton.disabled = true;
  try {
    const encodeMode = selectedEncodeMode();
    if (encodeMode === "bits") {
      if (encodeUsePassword.checked || encodeUsePublicKey.checked) {
        throw new Error(
          "В режиме «Поток бит» шифрование недоступно; снимите пароль/ключ или выберите другой режим",
        );
      }
    }
    const encryptOptions = encodeMode === "bits" ? {} : selectedEncryptOptions();
    let coverText = "";
    let sourceByteCount = 0;
    let embeddedBitCount = 0;

    if (encodeMode === "text") {
      if (!confirmUnencryptedEncodeIfNeeded(encryptOptions)) {
        return;
      }
      const payloadBytes = new TextEncoder().encode(encodeTextInput.value);
      sourceByteCount = payloadBytes.length;
      coverText = await encodeTextToCoverText(encodeTextInput.value, grammar, encryptOptions);
      embeddedBitCount = bytesToBits(await prepareEmbeddedBytes(payloadBytes, encryptOptions)).length;
    } else if (encodeMode === "bits") {
      const bitString = encodeInput.value.trim();
      if (!bitString || ![...bitString].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
        throw new Error("Укажите поток из символов 0 и 1");
      }
      coverText = await generateText(bitString, grammar);
      sourceByteCount = Math.floor(bitString.length / 8);
      embeddedBitCount = bitString.length;
    } else {
      const selectedFile = encodeFileInput.files && encodeFileInput.files[0];
      if (!selectedFile) {
        throw new Error("Выберите бинарный файл");
      }
      if (!confirmLargeFileEncodeIfNeeded(selectedFile.size)) {
        return;
      }
      if (!confirmUnencryptedEncodeIfNeeded(encryptOptions)) {
        return;
      }
      const payloadBytes = new Uint8Array(await selectedFile.arrayBuffer());
      sourceByteCount = payloadBytes.length;
      coverText = await encodeBytesToCoverText(payloadBytes, grammar, encryptOptions);
      embeddedBitCount = bytesToBits(await prepareEmbeddedBytes(payloadBytes, encryptOptions)).length;
    }

    lastEncodedCoverText = coverText;
    encodeOutput.textContent = coverText || "(пустой текст)";
    const textByteCount = new TextEncoder().encode(coverText).length;
    encodeStats.textContent = formatEncodeStats(
      embeddedBitCount,
      sourceByteCount,
      textByteCount,
      sourceByteCount > 0 ? textByteCount / sourceByteCount : null,
    );
    encodeStats.hidden = false;
    encodeCopy.hidden = !coverText;
    encodeDownload.hidden = !coverText;
  } catch (error) {
    lastEncodedCoverText = "";
    encodeOutput.textContent = "";
    encodeStats.hidden = true;
    encodeCopy.hidden = true;
    encodeDownload.hidden = true;
    showMessage(error instanceof Error ? error.message : String(error));
  } finally {
    encodeButton.disabled = !corpusReady;
  }
});

decodeButton.addEventListener("click", async () => {
  if (!corpusReady) {
    return;
  }
  const grammar = requireActiveGrammar();
  showMessage("");
  decodeButton.disabled = true;
  try {
    const decryptOptions = selectedDecryptOptions();
    if (decryptOptions.asPgpMessage) {
      const { embeddedBits, payloadBytes, armoredPgpMessage } = await decodeCoverTextToArmoredPgpMessage(
        decodeInput.value,
        grammar,
      );
      lastDecodedBits = embeddedBits;
      lastDecodedBytes = payloadBytes;
      decodeOutput.textContent = lastDecodedBits;
      setDecodeTextOutput(armoredPgpMessage, "PGP MESSAGE (для Kleopatra / gpg)");
      decodeStats.textContent = formatDecodeStats(embeddedBits.length, payloadBytes.length);
      decodeStats.hidden = false;
      decodeCopy.hidden = false;
      decodeDownload.hidden = payloadBytes.length === 0;
    } else {
      const embeddedBits = await parseText(decodeInput.value, grammar);
      const embeddedBytes = bitsToBytes(embeddedBits);
      let payloadBytes = embeddedBytes;
      if (decryptOptions.password !== undefined && decryptOptions.password !== null) {
        try {
          payloadBytes = await restorePayloadBytes(embeddedBytes, {
            password: decryptOptions.password,
          });
        } catch (error) {
          if (!(error instanceof AmbiguousPasswordDecryptError)) {
            throw error;
          }
          const chosenPayloadBytes = await choosePasswordDecryptCandidate(error.candidates);
          if (chosenPayloadBytes === null) {
            throw new Error("Расшифровка отменена");
          }
          payloadBytes = chosenPayloadBytes;
        }
      }
      lastDecodedBits = embeddedBits;
      lastDecodedBytes = payloadBytes;
      decodeOutput.textContent = lastDecodedBits;
      setDecodeTextOutput(bytesToUtf8TextIfValid(payloadBytes));
      decodeStats.textContent = formatDecodeStats(embeddedBits.length, payloadBytes.length);
      decodeStats.hidden = false;
      decodeCopy.hidden = false;
      decodeDownload.hidden = payloadBytes.length === 0;
    }
  } catch (error) {
    lastDecodedBits = "";
    lastDecodedBytes = null;
    setDecodeTextOutput(null);
    decodeOutput.textContent = "";
    decodeStats.hidden = true;
    decodeCopy.hidden = true;
    decodeDownload.hidden = true;
    showMessage(error instanceof Error ? error.message : String(error));
  } finally {
    decodeButton.disabled = !corpusReady;
  }
});

encodeClear.addEventListener("click", () => {
  encodeInput.value = "";
  encodeTextInput.value = "";
  encodeFileInput.value = "";
  encodeUsePassword.checked = false;
  encodePassword.value = "";
  encodePasswordCryptoVersion.value = defaultPasswordCryptoVersionId();
  encodeUsePublicKey.checked = false;
  encodePublicKey.value = "";
  encodePublicKeyName.value = "";
  encodeSavedPublicKey.value = "";
  g_publicKeyNameEditedManually = false;
  updateEncodeCryptoFieldState();
  encodeFileInfo.textContent = "Файл не выбран";
  lastEncodedCoverText = "";
  encodeOutput.textContent = "";
  encodeStats.hidden = true;
  encodeCopy.hidden = true;
  encodeDownload.hidden = true;
  showMessage("");
});

decodeClear.addEventListener("click", () => {
  decodeInput.value = "";
  decodeUsePassword.checked = false;
  decodePassword.value = "";
  decodeAsPgpMessage.checked = false;
  updateDecodeCryptoFieldState();
  decodeOutput.textContent = "";
  setDecodeTextOutput(null);
  decodeStats.hidden = true;
  decodeCopy.hidden = true;
  decodeDownload.hidden = true;
  lastDecodedBits = "";
  lastDecodedBytes = null;
  showMessage("");
});

encodeCopy.addEventListener("click", () => {
  copyText(lastEncodedCoverText || encodeOutput.textContent, encodeCopy);
});

/**
 * @param {string} coverText
 * @returns {string}
 */
function coverTextDownloadFilename(coverText) {
  const words = coverText.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) {
    throw new Error("expected non-empty cover text for download filename");
  }
  const baseName = words
    .join(" ")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!baseName) {
    throw new Error(`expected usable filename from words ${JSON.stringify(words)}, got empty base name`);
  }
  return `${baseName}.txt`;
}

encodeDownload.addEventListener("click", () => {
  if (!lastEncodedCoverText) {
    return;
  }
  const objectUrl = URL.createObjectURL(
    new Blob([lastEncodedCoverText], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = coverTextDownloadFilename(lastEncodedCoverText);
  link.click();
  URL.revokeObjectURL(objectUrl);
});

decodeCopy.addEventListener("click", () => {
  copyText(lastDecodedBits, decodeCopy);
});

decodeUtf8Copy.addEventListener("click", () => {
  if (lastDecodedUtf8Text === null) {
    return;
  }
  copyText(lastDecodedUtf8Text, decodeUtf8Copy);
});

decodeDownload.addEventListener("click", () => {
  if (!lastDecodedBytes || lastDecodedBytes.length === 0) {
    return;
  }
  const objectUrl = URL.createObjectURL(new Blob([lastDecodedBytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "payload.bin";
  link.click();
  URL.revokeObjectURL(objectUrl);
});

encodeInput.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    encodeButton.click();
  }
});

encodeTextInput.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    encodeButton.click();
  }
});

decodeInput.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    decodeButton.click();
  }
});

encodeUsePassword.addEventListener("change", () => {
  if (encodeUsePassword.checked) {
    encodeUsePublicKey.checked = false;
  }
  updateEncodeCryptoFieldState();
  showMessage("");
});

encodeUsePublicKey.addEventListener("change", () => {
  if (encodeUsePublicKey.checked) {
    encodeUsePassword.checked = false;
  }
  updateEncodeCryptoFieldState();
  showMessage("");
});

encodeSavedPublicKey.addEventListener("change", () => {
  showMessage("");
  const selectedName = encodeSavedPublicKey.value;
  if (!selectedName) {
    updateDeletePublicKeyButtonState();
    return;
  }
  void (async () => {
    const savedPublicKey = loadSavedPublicKeys().find((entry) => entry.name === selectedName);
    if (!savedPublicKey) {
      refreshSavedPublicKeyOptions("");
      return;
    }
    try {
      const { fingerprint } = await readPublicKeyMetadata(savedPublicKey.armored);
      if (fingerprint !== savedPublicKey.fingerprint) {
        throw new Error(
          `отпечаток сохранённого ключа «${savedPublicKey.name}» не совпал: `
            + `ожидался ${savedPublicKey.fingerprint}, получен ${fingerprint} `
            + "(запись в браузере могла быть подменена)",
        );
      }
      encodePublicKey.value = savedPublicKey.armored;
      encodePublicKeyName.value = savedPublicKey.name;
      g_publicKeyNameEditedManually = true;
      updateDeletePublicKeyButtonState();
    } catch (error) {
      encodeSavedPublicKey.value = "";
      encodePublicKey.value = "";
      updateDeletePublicKeyButtonState();
      showMessage(error instanceof Error ? error.message : String(error));
    }
  })();
});

encodePublicKey.addEventListener("input", () => {
  encodeSavedPublicKey.value = "";
  updateDeletePublicKeyButtonState();
  autofillPublicKeyName();
});

encodePublicKeyName.addEventListener("input", () => {
  g_publicKeyNameEditedManually = encodePublicKeyName.value.trim().length > 0;
});

encodeSavePublicKey.addEventListener("click", async () => {
  showMessage("");
  try {
    const publicKeyArmored = encodePublicKey.value.trim();
    if (!publicKeyArmored) {
      throw new Error("Вставьте публичный ключ GPG");
    }
    const { fingerprint, defaultName } = await readPublicKeyMetadata(publicKeyArmored);
    const keyName = encodePublicKeyName.value.trim() || defaultName;
    const existingKey = loadSavedPublicKeys().find((entry) => entry.name === keyName);
    if (existingKey) {
      const overwriteConfirmed = window.confirm(
        `Ключ с именем «${keyName}» уже сохранён`
          + (existingKey.fingerprint !== fingerprint
            ? ` (другой отпечаток: ${existingKey.fingerprint} → ${fingerprint})`
            : "")
          + ".\n\nЗаменить сохранённый ключ?",
      );
      if (!overwriteConfirmed) {
        return;
      }
    }
    savePublicKey({ name: keyName, armored: publicKeyArmored, fingerprint });
    refreshSavedPublicKeyOptions(keyName);
    encodePublicKeyName.value = keyName;
    g_publicKeyNameEditedManually = true;
    showMessage(`Публичный ключ сохранён в браузере: ${keyName}`);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error));
  }
});

encodeDeletePublicKey.addEventListener("click", () => {
  showMessage("");
  const selectedName = encodeSavedPublicKey.value;
  if (!selectedName) {
    return;
  }
  deletePublicKey(selectedName);
  refreshSavedPublicKeyOptions("");
  showMessage(`Ключ удалён из браузера: ${selectedName}`);
});

decodeUsePassword.addEventListener("change", () => {
  if (decodeUsePassword.checked) {
    decodeAsPgpMessage.checked = false;
  }
  updateDecodeCryptoFieldState();
  showMessage("");
});

decodeAsPgpMessage.addEventListener("change", () => {
  if (decodeAsPgpMessage.checked) {
    decodeUsePassword.checked = false;
  }
  updateDecodeCryptoFieldState();
  showMessage("");
});

updateEncodeModePanels();
populatePasswordCryptoVersionSelect();
updateEncodeCryptoFieldState();
updateDecodeCryptoFieldState();
refreshSavedPublicKeyOptions();
populateGrammarVersionSelect();
activateGrammarVersion(DEFAULT_GRAMMAR_VERSION_ID).catch((error) => {
  corpusStatus.textContent = "Не удалось загрузить корпус";
  setCorpusReady(false);
  showMessage(error instanceof Error ? error.message : String(error));
});
