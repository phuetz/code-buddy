// Grok Script - File and Bash Operations Test
// Paths are relative to script's directory
console.log("=== Testing File Operations ===")

// Write a test file
let testContent = "Hello from Grok Script!\nLine 2\nLine 3"
file.write("./output.txt", testContent)
console.log("File written successfully")

// Read the file back
let content = file.read("./output.txt")
console.log("File content: " + content)

// Check if file exists
let exists = file.exists("./output.txt")
console.log("File exists: " + exists)

// List files in current directory (script's directory)
let files = file.list(".")
console.log("Files in current dir:")
for f in files {
  console.log("  - " + f)
}

console.log("")
console.log("=== Testing Bash Operations ===")

// bash.exec returns stdout directly (throws on error)
let result = bash.exec("echo 'Hello from Bash!'")
console.log("Bash result: " + result)

// bash.run returns an object with stdout, stderr, code
let runResult = bash.run("echo 'Testing run'")
console.log("Run stdout: " + runResult.stdout)
console.log("Run code: " + runResult.code)

// Get current directory
let pwd = bash.exec("pwd")
console.log("Working directory: " + pwd)

// Clean up
file.delete("./output.txt")
console.log("")
console.log("Test file cleaned up")

"All file and bash tests completed!"
