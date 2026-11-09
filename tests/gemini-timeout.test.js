import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiTimeoutMs, DEFAULT_TIMEOUT_MS} from '../server/gemini.js';

test('Gemini timeout accepts only bounded integer milliseconds', () => {
  for (const value of [undefined, '', '0', '999', '90001', '-1', '1e3', '30000ms', '1.5', '999999999999999999999']) {
    assert.equal(geminiTimeoutMs(value), DEFAULT_TIMEOUT_MS);
  }
  for (const value of [1000, 30000, 60000, 90000]) assert.equal(geminiTimeoutMs(String(value)), value);
});
