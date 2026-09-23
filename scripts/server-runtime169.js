/* Build 169 optional server baseline sampler.
   Disabled unless FPCHAT_DIAGNOSTICS=1.
   It does not patch HTTP, WebSocket, SQLite or application logic. */
'use strict';

if (process.env.FPCHAT_DIAGNOSTICS === '1') {
  const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

  const intervalMs = Math.max(1000, Math.min(60000, Number(process.env.FPCHAT_DIAGNOSTICS_INTERVAL_MS) || 10000));
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();

  function mb(value) {
    return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
  }

  function msFromNs(value) {
    return Math.round((Number(value || 0) / 1e6) * 100) / 100;
  }

  const timer = setInterval(() => {
    try {
      const memory = process.memoryUsage();
      const elu = performance.eventLoopUtilization();
      const sample = {
        tag: 'FPChatServer169',
        at: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        memoryMb: {
          rss: mb(memory.rss),
          heapUsed: mb(memory.heapUsed),
          heapTotal: mb(memory.heapTotal),
          external: mb(memory.external),
          arrayBuffers: mb(memory.arrayBuffers)
        },
        eventLoop: {
          utilization: Math.round(Number(elu.utilization || 0) * 10000) / 10000,
          delayMeanMs: msFromNs(eventLoopDelay.mean),
          delayP95Ms: msFromNs(eventLoopDelay.percentile(95)),
          delayP99Ms: msFromNs(eventLoopDelay.percentile(99)),
          delayMaxMs: msFromNs(eventLoopDelay.max)
        }
      };
      console.log(`[FPDiag169] ${JSON.stringify(sample)}`);
      eventLoopDelay.reset();
    } catch (error) {
      console.warn('[FPDiag169] sampler failed:', error?.message || error);
    }
  }, intervalMs);

  timer.unref?.();

  process.once('exit', () => {
    try { eventLoopDelay.disable(); } catch {}
  });

  console.log(`[FPDiag169] server sampler enabled; interval=${intervalMs}ms`);
}
