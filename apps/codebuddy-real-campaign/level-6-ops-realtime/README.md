# IncidentOps Board

This is a real-time Incident Operations Board application built with Node.js (Express), WebSockets, and a simple frontend.

## Features

-   **Backend:**
    -   Express.js server with `/health` endpoint.
    -   RESTful API (`/api/incidents`) for CRUD operations on incidents.
    -   Incidents can have a status (new, in_progress, resolved).
    -   Atomic JSON persistence for incidents in the `data/incidents.json` file.
    -   In-memory asynchronous job system (`/api/jobs`) with a queue.
    -   WebSocket communication for real-time updates on incidents and job statuses.

-   **Frontend:**
    -   A public web interface (`public/index.html`).
    -   Allows users to create new incidents.
    -   Displays a list of active incidents with options to change their status (In Progress, Resolve) or delete them.
    -   Allows users to enqueue new jobs.
    -   Displays a real-time list of jobs and their statuses (queued, running, done, failed) via WebSockets.

## Getting Started

### Prerequisites

-   Node.js (LTS version recommended)
-   npm (Node Package Manager)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd level-6-ops-realtime
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Running the Application

To start the server:

```bash
npm start
```

The server will start on a random available port. You can then open your web browser and navigate to `http://localhost:<port>` to access the IncidentOps Board.

## Development

### Project Structure

-   `src/server.js`: The main backend application with Express, WebSocket, API, and job system.
-   `public/`: Contains the frontend HTML, CSS, and JavaScript files.
    -   `index.html`: Main page.
    -   `style.css`: Basic styling.
    -   `script.js`: Frontend logic for interacting with the API and WebSockets.
-   `data/incidents.json`: JSON file for incident persistence.
-   `smoke-test.mjs`: An end-to-end smoke test script.
-   `package.json`: Project metadata and dependencies.

### Scripts

-   `npm start`: Starts the IncidentOps Board server.
-   `npm run smoke-test`: Runs the automated smoke test suite.

## Smoke Test

The `smoke-test.mjs` script performs a comprehensive end-to-end test of the application:

1.  Starts the server on a random port.
2.  Verifies the `/health` endpoint.
3.  Creates, updates, and deletes an incident via the API.
4.  Enqueues a job and monitors its status via HTTP polling.
5.  Enqueues another job and monitors its status in real-time using two WebSocket clients.
6.  Cleans up the server process and the `incidents.json` data file.

To run the smoke test:

```bash
npm run smoke-test
```

If all tests pass, the script will output "All smoke tests passed!". If any test fails, it will report the error and exit with a non-zero code.
