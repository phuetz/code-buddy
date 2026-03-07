# Task Manager Application

This is a full-stack task manager application with local authentication, built with Express.js, file-based persistence, and a simple vanilla JavaScript frontend.

## Features

- User registration, login, and logout
- Session management using cookies
- Local JSON persistence for users and tasks (cross-platform fallback without native binaries)
- CRUD operations for tasks, protected by user authentication
- Input validation and error handling
- `/health` endpoint for readiness checks

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm
- No native build tools required.

### Installation

1. Clone the repository (if applicable):
   ```bash
   git clone <repository-url>
   cd task-manager
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```

### Running the Application

To start the server:

```bash
npm start
```

The application will be accessible at `http://localhost:3000`.

### Smoke Test

To run the smoke tests:

```bash
npm run smoke-test
```

This will start the server, run a series of API tests for registration, login, task management, and logout, and then shut down the server. It also cleans up the test data files (`database.db.json` and `database.db.json.tmp`).

## Project Structure

- `package.json`: Project dependencies and scripts.
- `server.mjs`: The backend Express.js server with API endpoints for authentication and task management.
- `public/`:
  - `index.html`: The main frontend HTML file.
  - `app.js`: The frontend JavaScript for interacting with the backend API.
- `smoke-test.mjs`: Automated tests for the API endpoints.
- `README.md`: This file.
