const { pool } = require('./db');

const SKIP = /^(\/api\/|\/admin|\/club|\/fonts\/|\/images\/|\/css\/|\/js\/|\/favicon|\/sitemap)/;

function normalizePage(path) {
  return path
    .replace(/\/bericht\/\d+.*/, '/bericht/:id')
    .replace(/\/termin\/\d+.*/, '/termin/:id')
    .substring(0, 100) || '/';
}

async function trackView(req, res, next) {
  if (req.method !== 'GET' || SKIP.test(req.path)) return next();
  const page = normalizePage(req.path);
  pool.query(
    'INSERT INTO page_views (page, view_date, count) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE count = count + 1',
    [page]
  ).catch(() => {});
  next();
}

module.exports = { trackView };
