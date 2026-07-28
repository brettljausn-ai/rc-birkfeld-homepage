const mysql = require('mysql2');

// Callback-Pool (für express-mysql-session)
const callbackPool = mysql.createPool(process.env.DATABASE_URL);

// Promise-Pool (für alle app-eigenen Queries)
const pool = callbackPool.promise();

module.exports = { pool, callbackPool };
