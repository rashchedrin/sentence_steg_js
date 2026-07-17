# Grammar Steg — браузерная версия

Клиентское приложение без бэкенда: произвольные данные прячутся внутри обычного русского текста из большого корпуса предложений. Все вычисления выполняются локально в браузере.

Демо: https://rashchedrin.github.io/sentence_steg_js/

## Версии алгоритма

| Версия | Перемешивание бит | По умолчанию |
|--------|-------------------|--------------|
| **v9** | два раунда XOR + перестановки (MT19937) | |
| **v10** | несбалансированная сеть Фейстеля (SHAKE-256, сид `feistel_iv`, 4 раунда) | ✓ |

Обе версии используют один корпус (`public/data/corpora/v9/sentences.json`) и одинаковую схему кодирования предложений (20 бит на предложение). Парольное шифрование по умолчанию — **gcmwrap** (Argon2id + AES-256-GCM); доступен и устаревший режим GPG (`gpg --symmetric`). При декодировании версия парольного метода подбирается автоматически. Для стеганографического алгоритма (v9/v10) при декодировании нужна та же версия, что при кодировании.

Версия v10 даёт лавинный эффект: изменение одного входного бита меняет примерно половину выходных бит и, соответственно, почти весь cover-текст.

Новые версии добавляются в `src/grammars.js` (реестр) плюс файл `grammar-vN.js` и модуль в `src/bit-diffusion/`.

## Запуск

```bash
./run_server.sh
```

или вручную:

```bash
npm install
npm run dev
```

Откройте http://localhost:5173 — корпус (~70 МБ) загружается в браузер один раз.

Сборка статики:

```bash
npm run build
npm run preview
```

## Деплой на GitHub Pages

В репозитории: **Settings → Pages → Source: GitHub Actions**. При пуше в `main` workflow `.github/workflows/deploy.yml` собирает `dist/` и публикует сайт.

## Тесты

```bash
npm test
npm run test:python   # сверка v9 битов и GPG с Python (нужен gpg и grammar-steg в соседнем репо)
```

## Структура

| Модуль | Назначение |
|--------|------------|
| `src/grammars.js` | реестр версий алгоритма |
| `src/grammar-base.js` | общая логика: корпус, абзацы, split/join |
| `src/grammar-v9.js`, `src/grammar-v10.js` | конфигурации версий |
| `src/bit-diffusion/` | модули перемешивания бит (xor-permute, feistel) |
| `src/codec.js` | `generateText` / `parseText` |
| `src/gpg-crypto.js` | OpenPGP.js (симметричный GPG и публичный ключ) |
| `src/gcmwrap.js` | компактное парольное шифрование Argon2id + AES-GCM |
| `src/password-crypto.js` | реестр версий парольного шифрования |
| `src/payload-codec.js` | UTF-8/bytes + опциональный пароль / публичный ключ |
| `src/app.js` | Web UI |

Корпус: `public/data/corpora/v9/sentences.json` (~70 МБ, в репозитории).
