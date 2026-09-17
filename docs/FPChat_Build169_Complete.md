# FPChat Build 169 — завершение диагностической базы

Build 169 завершает подготовительный этап оптимизации и не меняет пользовательскую механику Build 168.

## Что добавлено

- `FPRuntime169` в shadow-mode без владения transport/render/storage/message state.
- Resource Timing, long-task, navigation, DOM, lifecycle, error/rejection и доступные memory snapshots.
- Честное поле `coverage`: неподсчитанные timers/observers не трактуются как ноль.
- Статическая карта подтверждённых legacy polling/fetch/appendMessage/MutationObserver владельцев.
- Ручной measurement API и контрольные `capture()` для одинаковых сценариев.
- Точный marker момента `fpchat:boot-ready` без изменения существующего startup flow.
- Опциональный server sampler: RSS, heap/external/ArrayBuffers, event-loop utilization/delay.
- Отдельный read-only SQLite baseline: aggregate counts, explicit indexes и `EXPLAIN QUERY PLAN` для history/media запросов.
- Диагностические npm-команды не меняют production `npm start`.
- Зафиксирован план Build 169–175 и обязательные сценарии регрессии.

## Граница Build 169

Build 169 не устраняет polling, fetch wrappers, MessageStore fragmentation или server bootstrap. Она делает эти механизмы наблюдаемыми и фиксирует исходную точку перед переносом владения в Build 170+.

Фактические численные baseline-результаты снимаются на развернутой сборке на одинаковых данных и устройствах; до выполнения сценария они не подменяются теоретическими значениями.
