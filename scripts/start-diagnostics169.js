/* Build 169: explicit diagnostic server launcher.
   Production `npm start` is untouched. */
'use strict';

process.env.FPCHAT_DIAGNOSTICS = '1';
if (!process.env.FPCHAT_DIAGNOSTICS_INTERVAL_MS) process.env.FPCHAT_DIAGNOSTICS_INTERVAL_MS = '10000';

require('./server-runtime169');
require('../src/message-actions-bootstrap');
require('../server');
