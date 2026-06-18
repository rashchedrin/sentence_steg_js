/** Client-side Web UI for grammar steg v9 (no backend). */

import { bytesToBits, bytesToUtf8TextIfValid } from "./binary-payload.js";
import { generateText } from "./codec.js";
import {
  grammarV9,
} from "./grammar-v9.js";
import {
  decodeCoverTextToBytes,
  encodeBytesToCoverText,
  encodeTextToCoverText,
  prepareEmbeddedBytes,
} from "./payload-codec.js";

const tabButtons = document.querySelectorAll(".tab");
const panels = {
  encode: document.getElementById("panel-encode"),
  decode: document.getElementById("panel-decode"),
  about: document.getElementById("panel-about"),
};

const corpusStatus = document.getElementById("corpus-status");
const aboutBitsPerSentence = document.getElementById("about-bits-per-sentence");

const encodeModeInputs = document.querySelectorAll('input[name="encode-mode"]');
const encodeBitsPanel = document.getElementById("encode-bits-panel");
const encodeFilePanel = document.getElementById("encode-file-panel");
const encodeTextPanel = document.getElementById("encode-text-panel");
const encodeInput = document.getElementById("encode-input");
const encodeTextInput = document.getElementById("encode-text-input");
const encodeFileInput = document.getElementById("encode-file");
const encodeFileInfo = document.getElementById("encode-file-info");
const encodeOutput = document.getElementById("encode-output");
const encodeStats = document.getElementById("encode-stats");
const encodeButton = document.getElementById("encode-button");
const encodeClear = document.getElementById("encode-clear");
const encodeCopy = document.getElementById("encode-copy");
const encodeUsePassword = document.getElementById("encode-use-password");
const encodePassword = document.getElementById("encode-password");

const decodeInput = document.getElementById("decode-input");
const decodeUtf8Section = document.getElementById("decode-utf8-section");
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

const messageBox = document.getElementById("message");

/** @type {string} */
let lastDecodedBits = "";

/** @type {string | null} */
let lastDecodedUtf8Text = null;

/** @type {Uint8Array | null} */
let lastDecodedBytes = null;

/** @type {boolean} */
let corpusReady = false;

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
 * @returns {void}
 */
function updateEncodeModePanels() {
  const encodeMode = selectedEncodeMode();
  encodeBitsPanel.hidden = encodeMode !== "bits";
  encodeFilePanel.hidden = encodeMode !== "file";
  encodeTextPanel.hidden = encodeMode !== "text";
}

/**
 * @param {HTMLInputElement} usePasswordInput
 * @param {HTMLInputElement} passwordInput
 * @returns {string | null}
 */
