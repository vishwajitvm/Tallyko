# Infrastructure Usage Guide: Databases, Caches, & File Storage

This document provides a layman-friendly, detailed breakdown of the three main infrastructure components powering Tallyko: **PostgreSQL**, **Redis**, and **MinIO**. It explains what they are, why they are used, how to access them, and provides real-world examples of how data flows through them during everyday use.

---

## 1. PostgreSQL (The Relational Database)

### What is it?
PostgreSQL (often called Postgres) is like a giant, highly organized digital filing cabinet. It uses tables (rows and columns) to store structured data. It is known for being incredibly strict about rules, ensuring data is never lost or corrupted (a concept called ACID compliance).

### Why do we use it in Tallyko?
We use Postgres to store everything that needs permanent, structured relationships. For example: User accounts, Restaurant Tables, Products, Prices, and Orders. Because Tallyko is a multi-tenant system (meaning many different restaurants use the same app), Postgres allows us to securely separate one restaurant's data from another using Row-Level Security (RLS).

### Credentials
*   **Host:** `localhost` (if using a UI tool) or `db` (if inside Docker)
*   **Port:** `5432`
*   **Database Name:** `tallyko_shared`
*   **Username:** `postgres`
*   **Password:** `password_to_change_in_prod`

### How to Access it
**Command Line (CMD):**
To jump directly into the database terminal via Docker, run this in your command prompt:
```bash
docker exec -it tallyko-db psql -U postgres -d tallyko_shared
```
*(Type `\dt` to list tables, or `SELECT * FROM users;` to view users. Type `\q` to exit).*

