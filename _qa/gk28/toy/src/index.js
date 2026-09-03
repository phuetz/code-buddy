import { postEntry, balanceOf } from './ledger.js';

const books = {};
postEntry(books, { debit: 'cash', credit: 'capital', amount: 100 });
process.stdout.write(`${balanceOf(books, 'cash')}\n`);
