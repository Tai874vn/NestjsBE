const { URL } = require('node:url');

function validatePublicOrigin(value) {
  const message =
    'JOBAURA_PUBLIC_URL must be a canonical HTTP(S) origin without credentials, paths, a trailing slash, or an explicit default port';
  if (typeof value !== 'string' || !value) throw new Error(message);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error(message);
  }
  return value;
}

module.exports = { validatePublicOrigin };

if (require.main === module) {
  try {
    validatePublicOrigin(process.env.JOBAURA_PUBLIC_URL);
    console.log('Production public origin is valid');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