**User Interface (UI):**
Command lines can be scary. To view your tables visually like an Excel spreadsheet:
1. Download **[DBeaver Community Edition](https://dbeaver.io/download/)** or **pgAdmin**.
2. Open the app and click "New Connection" -> Select "PostgreSQL".
3. Enter the Host (`localhost`), Port (`5432`), Database (`tallyko_shared`), Username, and Password from above.
4. Click "Test Connection" and then "Finish". You can now double-click tables to view the data!

---

## 2. Redis (The High-Speed Memory)

### What is it?
If Postgres is a filing cabinet, Redis is the sticky note on your computer monitor. It doesn't save data permanently to a hard drive; instead, it stores data in your computer's RAM (Random Access Memory). This makes reading and writing to Redis lightning-fast.

### Why do we use it in Tallyko?
Because reading from a hard drive (Postgres) takes time, we use Redis to hold temporary information that needs to be accessed instantly:
1.  **Rate Limiting:** Stopping hackers from guessing passwords too fast.
2.  **Caching:** Remembering the restaurant menu so we don't have to ask Postgres for it every single time a customer scans a QR code.
3.  **Background Tasks:** Acting as a waiting room for heavy tasks (like generating PDF reports) so the main app doesn't freeze.

### Credentials
*   **Host:** `localhost` (or `cache` in Docker)
*   **Port:** `6379`
*   **Password:** *(None set for local development)*

### How to Access it
**Command Line (CMD):**
```bash
docker exec -it tallyko-cache redis-cli
```
*(Type `KEYS *` to see all saved sticky notes. Type `GET some_key` to read one. Type `exit` to leave).*

**User Interface (UI):**
1. Download **[RedisInsight](https://redis.com/redis-enterprise/redis-insight/)**.
2. Click "Add Redis Database".
3. Enter Host (`localhost`) and Port (`6379`).
4. Connect. You will see a list of all temporary keys (like active rate limits) currently in memory.

---

## 3. MinIO (The File Storage Cabinet)

### What is it?
MinIO is essentially your own private version of Amazon S3 or Google Drive. Instead of storing structured text (like Postgres) or temporary counters (like Redis), MinIO stores heavy files.

### Why do we use it in Tallyko?
We use MinIO to hold binary files. For example: Profile pictures, photos of menu items, AI-uploaded photos of physical menus, and generated PDF receipts. Storing these directly in Postgres would make the database incredibly bloated and slow.

### Credentials
*   **Host (API):** `localhost:9000`
*   **Host (Web UI):** `http://localhost:9001`
*   **Username:** `minio_admin`
*   **Password:** `minio_password_to_change`

### How to Access it
**User Interface (UI):**
MinIO comes with a built-in website! You don't need to download an extra app.
1. Open your web browser and go to: `http://localhost:9001`
2. Log in with the username and password above.
3. You will see an interface that looks like Google Drive. Here you can create "Buckets" (folders) and upload/download files manually.

---

## 4. How It All Connects: Real-World Flow Examples

To understand how these three tools work together, let's look at 6 everyday scenarios in Tallyko:

### Example 1: Brute-Force Password Protection (Flow: Redis)
**Scenario:** A hacker tries to guess an owner's password by logging in 100 times in one minute.
**The Flow:**
1. The hacker sends the first login request to `/auth/login`.
2. Tallyko asks **Redis**: "How many times has this IP address tried to log in this minute?"
3. Redis says "0". Tallyko tells Redis to increment the counter to 1, then checks the password in **Postgres**.
4. The hacker sends requests 2 through 10. Redis increments the counter to 10.
5. On the 11th request, Redis says "This IP has hit the limit of 10!"
6. Tallyko immediately blocks the hacker with a `429 Too Many Requests` error, completely protecting Postgres from being overloaded.

### Example 2: Uploading an Image for AI OCR (Flow: MinIO -> Backend -> Postgres)
**Scenario:** A restaurant owner takes a photo of their physical menu to let the AI auto-generate their digital catalog.
**The Flow:**
1. The Mobile App sends the `.jpg` image to the backend.
2. The backend immediately saves the heavy `.jpg` file into **MinIO**, freeing up memory.
3. The backend runs the Tesseract OCR engine on the image to extract the text.
4. The backend converts the text into structured products (e.g., "Burger - $5").
5. The backend saves these structured products permanently into **Postgres**.

### Example 3: Customer Scans a QR Menu (Flow: Redis Cache)
**Scenario:** 50 customers sit down at once during the lunch rush and scan the QR code to see the menu.
**The Flow:**
1. Customer 1 scans the code. Tallyko checks **Redis** for the menu. Redis is empty.
2. Tallyko queries **Postgres** (which takes 50 milliseconds), gets the menu, sends it to Customer 1, and saves a copy in **Redis** for 5 minutes.
3. Customers 2 through 50 scan the code.
4. Tallyko checks **Redis**. Redis has the menu! It returns the menu instantly (in 1 millisecond). **Postgres** doesn't have to do any work, keeping the server lightning fast.

### Example 4: A Cashier Completes an Order (Flow: Postgres Transactions)
**Scenario:** A cashier taps "Pay $20" for a Burger and Fries.
**The Flow:**
1. The app sends the final order data to the backend.
2. Tallyko opens a "Transaction" in **Postgres**. A transaction means "Do all of these steps, or cancel them all if one fails."
3. Postgres saves the Order record.
4. Postgres checks the Inventory table and deducts 1 bun and 1 box of fries.
5. If the inventory was successfully deducted, Postgres permanently saves (commits) the transaction. The order is secure.

### Example 5: Running an End-of-Month Analytics Report (Flow: Redis Queue -> Postgres -> MinIO)
**Scenario:** The restaurant owner clicks "Generate Monthly Sales PDF." Generating this PDF takes 30 seconds. If the backend waited, the owner's app would freeze.
**The Flow:**
1. Tallyko receives the request and drops a sticky note in **Redis**: *"Hey, please make a report for User X when you have time."* It instantly tells the owner "Report is generating!"
2. A separate background worker sees the note in Redis and picks up the job.
3. The worker spends 10 seconds querying thousands of rows in **Postgres** to calculate the math.
4. The worker spends 20 seconds drawing the PDF file.
5. The worker saves the final `.pdf` to **MinIO**.
6. The worker sends a notification to the owner's app: "Your report is ready to download!"

### Example 6: Generating a JWT Auth Token (Flow: Postgres -> Frontend)
**Scenario:** A manager logs in successfully.
**The Flow:**
1. Tallyko verifies the password in **Postgres**.
2. Instead of storing the "Logged In" status in Postgres, Tallyko generates a cryptographically signed JWT (JSON Web Token) containing the user's role ("Manager") and Tenant ID.
3. The token is sent back to the Mobile App.
4. The Mobile App saves this token deep inside the phone's hardware security chip using **Expo SecureStore**.
5. For all future requests, the app sends this token. Tallyko verifies the mathematical signature without ever needing to ask Postgres if the user is logged in, saving massive amounts of time.
