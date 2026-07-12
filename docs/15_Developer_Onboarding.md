# 15. Developer Onboarding & Local Setup

Welcome to the Tallyko codebase! This guide is designed to help you get the entire application running locally on your computer in minutes. We will cover how to use Docker to run the backend and the Web UI, and how to use Android Studio if you want to preview the actual mobile app.

---

## 1. The "Magic" of Docker (Layman's Explanation)
Think of Docker like a series of tiny, self-contained computers running inside your actual computer. We use Docker so that you don't have to install Python, PostgreSQL databases, or messy server tools directly onto your Windows machine. 
If you run our Docker commands, it will automatically spin up the Database, the Backend API, and the Web UI.

### Key Docker Commands
Open your terminal (e.g., PowerShell) and navigate to the `Tallyko` folder.

- **Start Everything:**
  ```bash
  docker compose up --build
  ```
  *(This builds the code and starts the database, backend, and frontend. Leave this terminal open!)*

- **Stop Everything:**
  ```bash
  docker compose down
  ```
  *(Run this when you are done working for the day).*

- **View Logs for a specific service (like the backend):**
  ```bash
  docker compose logs backend --tail 50
  ```

---

## 2. Previewing the App (Web UI)
We have configured our React Native application to use **React Native Web**. This means the exact same code that runs on mobile phones can be viewed in your Google Chrome or Edge browser!

### How to see the Web UI:
1. Ensure you have run `docker compose up`.
2. Open your web browser and go to: **http://localhost:8081**
3. **Hot-Reloading is Enabled!** If you open `frontend/src/001_auth_tenant/LoginScreen.js` in your code editor and change the text from "Login" to "Sign In", the web browser will instantly refresh to show your changes without you needing to rebuild anything!

### Backend API Preview (Swagger):
1. Go to: **http://localhost:8000/docs**
2. You will see a beautiful interface containing every single API endpoint (Catalog, Billing, CRM, etc). You can even send test data from this screen!

---

## 3. Previewing on Mobile (Android Studio)
While the Web UI is great for fast development, Tallyko is ultimately a mobile POS app. You should periodically test your code on a real Android emulator.

### Step-by-Step Android Studio Guide:
1. **Download & Install:** Download [Android Studio](https://developer.android.com/studio) and install it with default settings.
2. **SDK Setup:** Open Android Studio. Go to `Tools > SDK Manager`. Ensure "Android 13.0 (Tiramisu)" or later is checked.
3. **Create an Emulator (Virtual Phone):** 
   - Go to `Tools > Device Manager` (or "Virtual Device Manager").
   - Click "Create Device". Select a phone like the **Pixel 7**.
   - Download the latest system image (e.g., API 33).
   - Click the "Play" button next to your new device to launch the virtual phone on your screen.
4. **Run the App:** 
   - Open a *new* terminal window.
   - Navigate to the frontend folder: `cd c:\python\Tallyko\frontend`
   - Run the Metro Bundler: `npm start`
   - In yet another terminal window in the frontend folder, run: `npm run android`
5. The Tallyko app will now magically appear and install onto your Android emulator!

---

## 4. Advanced: Tracing Logs (Tracenest)
We use a library called `tracenest` in our Python backend. This allows us to trace exactly what happens when a user clicks a button on the UI.
When you view the backend logs (`docker compose logs backend`), you will see structured JSON logs that contain a `trace_id`. This means if a request fails, you can follow that exact `trace_id` through the logs to see the database query, the exact moment it failed, and why.
