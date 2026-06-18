# Grammar Steg v9 — браузерная версия

Клиентское приложение без бэкенда, совместимое с Python [`grammar-steg`](../README.md) v9:

- те же биты препроцессинга (CPython MT19937 + SHA-256 seed);
- тот же корпус `data/corpora/v9/sentences.json`;
- GPG-совместимое симметричное шифрование (AES128 + ZIP, OpenPGP binary);
- перекрёстное кодирование/декодирование бит и полезной нагрузки с Python.

Абзацы в cover-тексте разбиваются с **тем же распределением длин**, что в Python v7/v8/v9, но сид — FNV-1a (не `hash()` Python). На биты это не влияет: при декодировании `\n\n` схлопываются в пробел.

## Запуск

```bash
cd sentence_steg_js
npm install
npm run dev
```

Откройте http://localhost:5173 — корпус (~70 МБ) загружается в браузер один раз.

Сборка статики:

```bash
npm run build
npm run preview
```

## Тесты

```bash
npm test
npm run test:python   # сверка битов и GPG с Python (нужен gpg в PATH)
```

## Структура

| Модуль | Назначение |
|--------|------------|
| `src/python-random.js` | CPython MT19937 |
| `src/paragraph.js` | распределение длин абзацев |
| `src/bit-preprocess.js` | XOR + перестановки бит |
| `src/codec.js` | `generateText` / `parseText` |
| `src/gpg-crypto.js` | OpenPGP.js ↔ system gpg |
| `src/payload-codec.js` | UTF-8/bytes + опциональный пароль |
| `src/app.js` | Web UI |

Корпус: симлинк `public/data/corpora/v9/sentences.json` → `../../data/corpora/v9/sentences.json`.
