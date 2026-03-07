const fs = require('fs');
const DB_FILE = './tasks.json';

function loadTasks() {
  if (!fs.existsSync(DB_FILE)) {
    return [];
  }
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
}

function saveTasks(tasks) {
  fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

function addTask(description) {
  const tasks = loadTasks();
  const newTask = {
    id: tasks.length > 0 ? Math.max(...tasks.map(task => task.id)) + 1 : 1,
    description,
    completed: false,
  };
  tasks.push(newTask);
  saveTasks(tasks);
  console.log(`Task added: "${description}"`);
}

function listTasks() {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }
  tasks.forEach(task => {
    console.log(`${task.id}. [${task.completed ? 'x' : ' '}] ${task.description}`);
  });
}

function completeTask(id) {
  const tasks = loadTasks();
  const taskIndex = tasks.findIndex(task => task.id === id);
  if (taskIndex === -1) {
    console.log(`Task with ID ${id} not found.`);
    return;
  }
  tasks[taskIndex].completed = true;
  saveTasks(tasks);
  console.log(`Task ${id} marked as complete.`);
}

function removeTask(id) {
  let tasks = loadTasks();
  const initialLength = tasks.length;
  tasks = tasks.filter(task => task.id !== id);
  if (tasks.length === initialLength) {
    console.log(`Task with ID ${id} not found.`);
    return;
  }
  saveTasks(tasks);
  console.log(`Task ${id} removed.`);
}

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'add':
    if (args.length === 0) {
      console.log('Usage: node index.js add <description>');
      break;
    }
    addTask(args.join(' '));
    break;
  case 'list':
    listTasks();
    break;
  case 'complete':
    if (args.length === 0 || isNaN(args[0])) {
      console.log('Usage: node index.js complete <task_id>');
      break;
    }
    completeTask(parseInt(args[0]));
    break;
  case 'remove':
    if (args.length === 0 || isNaN(args[0])) {
      console.log('Usage: node index.js remove <task_id>');
      break;
    }
    removeTask(parseInt(args[0]));
    break;
  default:
    console.log('Usage: node index.js <add|list|complete|remove> [arguments]');
    break;
}
