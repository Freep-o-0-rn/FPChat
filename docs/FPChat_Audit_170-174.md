# Исправления аудита накопительной Build 170–174

20.09.2026, ветка `build/174-development`. Исходный код аудита: `33f6c004ed22d13eb1653bc31416cdf46d32376a`. Перед публикацией сохранён новый пользовательский README из `5e5a9e0bbfcb9e393b5d4479e6ce4de0e6c0ea4e`. `main` не обновляется; 175 не начата.

## Разбор замечаний

Нумерация соответствует внешнему аудиту. «Проверено» ниже означает конкретный автоматический сценарий на Linux Chromium, а не полную приёмку на iPhone/Android.

| № | Изменение | Доказательство и граница |
|---|---|---|
| 1 | `uploadEncryptedMediaXhr` стал адаптером `FPNetwork171.upload`; реальный send передаёт operation.signal | Настоящий multipart XHR двух PNG через production bootstrap, счётчик upload +2, полученные оригиналы расшифровываются |
| 2 | Явное закрытие preview отменяет operation/XHR; guard перед WS send; cleanup ждёт завершения операции | Отмена во время шифрования, ответа первого файла и второго файла альбома: нет сообщения, нет pending rows. При задержанном ответе после server commit используется uploadId |
| 3 | Snapshot массива items; удаление элементов отключено во время sending | Реальный upload проверяет disabled remove; в сообщении прикреплены оба файла |
| 4 | Caption остаётся редактируемым во время upload и читается перед окончательным шифрованием/send | Текст меняется при задержанном upload; получено сообщение с новым caption |
| 5 | Draft очищается только при неизменных text/reply исходной операции | A → B → A, новый draft/reply сохранены после завершения реальной media send |
| 6 | Подготовленное окно истории синхронно сверяется со Store непосредственно перед mount | Воспроизведён stale DOM у **уже подготовленного** узла, пока следующий ждёт decrypt. Edit/delete перед mount теперь учитываются. Исходный `appendMessage` уже повторно объединял canonical state после decrypt текущего элемента: именно эта узкая часть внешнего утверждения не подтвердилась |
| 7 | Pruning защищает ключи `replyDependents`, то есть sourceId | После 10 010 canonical records исходный reply-source и ответ доступны |
| 8 | RoomContext/Lifecycle загружаются до app definitions; startup IIFE ждёт connection/room-open/text/media | Прямые `/chat/...` и `/i/...`, задержка room-open 350 мс: ровно один join, owners уже установлены. Invite отображает system events без cannot-decrypt. Отказ room-open даёт retry UI, 0 join |
| 9 | Удалён поздний repair `openChat` в room-lifecycle | Прямые startup tests, задержанный lifecycle из прежней регрессии; повторного repair пути в коде нет |
| 10 | Context close больше не пишет messages.scrollTop | При изменении позиции через FPScroll173 под открытым меню закрытие сохраняет текущую позицию |
| 11 | Message long-press и swipe-to-reply проверяют FPGesture135 при старте/продолжении/срабатывании | Синтетический touch на voice waveform и повышение слоя до modal не вызывают reply/context; обычные swipe и long-press работают. Реальные конкурирующие pointer/touch на телефоне ещё требуют проверки |
| 12 | App, typing, voice, gesture получают browser lifecycle через FPLifecycle170; resume объединяется | Focus/pageshow дают один app sync; pagehide — одно background уведомление. Прямые listeners этих модулей сняты. Это не заявление об удалении всех native listeners из всех исторических дополнений; passive diagnostics и feature-specific наблюдения отдельно |
| 13 | Удалён eager arrayBuffer→Response из network budget; ReadableStream сохраняет backpressure. Один original или четыре thumbnails; consumeMedia удерживает слот до завершения callback/decrypt | Headers приходят до EOF; второй original ждёт окончания потребления первого; stream cancel и AbortSignal освобождают очередь. Context plaintext memo ограничен 8 MiB, gallery отменяет удаляемые assets. Это политика ресурсов, не замер RSS телефона |
| 14 | Pending включены в trim и восстанавливаются локальными страницами из того же MessageStore | 420 pending: установившийся DOM ≤300, первая запись выгружена/восстановлена, ACK после eviction сохраняет clientMessageId, действующая retry-запись остаётся. Новая persistent queue не добавлена |
| 15 | Удалён observer, принимавший любой mount `.mine` за отправку; divider снимается явной живой отправкой | Пакетный jump с историческими исходящими сохраняет divider; прежние сценарии unread и отправки также проходят |

