const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const files = {
  index: read('public/index.html'),
  app: read('public/app.js'),
  manager: read('public/notification-manager181.js'),
  settings: read('public/settings-fix.js'),
  lifecycle: read('public/room-lifecycle.js'),
  sw: read('public/sw.js'),
  systemChat: read('public/system-chat144.js'),
  server: read('server.js'),
  service: read('src/notification-service181.js'),
  systemEvents: read('src/system-events-server.js'),
  version: read('public/version.json')
};

let failed = 0;
function check(name, condition) {
  if (condition) {
    console.log('PASS', name);
    return;
  }
  failed += 1;
  console.error('FAIL', name);
}
function parseScript(name, source) {
  try {
    new vm.Script(source, { filename: name });
    check(`syntax: ${name}`, true);
  } catch (error) {
    console.error(error);
    check(`syntax: ${name}`, false);
  }
}

for (const [name, source] of Object.entries({
  'public/app.js': files.app,
  'public/notification-manager181.js': files.manager,
  'public/settings-fix.js': files.settings,
  'public/room-lifecycle.js': files.lifecycle,
  'public/sw.js': files.sw,
  'public/system-chat144.js': files.systemChat,
  'server.js': files.server,
  'src/notification-service181.js': files.service,
  'src/system-events-server.js': files.systemEvents
})) parseScript(name, source);

check('NotificationManager loads before settings-fix',
  files.index.indexOf('notification-manager181.js') >= 0
  && files.index.indexOf('notification-manager181.js') < files.index.indexOf('settings-fix.js'));
check('startup dependency records NotificationManager',
  files.index.includes("'notification-manager181.js':['app.js']"));
check('room-lifecycle no longer monkey-patches window.fetch',
  !files.lifecycle.includes('window.fetch = function fpchatLifecycleFetch'));
check('system notifications default enabled',
  files.app.includes('notifySystemEvents:true')
  && files.app.includes('notifySystemEvents:raw.notifySystemEvents!==false'));
check('legacy app bootstrap does not own notification sync',
  !files.app.includes('void initializeNotifications();'));
check('settings expose final system notification label',
  files.settings.includes('Получать системные уведомления')
  && files.settings.includes("id='nSystemEvents'"));
check('NotificationManager owns room and device sync',
  files.manager.includes('/api/push/subscribe')
  && files.manager.includes('/api/push/device/subscribe')
  && files.manager.includes('updateAllSettings')
  && files.manager.includes('unsubscribeAll'));
check('device system setting is sent explicitly',
  files.manager.includes('notifySystemEvents: state.notif.notifySystemEvents !== false'));
check('server routes room delivery through NotificationService181',
  files.server.includes('fpNotification181.sendRoomMessage')
  && files.server.includes('fpNotification181.sendRoomSystemEvent'));
check('device push schema exists',
  files.service.includes('CREATE TABLE IF NOT EXISTS device_push_subscriptions'));
check('personal system delivery is deduplicated',
  files.service.includes('UNIQUE(system_event_id, device_id)')
  && files.service.includes('claimSystem'));
check('personal push re-reads durable SystemEventStore row',
  files.service.includes('systemEventById.get(systemEventId, deviceId)'));
check('SystemEventStore publishes only inserted events',
  files.systemEvents.includes('if (inserted && Number.isSafeInteger(id) && id > 0)')
  && files.systemEvents.includes('publishSystemEventInserted181'));
check('server subscribes NotificationService to system events',
  files.server.includes('subscribeSystemEventInserted((event) => fpNotification181.sendPersonalSystemEvent(event))'));
check('system payload excludes invite/recovery/encryption secrets',
  !files.service.includes('roomSecret')
  && !files.service.includes('inviteCode')
  && !files.service.includes('recoverySecret')
  && !files.service.includes('encryptionKey'));
check('service worker routes personal system click separately',
  files.sw.includes("data.target === 'system'")
  && files.sw.includes("type: 'open-system'"));
check('pending chat request click does not require room id',
  files.manager.includes('openSystemTarget')
  && files.manager.includes('systemEventId'));
check('system chat can focus a specific durable event',
  files.systemChat.includes('data-system-event-id')
  && files.systemChat.includes('focusEventId'));
const releaseBuild = String(JSON.parse(files.version).build);
check('release build has a valid cache-bust id', /^\d+(?:\.\d+)*$/.test(releaseBuild));
check('updater matches current release build', read('update.bat').includes(`set "EXPECTED_BUILD=${releaseBuild}"`));

if (failed) {
  console.error(`Build 181 notification regression failed: ${failed} check(s)`);
  process.exit(1);
}
console.log('Build 181 notification regression PASS');
