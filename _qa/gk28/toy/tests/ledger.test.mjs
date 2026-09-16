import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postEntry, balanceOf } from '../src/ledger.js';

test('posts a double-entry and reports the harvest cash balance', () => {
  const books = {};
  postEntry(books, { debit: 'cash', credit: 'capital', amount: 40 });
  assert.equal(balanceOf(books, 'cash'), 40);
  assert.equal(balanceOf(books, 'capital'), -40);
});
