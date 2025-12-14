// Hello World Grok Script
// Test basic functionality

// Variables
let message = "Hello from Grok Script!"
console.log(message)

// Math operations
let x = 10
let y = 20
let sum = x + y
console.log("Sum: " + sum)

// Array test
let items = [1, 2, 3, 4, 5]
console.log("Array length: " + items.length)

// Object test
let config = {
  name: "test",
  value: 42
}
console.log("Config name: " + config.name)

// Function test
function greet(name) {
  return "Hello, " + name + "!"
}

let greeting = greet("World")
console.log(greeting)

// Control flow
if (sum > 25) {
  console.log("Sum is greater than 25")
} else {
  console.log("Sum is 25 or less")
}

// For loop
let total = 0
for (let i = 1; i <= 5; i = i + 1) {
  total = total + i
}
console.log("Total 1-5: " + total)

// Return final value
"Script completed successfully!"
