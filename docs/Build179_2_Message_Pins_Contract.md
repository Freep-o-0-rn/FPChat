# Build 179.2 — message pins server contract

Selected capability: **I2 `installMessagePinsServer`** from the 179.1 inventory.

179.2 changes no runtime code. It freezes the existing contract before any bootstrap migration.

## Test fixture

The integration contract runs the real installer against an in-memory SQLite database and a temporary Express server. Test data contains:

- `room-open` with active Alice (`device-A-1792`) and Bob (`device-B-1792`);
- one revoked participant;
- `room-closed`;
- a separate `room-other`;
- normal text messages 101/102;
- system message 103;
- deleted-for-all message 104;
- message 105 hidden only for Alice;
- message 201 in the other room;
- two simulated sockets for Alice and one for Bob.

## HTTP contract

| Operation | Expected status/body | DB / WS result |
| --- | --- | --- |
| GET pins, unknown room | 404 `{ok:false,error:'room not found'}` | no DB/WS effect |
| GET pins, missing deviceId | 400 `{ok:false,error:'deviceId required'}` | no effect |
| GET pins, unknown or revoked device | 403 `{ok:false,error:'forbidden',code:'ACCESS_REVOKED'}` | no effect |
| POST pin in closed room | 409 `{ok:false,error:'room closed',code:'ROOM_CLOSED'}` | no pin, no WS |
| POST invalid scope/message id | 400 `{ok:false,error:'invalid pin request'}` | no effect |
| POST nonexistent or deleted-for-all message | 404 `{ok:false,error:'message not found'}` | no effect |
| POST system message | 409 `{ok:false,error:'system message cannot be pinned'}` | no effect |
| POST message hidden for current device | 409 `{ok:false,error:'message is hidden for this device'}` | no effect |
| POST shared pin | 200 `{ok:true,scope:'shared',messageId,pins,...roomState}` | one row with `owner_device_id=''`; one room `pins:changed` |
| POST personal pin | 200 `{ok:true,scope:'personal',messageId,pins,...roomState}` | one row owned by device; `pins:changed` to every socket of that device only |
| GET pins as pin owner | 200; same message may combine `shared:true` and `personal:true` | read-only, no WS |
| GET pins as peer | 200; sees shared pin but not another device's personal pin | read-only, no WS |
| POST same personal pin again | 200 | row count remains one for `(room,message,scope,owner)`; existing row is touched; notification still emits |
| DELETE one personal pin | 200 `{ok:true,scope:'personal',messageId,pins,...}` | owner row removed; shared row preserved; device-scoped `unpinned` event |
| DELETE an already absent pin | 200 | remains absent; current contract still emits `pins:changed` |
| DELETE all personal pins for Alice | 200 | Alice's personal pins in room removed; Bob's personal pins preserved; device-scoped `cleared` event with `messageId:null` |
| DELETE all shared pins in room | 200 | shared pins in that room removed; another room's shared pins preserved; room-scoped `cleared` event |
| DELETE pins with invalid scope | 400 `{ok:false,error:'invalid pin scope'}` | no effect |

Successful bodies preserve the current `roomStatePayload` fields: `roomStatus` and `closedAt`. Pin DTOs preserve pin timestamps/by-device fields plus the current message DTO.

## WS contract

Payload shape is frozen as:

`{type:'pins:changed', roomId, messageId, scope, action, actorDeviceId}`.

Actions are `pinned`, `unpinned`, and `cleared`.

- `scope:'personal'` uses `sendToDevice`: every currently registered socket of the owner device receives the event, other devices and room broadcast do not.
- `scope:'shared'` uses `sendToRoomParticipants`: one room broadcast request is made; no direct device send is made by this installer.
- rejected HTTP operations and GET operations emit no pin WS event.

## SQLite contract

`message_pins` uniqueness remains `(room_id, message_id, scope, owner_device_id)`.

- shared rows store `owner_device_id=''`;
- personal rows store the owning `deviceId`;
- `pinned_by_device_id` records the actor;
- touching an existing pin updates it without creating a duplicate;
- personal clear is owner-scoped;
- shared clear is room-scoped;
- the `deleted_for_all` trigger removes pins when a message is globally deleted;
- the message-delete trigger removes pins when the message row is physically deleted.

## Regression command

`npm run test:179:pins-contract`

The script is an integration test: real Express routing + real `better-sqlite3` + the real `installMessagePinsServer`; only WS delivery functions are deterministic recording stubs.