function selectedPassword(usePasswordInput, passwordInput) {
  if (!usePasswordInput.checked) {
    return null;
  }
  const passwordValue = passwordInput.value;
  if (!passwordValue) {
    throw new Error("Укажите пароль");
  }
  return passwordValue;
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
 * @param {string | null} utf8Text
 * @returns {void}
 */
function setDecodeUtf8Output(utf8Text) {
  lastDecodedUtf8Text = utf8Text;
  if (utf8Text === null) {
    decodeUtf8Section.hidden = true;
    decodeUtf8Output.textContent = "";
    decodeUtf8Copy.hidden = true;
    return;
  }
  decodeUtf8Section.hidden = false;
  decodeUtf8Output.textContent = utf8Text === "" ? "(пустой текст)" : utf8Text;
  decodeUtf8Copy.hidden = false;
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
 * @returns {Promise<void>}
 */
async function loadCorpus() {
  corpusStatus.textContent = "Загрузка корпуса предложений (~70 МБ)…";
  try {
    await grammarV9.loadCorpus();
    const corpus = grammarV9.activeCorpus();
    corpusStatus.textContent = (
      `Корпус загружен: ${corpus.corpusSize.toLocaleString("ru-RU")} предложений, `
      + `${corpus.bitsPerSentence} бит на предложение`
    );
    if (aboutBitsPerSentence) {
      aboutBitsPerSentence.textContent = String(corpus.bitsPerSentence);
    }
    setCorpusReady(true);
  } catch (error) {
    corpusStatus.textContent = "Не удалось загрузить корпус";
    setCorpusReady(false);
    showMessage(error instanceof Error ? error.message : String(error));
  }
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
  encodeFileInfo.textContent = `${selectedFile.name} (${selectedFile.size} байт)`;
});

encodeButton.addEventListener("click", async () => {
  if (!corpusReady) {
    return;
  }
  showMessage("");
  encodeButton.disabled = true;
  try {
    const password = selectedPassword(encodeUsePassword, encodePassword);
    const encodeMode = selectedEncodeMode();
    let coverText = "";
    let sourceByteCount = 0;
    let embeddedBitCount = 0;

    if (encodeMode === "text") {
      const payloadBytes = new TextEncoder().encode(encodeTextInput.value);
      sourceByteCount = payloadBytes.length;
      coverText = await encodeTextToCoverText(encodeTextInput.value, grammarV9, password);
      embeddedBitCount = bytesToBits(await prepareEmbeddedBytes(payloadBytes, password)).length;
    } else if (encodeMode === "bits") {
      const bitString = encodeInput.value.trim();
      if (!bitString || ![...bitString].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
        throw new Error("Укажите поток из символов 0 и 1");
      }
      coverText = await generateText(bitString, grammarV9);
      sourceByteCount = Math.floor(bitString.length / 8);
      embeddedBitCount = bitString.length;
    } else {
      const selectedFile = encodeFileInput.files && encodeFileInput.files[0];
      if (!selectedFile) {
        throw new Error("Выберите бинарный файл");
      }
      const payloadBytes = new Uint8Array(await selectedFile.arrayBuffer());
      sourceByteCount = payloadBytes.length;
      coverText = await encodeBytesToCoverText(payloadBytes, grammarV9, password);
      embeddedBitCount = bytesToBits(await prepareEmbeddedBytes(payloadBytes, password)).length;
    }

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
  } catch (error) {
    encodeOutput.textContent = "";
    encodeStats.hidden = true;
    encodeCopy.hidden = true;
    showMessage(error instanceof Error ? error.message : String(error));
  } finally {
    encodeButton.disabled = !corpusReady;
  }
});

decodeButton.addEventListener("click", async () => {
  if (!corpusReady) {
    return;
  }
  showMessage("");
  decodeButton.disabled = true;
  try {
    const password = selectedPassword(decodeUsePassword, decodePassword);
    const { embeddedBits, payloadBytes } = await decodeCoverTextToBytes(
      decodeInput.value,
      grammarV9,
      password,
    );
    lastDecodedBits = embeddedBits;
    lastDecodedBytes = payloadBytes;
    decodeOutput.textContent = lastDecodedBits;
    setDecodeUtf8Output(bytesToUtf8TextIfValid(payloadBytes));
    decodeStats.textContent = formatDecodeStats(embeddedBits.length, payloadBytes.length);
    decodeStats.hidden = false;
    decodeCopy.hidden = false;
    decodeDownload.hidden = payloadBytes.length === 0;
  } catch (error) {
    lastDecodedBits = "";
    lastDecodedBytes = null;
    setDecodeUtf8Output(null);
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
  updatePasswordFieldState(encodeUsePassword, encodePassword);
  encodeFileInfo.textContent = "Файл не выбран";
  encodeOutput.textContent = "";
  encodeStats.hidden = true;
  encodeCopy.hidden = true;
  showMessage("");
});

decodeClear.addEventListener("click", () => {
  decodeInput.value = "";
  decodeUsePassword.checked = false;
  decodePassword.value = "";
  updatePasswordFieldState(decodeUsePassword, decodePassword);
  decodeOutput.textContent = "";
  setDecodeUtf8Output(null);
  decodeStats.hidden = true;
  decodeCopy.hidden = true;
  decodeDownload.hidden = true;
  lastDecodedBits = "";
  lastDecodedBytes = null;
  showMessage("");
});

encodeCopy.addEventListener("click", () => {
  copyText(encodeOutput.textContent, encodeCopy);
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
  updatePasswordFieldState(encodeUsePassword, encodePassword);
  showMessage("");
});

decodeUsePassword.addEventListener("change", () => {
  updatePasswordFieldState(decodeUsePassword, decodePassword);
  showMessage("");
});

updateEncodeModePanels();
updatePasswordFieldState(encodeUsePassword, encodePassword);
updatePasswordFieldState(decodeUsePassword, decodePassword);
loadCorpus();
