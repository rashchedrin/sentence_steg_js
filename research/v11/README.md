# Исследование Grammar Steg v11

## Итог

Подход выполним. Версия v11 использует:

- независимый encoder: `target 20 bits -> base sentence / extra collision candidate`;
- независимый decoder: `sentence -> SHAKE-256/128 -> BDZ MPHF -> 20 bits`;
- MPHF без fingerprints и без membership-проверки, поэтому незнакомое предложение
  тоже всегда получает число от `0` до `2^20 - 1`;
- пунктуационное разбиение после последовательности `[.!?]+`, если дальше
  пробел или конец текста;
- 1 048 576 базовых ключей без дыр и 124 387 дополнительных предложений,
  создающих коллизии.

MPHF по определению не может иметь коллизии на множестве ключей, на котором он
построен. Поэтому MPHF строится на ровно `2^20` базовых предложениях (это даёт
биекцию без дыр), а дополнительные предложения намеренно являются non-members:
тотальная функция MPHF всё равно отображает их в один из существующих индексов.

## Почему BDZ

Для browser runtime выбран BDZ-подобный трёхвершинный hypergraph MPHF:

- runtime lookup — SHAKE-256/128, три 32-битных mix/mod, три 2-битных `g`,
  один rank по bitvector;
- runtime-структура MPHF — 503 854 байта, около 3.844 бит/ключ;
- генератор реализован оффлайн в `bdz-mphf.mjs`; в браузер не попадают
  граф, исходные хэши и build scratch arrays;
- decoder binary не содержит fingerprints или corpus membership.

CHD тоже работоспособен, но при минимальном диапазоне и миллионе ключей требует
больше displacement-данных либо более дорогого поиска. BBHash близок по идее,
но готовый native builder добавил бы внешнюю build-зависимость и сложнее
воспроизводился бы в этом JS-проекте. BDZ получился компактным и строится быстро.

## Данные и коллизии

База — существующий анонимизированный v9 корпус. Дополнительные кандидаты:

- 58 851 отфильтрованное предложение из хвоста актуального русского Tatoeba,
  не вошедшее в первые `2^20`; имена заменены тем же `NameReplacer`, seed
  `20260318`, с сохранением пола и падежа;
- 65 536 уникальных мутаций v9: `ё -> е`, пропущенная запятая,
  перестановка соседних букв или пропуск внутренней буквы.

Всего 1 172 963 кандидата. У 116 086 двадцатибитных значений есть более одного
предложения; максимум — 6 кандидатов на значение. Encoder выбирает вариант
детерминированно по целевому индексу и позиции предложения.

## Проверка отсутствия membership oracle

Decoder:

1. не загружает corpus предложений или fingerprints;
2. не проверяет, известен ли хэш;
3. возвращает индекс для любого sentence hash;
4. принимает последний фрагмент даже без финальной пунктуации;
5. не выполняет exact-regeneration v9/v10, которая раскрывала membership;
6. для редкого all-zero reconstructed stream возвращает поток как есть вместо
   ошибки «нет sentinel».

Следовательно, обычный decoder не отвечает на вопрос «было ли предложение в
словаре encoder». Он выдаёт битовый поток для любого непустого текста. Если
пользователь затем применяет парольную AEAD-расшифровку, успешная
аутентификация показывает наличие корректного payload пользователю с паролем;
это свойство payload encryption, а не corpus membership oracle.

## Воспроизводимость

Среда измеренного запуска:

- Linux x64;
- Node.js v22.14.0;
- `@noble/hashes` из project lockfile;
- CPU: 8 logical cores;
- NVIDIA driver 580.159.03;
- GPU не использовался, peak VRAM = 0.

Последняя полная сборка: SHAKE-хэширование 18.28 с, MPHF build 0.67 с,
verification 0.33 с, весь pipeline 26.68 с; peak RSS 600.54 MiB.

Команды:

```bash
# Быстрый MPHF experiment или полный 2^20:
node research/v11/run-bdz-experiment.mjs public/data/corpora/v9/sentences.json 131072
node research/v11/run-bdz-experiment.mjs public/data/corpora/v9/sentences.json 1048576

# Tatoeba archive кешируется и не перезаписывается при наличии:
mkdir -p research/v11/cache
test -f research/v11/cache/rus_sentences.tsv.bz2 || \
  curl -L https://downloads.tatoeba.org/exports/per_language/rus/rus_sentences.tsv.bz2 \
    -o research/v11/cache/rus_sentences.tsv.bz2

# Использует локальный соседний grammar_steg, без установки пакетов:
python3 research/v11/extract-tatoeba-tail.py

# Строит public/data/corpora/v11/* и лог метрик:
node research/v11/build-v11-artifacts.mjs

npm test
npm run build
```

Полные метрики последней сборки лежат в `results/build-metrics.json`.
