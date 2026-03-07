
file_content=$(cat smoke-test.mjs)
new_content=$(echo "$file_content" | sed 's/\nimport { spawn } from \'child_process\';\n\nasync function runTests() {/import { spawn } from \'child_process\';\n\nasync function runTests() {/g')
echo "$new_content" > smoke-test.mjs
