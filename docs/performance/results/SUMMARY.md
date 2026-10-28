# Wyniki pomiaru (generowane przez pnpm perf:report)

P1: 2026-10-28T02:11:51.496Z / 2026-10-28T02:13:12.418Z; P2: 2026-10-28T02:19:59.595Z; Node v24.20.0; 20 s na scenariusz.

## P1 przed i po (zapytania na serwisie, 16 równoległych wywołań, bez limiterów API)

| Scenariusz | p95 przed (ms) | p95 po (ms) | zapytań/s przed | zapytań/s po |
|---|---:|---:|---:|---:|
| sat:availability-single | 1.1 | 0.6 | 19965.6 | 34942.8 |
| sat:availability-batch-50 | 5.9 | 1.2 | 3641.8 | 19129.6 |
| sat:availability-private-100 | 10.2 | 1.7 | 2085.8 | 13117.1 |
| sat:calendar-private-365 | 280.3 | 12.7 | 70.6 | 1623.1 |
| sat:calendar-public-31 | 4.6 | 4.6 | 4250.9 | 4214 |
| sat:admin-list-100 | 39.2 | 32.7 | 515 | 594.9 |
| sat:admin-list-100-availableToday | 43.9 | 39.7 | 427.8 | 489.4 |
| sat:public-catalog-50-available | 29.1 | 31.4 | 688.9 | 659.4 |

## P1 po zmianach: ruch przez handlery z realnymi limitami

| Scenariusz | n | błędy | p50 | p95 | p99 | CPU proc. % | RSS MB | poł. DB max | CPU DB % max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| public-check | 100 | 0 | 10 | 20 | 23.1 | 6.2 | 342 | 2 | 2 |
| public-batch | 100 | 0 | 10.7 | 20.6 | 21.3 | 5.3 | 258 | 2 | 2 |
| public-calendar | 100 | 0 | 9.5 | 20.1 | 20.7 | 4.8 | 266 | 2 | 2 |
| public-catalog-page1 | 100 | 0 | 14.2 | 23.7 | 24.3 | 7.2 | 297 | 2 | 2 |
| public-catalog-available | 100 | 0 | 25.1 | 34 | 34.9 | 6.1 | 350 | 2 | 11 |
| admin-list-100 | 30 | 0 | 26.7 | 34.6 | 34.7 | 3.6 | 353 | 2 | 3 |
| admin-list-100-available | 30 | 0 | 35.1 | 39.4 | 39.8 | 2.5 | 355 | 1 | 8 |
| admin-calendar | 30 | 0 | 12.9 | 20.5 | 21.1 | 2.7 | 357 | 1 | 2 |
| list-100-public:page1 | 50 | 0 | 13.4 | 23.1 | 26.9 |  |  |  |  |
| list-100-public:page2 | 50 | 0 | 8.3 | 15.6 | 16.9 |  |  |  |  |
| list-100-public | 50 | 0 | 22.3 | 31.3 | 33.9 | 5.8 | 359 | 2 | 3 |
| list-100-admin:page1 | 14 | 0 | 18.9 | 22.5 | 22.5 |  |  |  |  |
| list-100-admin:page2 | 14 | 0 | 11.9 | 13.6 | 13.6 |  |  |  |  |
| list-100-admin | 14 | 0 | 31.2 | 33.8 | 33.8 | 2.2 | 360 | 2 | 5 |
| block-delete-handler | 8 | 0 | 8 | 14.5 | 14.5 |  |  |  |  |
| block-write-handler | 8 | 0 | 14.7 | 22.7 | 22.7 | 1.7 | 360 | 1 | 1 |
| block-service-distinct-vehicles | 12723 | 0 | 12.1 | 14.7 | 17 | 77 | 547 | 9 | 54 |
| block-service-same-vehicle | 12850 | 0 | 12 | 14.3 | 17.7 | 74.3 | 548 | 8 | 55 |
| block-service-conflict | 80 | 0 | 3 | 4.3 | 5.7 | 75.3 | 548 | 0 | 0 |
| mixed:public-check | 251 | 0 | 3.5 | 7.1 | 10.2 |  |  |  |  |
| mixed:public-calendar | 42 | 0 | 3.8 | 6.6 | 7.7 |  |  |  |  |
| mixed:public-catalog-available | 64 | 0 | 15.9 | 24.9 | 33.3 |  |  |  |  |
| mixed:public-catalog-page1 | 70 | 0 | 6.8 | 11.7 | 18.1 |  |  |  |  |
| mixed:admin-calendar | 12 | 0 | 5.9 | 16.2 | 16.2 |  |  |  |  |
| mixed:public-batch | 41 | 0 | 4.3 | 8.2 | 9.2 |  |  |  |  |
| mixed:admin-list-100 | 20 | 0 | 14.9 | 23.4 | 24.3 |  |  |  |  |
| mixed:block-write | 8 | 0 | 10.3 | 24.1 | 24.1 |  |  |  |  |
| mixed-peak | 500 | 0 | 5.4 | 19.4 | 24.8 | 11.3 | 692 | 12 | 84 |
| worker-queue | 12574 | 0 | 6.4 | 7.9 | 8.9 | 18.5 | 692 | 7 | 379 |
| ws-chat | 126 | 0 | 19 | 34.1 | 34.6 |  |  |  |  |

