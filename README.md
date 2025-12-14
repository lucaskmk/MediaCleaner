
The app uses the File System Access API: reads, copies, and deletions are performed locally and only with the user’s explicit permission.

The "Save progress" button generates a JSON file and triggers a local download — it is not sent to any server.

There are no analytics, backend services, or endpoints that receive files.

This contains everything you need to run your app locally.

## Run Locally
**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
