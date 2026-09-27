# Build 190 — media swipe + preview recovery

## База

Ветка Build 190 ответвлена от `build/189.9` в точке, где `public/version.json` уже содержит Build 189.11. Build 190 не вводит новый manager/arbiter и не переносит существующие обязанности между доменами.

## Ответственные

| Зона | Ответственный | Контракт Build 190 |
|---|---|---|
| Приоритет слоя и допуск жеста | `FPLayer173 + FPGesture135` | Только существующий arbiter может выдать `viewer:interaction`. Видео не захватывает жест на tap; claim происходит только после axis-lock реального drag. |
| Исполнение жеста viewer | `media-gallery134.js` / runtime owner `media-gallery185` | Исполняет horizontal prev/next, vertical dismiss и существующий photo pinch/pan. Не становится новым arbiter. |
| Жизненный цикл viewer | `FPMediaManager177` | По-прежнему только identity/open/close delegation viewer и уже закреплённый lifecycle preview. Build 190 не переносит сюда codec/thumbnail generation. |
| Подготовка thumbnail перед preview | существующие workers `createImageThumbBlob / createVideoThumbBlob / openMediaPreviewFromFiles` | Дожидаются декодируемого video frame; zero-byte thumbnail больше не создаётся. При невозможности снять кадр создаётся валидный локальный video placeholder. |
| Отправка медиа | `FPMediaSend170 + FPSendManager177` | Перед encryption/upload проверяет, что подготовленный thumbnail непустой. Не создаёт thumbnail и не меняет codec. |
| Media I/O и cache | `FPNetwork171` через `readEncryptedMedia174` | Первичный `/thumb` остаётся основным путём. Только при отсутствующем/битом video thumbnail лениво читается `/blob` и локально строится fallback. Прямой второй fetch-owner не появляется. |
| Серверная инварианта | существующий `/api/rooms/:publicId/media/upload` | Не принимает отсутствующий thumbnail, `thumbSizeBytes <= 0` или AES-GCM payload размера пустого plaintext. |
| DOM сообщения | существующий `appendMessage` consumer | Монтирует thumbnail, слушает decode error и запускает максимум один video fallback. Не получает network ownership. |

## Жесты видео

Схема Build 190:

```text
pointerdown на <video>
        |
        v
FPLayer173 -> viewer
        |
        v
FPGesture135.watchAction(viewer:interaction)
        |
        +-- tap / движение < AXIS_LOCK --> claim НЕ выполняется
        |                              native video controls остаются живы
        |
        +-- horizontal / vertical drag >= AXIS_LOCK
                                       |
                                       v
                         FPGesture135.claim()
                                       |
                                       v
                         media-gallery executor
                         ├─ horizontal -> prev/next
                         └─ vertical   -> dismiss
```

Для фото существующее поведение Build 185 сохраняется: первый pointer по-прежнему допускается сразу, pinch/pan остаются внутри `media-gallery134.js`, а lifecycle viewer остаётся у `FPMediaManager177`.

## Thumbnail pipeline

Новый исходящий media item не должен достигать upload с пустым preview:

```text
file
 -> existing thumbnail worker
 -> decoded video frame
 -> WebP Blob size > 0
 -> FPMediaSend170 invariant
 -> encrypt
 -> FPNetwork171.upload
 -> server invariant
```

Для старого сообщения с повреждённым thumbnail:

```text
appendMessage
 -> /thumb via readEncryptedMedia174 / FPNetwork171
 -> empty/fetch/decode error?
      no  -> render
      yes -> video only, one lazy /blob fallback
             -> local frame extraction
             -> render fallback thumbnail
```

Fallback не выполняется для обычных изображений и не загружает original video, если штатный thumbnail корректен.

## Не меняем

- `FPMediaManager177` не получает codec/thumbnail-generation ownership.
- `FPNetwork171` остаётся единственным network/cache owner.
- `FPGesture135` остаётся единственным gesture arbiter.
- `navigateGallery()`, room-wide hydration и asset cache viewer не переписываются.
- Photo pinch 185, reply swipe 184, message reactions 188 и context menu 189 не затрагиваются.

## Приёмка

Build 190 считается готовым только если:

1. tap по video не claim-ит `viewer:interaction` и native controls остаются кликабельны;
2. swipe left/right, начатый по video, переключает media;
3. swipe up/down, начатый по video, закрывает viewer;
4. photo pinch/pan Build 185 остаётся зелёным;
5. отсутствующий или недекодируемый video thumbnail получает ровно один lazy fallback;
6. новые отправки не могут записать zero-byte thumbnail;
7. server отклоняет zero-thumbnail invariant violation;
8. owner/arbiter contracts остаются без второго gesture/network/media lifecycle владельца.