## P2 (proponowany w #90, niezatwierdzony)

| Scenariusz | n | błędy | p50 | p95 | p99 | CPU proc. % | RSS MB | poł. DB max | CPU DB % max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| public-check | 100 | 0 | 9.4 | 18 | 22.7 | 5.9 | 337 | 2 | 2 |
| public-batch | 100 | 0 | 10.7 | 15.1 | 19.9 | 5.3 | 260 | 2 | 2 |
| public-calendar | 100 | 0 | 8.9 | 18.6 | 20.2 | 4.5 | 263 | 2 | 2 |
| public-catalog-page1 | 100 | 0 | 14.4 | 24.1 | 27.1 | 7.3 | 298 | 2 | 2 |
| public-catalog-available | 100 | 0 | 26.8 | 33.6 | 36.7 | 5.9 | 351 | 2 | 11 |
| admin-list-100 | 60 | 0 | 26 | 33.5 | 35.5 | 5.6 | 355 | 2 | 6 |
| admin-list-100-available | 60 | 0 | 36.2 | 40.6 | 42.3 | 4.6 | 357 | 1 | 10 |
| admin-calendar | 60 | 0 | 12.7 | 19 | 30 | 4.1 | 358 | 1 | 3 |
| list-100-public:page1 | 50 | 0 | 13.4 | 23.5 | 69.1 |  |  |  |  |
| list-100-public:page2 | 50 | 0 | 8.2 | 10.9 | 13.5 |  |  |  |  |
| list-100-public | 50 | 0 | 22.7 | 33.1 | 74 | 5.3 | 360 | 2 | 3 |
| list-100-admin:page1 | 28 | 0 | 19.6 | 24 | 26.1 |  |  |  |  |
| list-100-admin:page2 | 28 | 0 | 12.5 | 14.1 | 15.8 |  |  |  |  |
| list-100-admin | 28 | 0 | 32.3 | 36.1 | 38.3 | 3.6 | 361 | 2 | 5 |
| block-delete-handler | 16 | 0 | 8.4 | 14.3 | 14.3 |  |  |  |  |
| block-write-handler | 16 | 0 | 14.9 | 22.4 | 22.4 | 2.4 | 361 | 1 | 2 |
| block-service-distinct-vehicles | 12456 | 0 | 12.3 | 15.3 | 19.5 | 76.2 | 549 | 9 | 55 |
| block-service-same-vehicle | 12241 | 0 | 12.8 | 14.9 | 17.8 | 70.9 | 549 | 8 | 58 |
| block-service-conflict | 80 | 0 | 3.2 | 4.6 | 5.7 | 71 | 549 | 0 | 0 |
| mixed:public-check | 251 | 0 | 3.3 | 7.4 | 10.3 |  |  |  |  |
| mixed:public-calendar | 42 | 0 | 3.4 | 6.8 | 7.4 |  |  |  |  |
| mixed:public-catalog-available | 64 | 0 | 15.5 | 21.1 | 23.6 |  |  |  |  |
| mixed:public-catalog-page1 | 70 | 0 | 6.6 | 11.3 | 12.3 |  |  |  |  |
| mixed:admin-calendar | 12 | 0 | 5.8 | 14.5 | 14.5 |  |  |  |  |
| mixed:public-batch | 41 | 0 | 4.2 | 7.1 | 7.6 |  |  |  |  |
| mixed:admin-list-100 | 20 | 0 | 12.8 | 20.7 | 24.7 |  |  |  |  |
| mixed:block-write | 16 | 0 | 8.3 | 23.3 | 23.3 |  |  |  |  |
| mixed-peak | 500 | 0 | 4.7 | 17 | 20.6 | 9.8 | 695 | 12 | 123 |
| worker-queue | 13035 | 0 | 6.1 | 7.7 | 9 | 19 | 695 | 7 | 381 |
| ws-chat | 252 | 0 | 21.3 | 33.5 | 38.6 |  |  |  |  |
