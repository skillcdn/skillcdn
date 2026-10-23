# Vendrel Federation library

A test-only document pack in six languages: the library of the Office of Research and Defense Materiel of the Vendrel Federation, an invented federation. Each language folder holds the documents of one research institute and one formation of the Federation's fictional defense force, written in that language, on two domains: research practice (laboratory access, samples and reagents, calibration, data handling, procurement, safety, test methods, quality systems) and defense (maintenance, supply, acquisition, communications, training, standards), the latter at the level of published manuals, doctrine, standards and glossaries. Everything here is invented for the second retrieval evaluation set in `apps/server/fixtures/retrieval/`: no organization, unit, institute, person, place, product, code or figure describes a real one, and nothing in it is a security procedure of anyone.

- `en/`: the Marrowfield Materials Characterization Centre and the Materiel Standards Directorate, in English.
- `ko/`: 서돌재료연구원 and 서돌 군수지원단, in Korean.
- `ja/`: 蒼陵計測研究所 and 北嶺地区支援隊, in Japanese.
- `zh/`: 青岚材料研究院 and 青岚联合保障旅, in Chinese.
- `de/`: the Orvane-Institut für Werkstoffprüfung and the Versorgungsbataillon Kessbach, in German.
- `ru/`: ИПФ «Орван» and the brigade «Вереск», in Russian.

Each folder has its own manifest declaring the language and a map in `docs/README.md`; the documents are under `docs/research/` and `docs/defense/`.
