# Free Cloud Deployment & CI/CD Guide

This guide provides step-by-step instructions on how to take Tallyko from your local machine and deploy it live on the internet for **$0/month**, along with full CI/CD automation via GitHub Actions.

Because running a massive stack (Postgres, Redis, MinIO, FastAPI) on a single free server is impossible (free servers usually cap out at 512MB RAM), we must use a **Distributed Free Cloud Architecture**.

## The Architecture Stack
*   **Database (PostgreSQL):** Neon.tech
*   **Cache & Queue (Redis):** Upstash
*   **Object Storage (MinIO alternative):** Cloudflare R2
*   **Backend API (FastAPI):** Render
*   **Frontend Web Dashboard:** Vercel
*   **Frontend Mobile App (POS):** Expo EAS

---

## Step 1: Set Up Cloud Infrastructure (Data Tier)

You must set up your cloud databases first before deploying your code.

### 1. PostgreSQL on Neon.tech
1. Create a free account at [Neon.tech](https://neon.tech/).
2. Click **Create Project**. Name it `tallyko`.
3. Neon will immediately give you a `DATABASE_URL` (e.g., `postgresql://user:pass@ep-cool-db.neon.tech/neondb`).
4. Save this connection string securely. Since our backend uses `asyncpg`, change `postgresql://` to `postgresql+asyncpg://` when setting the environment variable in your backend.

### 2. Redis on Upstash
1. Create a free account at [Upstash](https://upstash.com/).
2. Click **Create Database** under the Redis section. Name it `tallyko-redis`.
3. Once created, copy the `UPSTASH_REDIS_REST_URL` or standard `REDIS_URL`.
4. Save this string. This will replace the local `redis://cache:6379/0` URL.

### 3. Object Storage on Cloudflare R2 (or AWS S3)
Because MinIO is just an S3 clone, our code can instantly talk to Cloudflare R2 or AWS S3.
1. Create an account on [Cloudflare](https://dash.cloudflare.com/) and navigate to **R2 Object Storage**. (You get 10GB free/mo).
2. Create a Bucket named `tallyko-storage`.
3. Go to "Manage R2 API Tokens" and generate an Access Key and Secret Key.
4. Save the S3 API URL (your endpoint), Access Key, and Secret Key.

---

## Step 2: Set Up The Backend (Render)

We will use Render to host the Python FastAPI backend. Render will automatically pull from your GitHub repository.

1. Create a free account at [Render](https://render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub account and select the `Tallyko` repository.
4. **Configuration:**
   *   Name: `tallyko-api`
   *   Runtime: `Python 3`
   *   Build Command: `cd backend && pip install -r requirements.txt`
   *   Start Command: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 10000`
5. **Environment Variables:**
   *   Add all the credentials you gathered from Step 1:
       *   `DATABASE_URL` = `[Your Neon.tech URL]`
       *   `REDIS_URL` = `[Your Upstash URL]`
       *   `MINIO_ENDPOINT` = `[Your Cloudflare R2/S3 Endpoint]`
       *   `MINIO_ACCESS_KEY` = `[Your R2 Access Key]`
       *   `MINIO_SECRET_KEY` = `[Your R2 Secret Key]`
       *   `JWT_SECRET` = `[Generate a random long string]`
6. Click **Create Web Service**. Render will now build and deploy your API! Note the `.onrender.com` URL provided.

---

## Step 3: Set Up The Frontend

Now that the backend is live, we need to point the frontend to it.

### Web Dashboard (Vercel)
If you decide to build a React web dashboard later:
1. Create an account at [Vercel](https://vercel.com/).
2. Import the `Tallyko` GitHub repository.
3. Set the Root Directory to your web folder.
4. Set the Environment Variable `REACT_APP_API_URL` to your Render backend URL.
5. Deploy.

### Mobile App (Expo EAS)
We want to build the actual Android/iOS apps in the cloud.
1. Create a free account at [Expo](https://expo.dev/).
2. In your local terminal, run `npx eas login` and authenticate.
3. In your `frontend/src/services/api.js`, update your `API_URL` to point to the new Render URL (e.g., `https://tallyko-api.onrender.com/api/v1`) instead of `localhost`.
4. Push these changes to GitHub.

---

## Step 4: Connecting the CI/CD Pipeline

To achieve true CI/CD, we want everything to update automatically when you push to GitHub `main`.

### Automating Render Deployments
1. Go to your Render Web Service settings and find the **Deploy Hook URL**.
2. Go to your GitHub repository -> Settings -> Secrets and variables -> Actions.
3. Create a new repository secret called `RENDER_DEPLOY_HOOK` and paste the URL.
4. Now, every time GitHub Actions completes the Pytest tests successfully, it can trigger that URL to instantly update the backend!

### Automating Expo Builds
1. Generate an Expo access token locally by running `npx expo-cli login` then grabbing the token from your profile, or generating an EAS token in the Expo web dashboard.
2. Add the token to GitHub Secrets as `EXPO_TOKEN`.
3. Add an Expo build step to `.github/workflows/ci.yml`:
   ```yaml
   deploy_mobile:
     needs: backend # Only build if backend tests pass
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v3
       - uses: expo/expo-github-action@v8
         with:
           expo-version: latest
           eas-version: latest
           token: ${{ secrets.EXPO_TOKEN }}
       - run: cd frontend && npm ci --legacy-peer-deps
       - run: cd frontend && eas build --platform android --profile preview --non-interactive
   ```
   This will trigger a free cloud build on Expo servers every time you update the code, outputting a fresh `.apk`!

## Conclusion

By routing your traffic through Neon, Upstash, Cloudflare, Render, and Expo, you successfully achieve a massively distributed, robust cloud deployment for $0/month, fully connected by an automated CI/CD pipeline!
