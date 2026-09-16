/** Nimbus Ledger core. Marker: NIMBUS_LEDGER_MARK=7f3a */

export function postEntry(books, { debit, credit, amount }) {
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('amount must be a positive number');
  }
  books[debit] = (books[debit] ?? 0) + amount;
  books[credit] = (books[credit] ?? 0) - amount;
  return books;
}

export function balanceOf(books, account) {
  return books[account] ?? 0;
}
