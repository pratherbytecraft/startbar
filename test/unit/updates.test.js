const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../support/electron');
const { newer } = require('../../src/main/updates');

test('a higher version is newer', () => {
  assert.equal(newer('0.2.6', '0.2.5'), true);
  assert.equal(newer('0.3.0', '0.2.9'), true);
  assert.equal(newer('1.0.0', '0.9.9'), true);
  assert.equal(newer('0.2.10', '0.2.9'), true, 'compared as numbers, not text');
});

test('the same or a lower version is not newer', () => {
  assert.equal(newer('0.2.5', '0.2.5'), false);
  assert.equal(newer('0.2.4', '0.2.5'), false);
  assert.equal(newer('0.1.9', '0.2.0'), false);
});

test('missing parts count as zero and anything after a dash is ignored', () => {
  assert.equal(newer('1.2', '1.2.0'), false);
  assert.equal(newer('1.2.1', '1.2'), true);
  assert.equal(newer('0.3.0-beta.1', '0.3.0'), false);
  assert.equal(newer('0.3.0-beta.1', '0.2.9'), true);
});
