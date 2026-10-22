const { ensureSchema, ok, err } = require('./_db');
exports.handler = async () => {
  try { await ensureSchema(); return ok({ initialized: true }); }
  catch (e) { console.error(e); return err(500, 'DB init failed: ' + e.message); }
};
