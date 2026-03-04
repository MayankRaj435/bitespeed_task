# Project Overview: Bitespeed Identity Reconciliation

## 1. Requirements

### Problem
- **FluxKart.com** collects contact info (email, phone) at checkout.
- The same customer may use **different emails or phones** on different orders (e.g. Doc from the task).
- We need to **treat them as one identity** and return a single consolidated view.

### What we must build
- A **web service** with one endpoint: **POST /identify**.
- **Request body (JSON):** `{ "email"?: string, "phoneNumber"?: number }` — at least one required.
- **Response (200):** A single “contact” object that represents the person, with:
  - **primaryContatctId** — ID of the oldest contact in the link chain.
  - **emails** — All emails linked to this person (primary’s email first).
  - **phoneNumbers** — All phone numbers (primary’s first).
  - **secondaryContactIds** — IDs of all non-primary contacts in the chain.

### Business rules
1. **Contact table** stores rows with: `id`, `email`, `phoneNumber`, `linkedId`, `linkPrecedence` (`"primary"` | `"secondary"`), timestamps, `deletedAt`.
2. **Linking:** Two contacts are “the same person” if they share at least one of **email** or **phoneNumber**.
3. **Primary vs secondary:** The **oldest** contact in a link chain is `primary`; all others are `secondary` and have `linkedId` pointing to that primary.
4. **New contact:** If the request doesn’t match any existing contact → create a **new primary** contact and return it (empty `secondaryContactIds`).
5. **New info on existing person:** If the request matches an existing contact but has a **new** email or phone → create a **secondary** contact linked to the existing primary.
6. **Merging two chains:** If the request matches **two different** primaries (e.g. email from one, phone from another), **merge**: the older primary stays primary; the newer one becomes secondary (its `linkedId` points to the older, `linkPrecedence` becomes `"secondary"`).

---

## 2. Solution Overview

- **Stack:** Node.js, TypeScript, Express, SQLite (better-sqlite3).
- **Flow for each POST /identify:**
  1. Normalize `email` and `phoneNumber` from the request.
  2. Find all contacts that have that email **or** that phone (ignoring soft-deleted).
  3. From those, resolve each to its **primary** (follow `linkedId` until we hit a primary).
  4. If we get **more than one primary** → **merge**: keep the oldest by `createdAt`, set the others to secondary pointing to that one.
  5. If **no** match → create a new **primary** contact and return it.
  6. If there **is** a match and the request has an email or phone **not** already in the chain → create a **secondary** contact.
  7. Build the response: one primary ID, ordered lists of emails (primary first) and phone numbers (primary first), and list of secondary contact IDs.

---

## 3. Project Structure

```
bitespeed/
├── src/                 # Source code
│   ├── index.ts         # Express app & POST /identify route
│   ├── db.ts            # SQLite connection & Contact table schema
│   ├── identify.ts      # Identity reconciliation logic
│   └── types.ts         # TypeScript types for request/response & Contact
├── dist/                # Compiled JS (after npm run build)
├── node_modules/        # Dependencies
├── package.json         # Scripts & dependencies
├── tsconfig.json        # TypeScript config
├── README.md            # How to run & use the API
├── .gitignore
└── data.sqlite          # SQLite DB file (created at runtime)
```

---

## 4. File-by-File Description

### Root-level files

| File | Purpose |
|------|--------|
| **package.json** | Defines project name, scripts (`build`, `start`, `dev`), and dependencies (express, better-sqlite3) and devDependencies (TypeScript, types). |
| **tsconfig.json** | TypeScript config: compile `src/` to `dist/`, strict mode, CommonJS, ES2022. |
| **README.md** | Setup, run instructions, and API usage (including JSON body and optional hosted URL). |
| **.gitignore** | Ignores `node_modules/`, `dist/`, `*.sqlite`, `.env`, etc. |

---

### `src/types.ts`

**Purpose:** Central place for TypeScript types used across the app.

