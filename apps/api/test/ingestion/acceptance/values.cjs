const { createHash } = require('node:crypto');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, '');
module.exports = { digest, normalize };
