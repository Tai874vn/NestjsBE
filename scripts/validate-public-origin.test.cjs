const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePublicOrigin } = require('./validate-public-origin.cjs');

test('accepts canonical HTTPS and local HTTP origins', () => {
  for (const value of ['https://www.jobaura.site', 'https://example.test:8443', 'http://localhost:8080']) {
    assert.equal(validatePublicOrigin(value), value);
  }
});

for (const value of [undefined, '', 'https://example.test:443', 'http://localhost:80', 'https://example.test/', 'https://EXAMPLE.test', 'https://example.test/api', 'https://example.test?debug=1', 'https://example.test#hash', 'https://user:password@example.test', 'javascript:alert(1)', ' https://example.test']) {
  test('rejects a missing, unsafe, or noncanonical public origin', () => {
    assert.throws(() => validatePublicOrigin(value));
  });
}