До исправлений реальные сценарии выявили отправку старого caption, сообщение после отмены, стирание нового draft/reply, stale подготовленный узел и потерю reply-source при pruning. Для остальных пунктов проверялись кодовые пути и поведение после изменения; отдельный browser repro на старой ревизии для каждого пункта не заявляется.

## Совместимость и владельцы

- Один actual WebSocket и существующий connection owner сохраняются. Навигация сама по себе не отменяет уже начатую отправку; явная отмена preview отменяет её.
- Старый upload без `uploadId` работает. Новый необязательный 32-hex uploadId стабилен при retry; pending cleanup по нему ограничен комнатой и pending status. Проверены повтор с тем же id, чужая комната и старый запрос. SQL-схема и существующий encrypted-media cache format не менялись.
- Серверное изменение здесь ограничено отменой upload; extraction bootstrap, media temp-file/streaming I/O, SQL/blocks/updater остаются этапами 175.1–175.5.
- `FPCHAT_UPLOAD_DIR` — необязательный override для изолированных тестов; по умолчанию остаётся `data/uploads`.
- После async render canonical edit/delete/status проверяются перед реальным mount. DOM eviction не является удалением сообщения из Store.

## Проверки

| Команда | Результат |
|---|---|
| `npm run check:169-174` | 6 наборов PASS, синтаксис public/inline JS и VM/static invariants |
| `npm run test:173:browser` | 17 PASS / 0 FAIL |
| `npm run test:174:browser` | 17 PASS / 0 FAIL |
| `npm run test:174:audit` | 18 PASS / 0 FAIL |

Всего 52 browser-сценария, включая проверки отсутствия uncaught errors. Audit suite использует production bootstrap, временную SQLite/папку uploads и настоящие XHR; задержки ответа, decrypt и touch/lifecycle управляемые. Он не подставляет `uploadedMedia` вместо загрузки в новых media-тестах. Для точечного воспроизведения есть `AUDIT_FOCUS=<часть имени теста>`; итоговые цифры получены без фильтра.

Две старые статические проверки обновлены под новое имя аргумента и пробелы; browser asserts не ослаблены. Старый тест четырёх media slots теперь проверяет thumbnails, для originals добавлена проверка единственного слота через consume/decrypt.

Среда и новые сырые performance-прогоны приведены в [отчёте 174](FPChat_Build174_Complete.md). Старые сравнительные цифры сохранены с указанием ревизии, а не выданы за повторное сравнение всех версий.

## Что автоматические проверки не доказывают

AES-GCM WebCrypto всё ещё требует полный ciphertext/plaintext одного файла. 100 MiB video, Blob/ObjectURL, browser Cache Storage и соседние gallery assets могут давать значительное потребление памяти. Сетевой слой больше не добавляет полную копию каждого из четырёх originals; абсолютный RSS-предел всего PWA и отсутствие OOM на слабом устройстве **не измерены**. Очередь legacy retry и канонические записи не становятся ограниченными только из-за ограничения DOM.

300 — предел установившегося списка сообщений. Подготовленные страницы и синхронный mount до trim временно добавляют ограниченное число узлов. При недоступном optional history asset остаётся аварийная legacy history, для неё bounded DOM не обещается. Startup map охватывает критическую цепочку, а не все дополнения проекта.

Физические iPhone PWA/Android, microphone/autoplay, клавиатура, push и длительный background/foreground остаются ручной приёмкой. Сравнение полной механики со стабильной 166/168 на устройствах не заменяется этими tests. Новые сообщения пользователя о пропадающем микрофоне и ложном long-press при открытии drawer записаны в [план 175](FPChat_Plan_169-175.md): отдельный клиентский commit, regression, rollback, затем общая проверка 175. Эти два дефекта пока не объявляются исправленными.

## Публикация и откат

Публикуется только `build/174-development`, без изменения `main` и без развёртывания production. Предыдущая ревизия для отката патча: `5e5a9e0bbfcb9e393b5d4479e6ce4de0e6c0ea4e`, сохраняющая пользовательский README. Откат возвращает перечисленные проблемы.

Обновлять сервер и клиент вместе: старый сервер игнорирует uploadIds и не обеспечивает новый cleanup ответа неизвестного клиенту. Номер build остаётся 174; уже открытые страницы нужно перезагрузить после обновления — существующий updater реагирует только на увеличение build. Данные и зависимости переустанавливать не требуется.
