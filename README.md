# Bitespeed Backend Task: Identity Reconciliation

Identity reconciliation service that links customer contacts across multiple purchases (same person, different email/phone).

## Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Framework:** Express
- **Database:** SQLite (better-sqlite3)

## Setup

```bash
npm install
npm run build
npm start
```

Development (watch mode):

```bash
npm run dev
```

## API

### `POST /identify`

Request body (JSON):

```json
{
  "email": "string (optional)",
  "phoneNumber": "string or number (optional)"
}
```

At least one of `email` or `phoneNumber` must be provided.

Response (200):

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["primary@example.com", "other@example.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

- **primaryContatctId:** ID of the primary contact (oldest in the link chain).
- **emails:** All emails in the chain; first element is the primary contact’s email.
- **phoneNumbers:** All phone numbers in the chain; first element is the primary’s.
- **secondaryContactIds:** IDs of all secondary contacts linked to this primary.

## Behaviour

- Contacts are linked if they share the same **email** or **phoneNumber**.
- The oldest contact in a link chain is **primary**; others are **secondary** and have `linkedId` pointing to the primary.
- If an incoming request matches an existing contact but has **new** email or phone, a new **secondary** contact is created and linked to the primary.
- If an incoming request matches **two different** primary chains (e.g. email from one, phone from another), the two chains are **merged**: the newer primary becomes secondary to the older one.

## Hosted endpoint

When deployed (e.g. Render), the base URL can be used as:

```
POST https://<your-app>.onrender.com/identify
Content-Type: application/json

{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}
```

Use **JSON body**, not form-data.
