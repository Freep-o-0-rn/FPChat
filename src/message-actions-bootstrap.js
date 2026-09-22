/* Build 179.5: legacy preload compatibility shim.
   Server composition is explicit in server.js; this module intentionally has no loader interception or startup side effects. */
module.exports = Object.freeze({ explicitComposition: true });
