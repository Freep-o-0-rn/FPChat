'use strict';

if (process.env.FPCHAT_NEXT10_SERVER_TIMING === '1') {
  const http = require('node:http');
  const originalEmit = http.Server.prototype.emit;
  const target = (url) => /^\/api\/rooms\/[^/]+\/(?:join|messages)(?:\?|$)/.test(String(url || ''));

  http.Server.prototype.emit = function next10ServerTimingEmit(event, req, res, ...rest) {
    if (event === 'request' && req && res && target(req.url)) {
      const started = process.hrtime.bigint();
      const originalEnd = res.end;
      let measured = false;
      res.end = function next10MeasuredEnd(...args) {
        if (!measured) {
          measured = true;
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          if (!res.headersSent) {
            const value = 'fpserver;dur=' + ms.toFixed(3);
            const previous = res.getHeader('Server-Timing');
            res.setHeader('Server-Timing', previous ? String(previous) + ', ' + value : value);
            res.setHeader('X-FP-Diag-Server-Ms', ms.toFixed(3));
          }
        }
        return originalEnd.apply(this, args);
      };
    }
    return originalEmit.call(this, event, req, res, ...rest);
  };
}
