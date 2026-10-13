# Reference source admission decision

Правило погоджено: автоматичний імпорт за правилами джерела та пропуск невизначених прикладів. Задача 8.1 має manifest `reference/sources/kaikki-en.json` і admission fixtures; activation / full import перевіряються окремо в задачах 8.4 / 8.6.

## Погоджене джерело

- Delivery: `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` — raw extract, без postprocessing / merging інших джерел.
- Source edition: English Wiktionary; language filter: `uk`, `de`, `en`, `vi`.
- Advertised dump revision: `2026-09-02`; extraction date: `2026-10-03`.
- Advertised extractor revisions: `1a05e46` / `e3d6d4e`.
- SHA-256 завантаженого архіву: `3dac8a09e57827bef493e2e6b552fe917bf3b1fc55dee05c4e4a3702aff5dbdb`. Metadata повторно звірено з raw downloads page; mutable URL не замінює checksum / revision manifest.
- Text license candidate: CC-BY-SA-4.0 для матеріалів, на які поширюється ця ліцензія; attribution до Wiktionary contributors, source article / history URL, Kaikki / Wiktextract, license URL і позначка перетворення.
- Exclusions: media / sound URLs, сторонні quotations, fair-use матеріали, невідомі права; dict.cc / DWDS / інші джерела не допускаються.

## Evidence та погоджений критерій

[Kaikki raw downloads](https://kaikki.org/dictionary/rawdata.html) повідомляє metadata наведеного extract і розмір gzip приблизно 2.8 GB. [Wiktionary copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) відрізняє ліцензовані оригінальні тексти від сторонніх матеріалів, зокрема цитат; сама сторінка позначена draft, тому її слід читати разом із [Wikimedia Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use).

У [Wiktextract English data types](https://github.com/tatuylonen/wiktextract/blob/master/src/wiktextract/extractor/en/type_utils.py) `ExampleData` має `text`, `type`, `ref` та інші metadata, але не fragment license. Відсутність `ref` сама по собі не підтверджує ліцензію. Це не висновок, що весь dataset непридатний; це незавершена перевірка дозволу на конкретні приклади.

Обрано автоматичні source rules із виключенням невизначених прикладів. Для початкового raw extract examples не мають достатнього автоматичного rights rule, тому допускаються лише за evidence, прив'язаним до hash повного прикладу. Відсутність такого evidence виключає example, а не дозволені senses / forms того самого слова. Невідомі права самого джерела блокують admission. Це не release sign-off і не юридичний висновок.
