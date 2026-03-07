
const fs = require('fs');
const filePath = 'test.js';

fs.readFile(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error(err);
    return;
  }

  const updatedData = data.replace(
    /assert\.strictEqual\(consoleOutput\[0\], \'Task added: \"Buy groceries\" \', \'Test 1 Failed: Incorrect console output\.\'\);/,
    "assert.strictEqual(consoleOutput[0], 'Task added: \"Buy groceries\"', 'Test 1 Failed: Incorrect console output.');"
  );

  fs.writeFile(filePath, updatedData, 'utf8', (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log('test.js updated successfully.');
  });
});