- **LinkPrecedence** — `"primary" | "secondary"`.
- **ContactRow** — One row from the `Contact` table: `id`, `phoneNumber`, `email`, `linkedId`, `linkPrecedence`, `createdAt`, `updatedAt`, `deletedAt`.
- **IdentifyRequest** — Body of POST /identify: optional `email` and `phoneNumber` (number or string).
- **IdentifyResponse** — Response shape: `contact` with `primaryContatctId` (spec typo kept), `emails`, `phoneNumbers`, `secondaryContactIds`.

---

### `src/db.ts`

**Purpose:** Database setup and schema.

- Creates a **SQLite** database (path from `process.env.SQLITE_PATH` or default `data.sqlite` in project root).
- Runs **schema** on load:
  - **Contact** table with all required columns and `CHECK (linkPrecedence IN ('primary', 'secondary'))`, `FOREIGN KEY (linkedId)`.
  - Indexes on `email`, `phoneNumber`, and `linkedId` (with `deletedAt IS NULL` where useful) for fast lookups.
- Exports **db** (the connection) and **initDb()** (no-op after schema; can be used for future migrations).

---

### `src/identify.ts`

**Purpose:** All identity reconciliation logic; single entry point: **identify(email, phoneNumber)**.

**Helpers (used only inside this file):**

- **normalizePhone / normalizeEmail** — Coerce input to string or null; trim; accept number for phone.
- **getContactById(id)** — Load one contact by ID, excluding soft-deleted.
- **getPrimary(contact)** — Follow `linkedId` until the row with `linkPrecedence === "primary"`.
- **findMatchingContacts(email, phone)** — Return all contacts that have that email **or** that phone (deduplicated).
- **getChain(primaryId)** — BFS from primary: primary + all contacts that link to it (directly or via other secondaries).
- **mergePrimaries(primaryIds)** — Given several primary IDs, keep the one with oldest `createdAt`, update the others to `linkPrecedence = 'secondary'` and `linkedId = winner`.
- **createPrimary(email, phone)** — INSERT one row with `linkPrecedence = 'primary'`, `linkedId = NULL`.
- **createSecondary(primaryId, email, phone)** — INSERT one row with `linkPrecedence = 'secondary'`, `linkedId = primaryId`.

**identify(email, phoneNumber):**

1. Normalize email and phone.
2. **No matches** → create primary, return it with empty secondaries.
3. **Has matches** → resolve each match to its primary, then **mergePrimaries** so there is exactly one primary.
4. Load **chain** for that primary; if request has an email or phone **not** in the chain, **createSecondary**.
5. Re-load chain (to include the new secondary if any), then build:
   - **emails**: primary’s email first, then rest (no duplicates).
   - **phoneNumbers**: primary’s phone first, then rest (no duplicates).
   - **secondaryContactIds**: all contact IDs in the chain except the primary.
6. Return `{ primaryContatctId, emails, phoneNumbers, secondaryContactIds }`.

---

### `src/index.ts`

**Purpose:** HTTP server and single route.

- Calls **initDb()** on startup.
- **express.json()** to parse JSON bodies.
- **POST /identify**:
  - Reads **email** and **phoneNumber** from `req.body`.
  - Validates at least one is present → 400 otherwise.
  - Calls **identify(email, phoneNumber)**.
  - Sends **200** with the response shape from `types.ts` (including `primaryContatctId`).
  - Catches errors and returns **500** with a generic message.
- Listens on **PORT** (env) or **3000**.

---

## 5. Data Flow Summary

```
POST /identify { email?, phoneNumber? }
       ↓
  index.ts: parse body, validate
       ↓
  identify.ts: identify(email, phoneNumber)
       ↓
  find matches → resolve primaries → merge if needed → create secondary if new info
       ↓
  build { primaryContatctId, emails, phoneNumbers, secondaryContactIds }
       ↓
  index.ts: res.status(200).json({ contact: ... })
```

All persistence is in **db.ts** (schema) and **identify.ts** (queries and inserts). **types.ts** keeps request/response and DB row types consistent across the app.
