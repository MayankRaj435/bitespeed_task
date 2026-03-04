import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data.sqlite");
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS Contact (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phoneNumber TEXT,
    email TEXT,
    linkedId INTEGER,
    linkPrecedence TEXT NOT NULL CHECK (linkPrecedence IN ('primary', 'secondary')),
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    deletedAt TEXT,
    FOREIGN KEY (linkedId) REFERENCES Contact(id)
  );
  CREATE INDEX IF NOT EXISTS idx_contact_email ON Contact(email) WHERE email IS NOT NULL AND deletedAt IS NULL;
  CREATE INDEX IF NOT EXISTS idx_contact_phone ON Contact(phoneNumber) WHERE phoneNumber IS NOT NULL AND deletedAt IS NULL;
  CREATE INDEX IF NOT EXISTS idx_contact_linked ON Contact(linkedId) WHERE deletedAt IS NULL;
`);

export function initDb(): void {
  // Table already created above
}
