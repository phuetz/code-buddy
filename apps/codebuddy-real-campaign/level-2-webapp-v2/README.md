# Notes Board Application

This is a simple notes board application with a Node.js (Express) backend and a vanilla JavaScript frontend.

## Features

- Add new notes
- Edit existing notes
- Delete notes
- Persist notes locally using `lowdb`

## Installation

1. Clone the repository.
2. Navigate to the project directory.
3. Run `npm install` to install dependencies.

## Usage

1. Start the server: `npm start` or `npm run dev` (for development with nodemon).
2. Open your browser to `http://localhost:3000`.

## API Endpoints

- `GET /api/notes`: Get all notes
- `GET /api/notes/:id`: Get a single note by ID
- `POST /api/notes`: Add a new note (body: `{ content: "Note content" }`)
- `PUT /api/notes/:id`: Update a note (body: `{ content: "Updated content" }`)
- `DELETE /api/notes/:id`: Delete a note by ID

## Running Tests

To run the smoke tests, use the command: `npm test`