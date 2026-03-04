import { db } from "./db";
import type { ContactRow } from "./types";

function normalizePhone(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

function normalizeEmail(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

/** Get contact by id (not deleted). */
function getContactById(id: number): ContactRow | undefined {
  const row = db.prepare(
    "SELECT id, phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt FROM Contact WHERE id = ? AND deletedAt IS NULL"
  ).get(id) as ContactRow | undefined;
  return row;
}

/** Resolve contact to its primary (follow linkedId). */
function getPrimary(contact: ContactRow): ContactRow {
  if (contact.linkPrecedence === "primary") return contact;
  if (contact.linkedId == null) return contact;
  const linked = getContactById(contact.linkedId);
  if (!linked) return contact;
  return getPrimary(linked);
}

/** Find all contacts matching email or phone (non-deleted). */
function findMatchingContacts(email: string | null, phone: string | null): ContactRow[] {
  const rows: ContactRow[] = [];
  if (email) {
    const byEmail = db.prepare(
      "SELECT id, phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt FROM Contact WHERE email = ? AND deletedAt IS NULL"
    ).all(email) as ContactRow[];
    rows.push(...byEmail);
  }
  if (phone) {
    const byPhone = db.prepare(
      "SELECT id, phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt FROM Contact WHERE phoneNumber = ? AND deletedAt IS NULL"
    ).all(phone) as ContactRow[];
    rows.push(...byPhone);
  }
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Get all contacts in the chain (primary + all secondaries that link to this primary). */
function getChain(primaryId: number): ContactRow[] {
  const primary = getContactById(primaryId);
  if (!primary) return [];
  const result: ContactRow[] = [primary];
  const queue = [primaryId];
  const visited = new Set<number>([primaryId]);
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const linked = db.prepare(
      "SELECT id, phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt FROM Contact WHERE linkedId = ? AND deletedAt IS NULL"
    ).all(currentId) as ContactRow[];
    for (const c of linked) {
      if (!visited.has(c.id)) {
        visited.add(c.id);
        result.push(c);
        queue.push(c.id);
      }
    }
  }
  return result;
}

/** Merge multiple primaries: keep oldest, make others secondary. */
function mergePrimaries(primaryIds: number[]): number {
  if (primaryIds.length <= 1) return primaryIds[0]!;
  const contacts = primaryIds.map((id) => getContactById(id)).filter(Boolean) as ContactRow[];
  contacts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const winner = contacts[0]!;
  const now = new Date().toISOString();
  const updateStmt = db.prepare(
    "UPDATE Contact SET linkedId = ?, linkPrecedence = 'secondary', updatedAt = ? WHERE id = ? AND deletedAt IS NULL"
  );
  for (let i = 1; i < contacts.length; i++) {
    updateStmt.run(winner.id, now, contacts[i]!.id);
  }
  return winner.id;
}

/** Create a new primary contact. */
function createPrimary(email: string | null, phone: string | null): ContactRow {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt) VALUES (?, ?, NULL, 'primary', ?, ?, NULL)"
  );
  const result = stmt.run(phone, email, now, now);
  return getContactById(result.lastInsertRowid as number)!;
}

/** Create a secondary contact linked to primary. */
function createSecondary(primaryId: number, email: string | null, phone: string | null): ContactRow {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt, deletedAt) VALUES (?, ?, ?, 'secondary', ?, ?, NULL)"
  );
  const result = stmt.run(phone, email, primaryId, now, now);
  return getContactById(result.lastInsertRowid as number)!;
}

export function identify(email: string | number | null | undefined, phoneNumber: string | number | null | undefined): {
  primaryContatctId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
} {
  const emailVal = normalizeEmail(email as string | null);
  const phoneVal = normalizePhone(phoneNumber);

  const matching = findMatchingContacts(emailVal, phoneVal);

  if (matching.length === 0) {
    const primary = createPrimary(emailVal, phoneVal);
    const emails: string[] = [];
    if (primary.email) emails.push(primary.email);
    const phoneNumbers: string[] = [];
    if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);
    return {
      primaryContatctId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: [],
    };
  }

  const primaries = new Map<number, ContactRow>();
  for (const c of matching) {
    const p = getPrimary(c);
    primaries.set(p.id, p);
  }
  const primaryIds = Array.from(primaries.keys());
  const primaryId = mergePrimaries(primaryIds);
  const chain = getChain(primaryId);
  const primaryContact = chain.find((c) => c.linkPrecedence === "primary")!;

  const allEmails = new Set<string>();
  const allPhones = new Set<string>();
  for (const c of chain) {
    if (c.email) allEmails.add(c.email);
    if (c.phoneNumber) allPhones.add(c.phoneNumber);
  }

  const hasNewEmail = emailVal != null && !allEmails.has(emailVal);
  const hasNewPhone = phoneVal != null && !allPhones.has(phoneVal);
  if (hasNewEmail || hasNewPhone) {
    createSecondary(primaryId, emailVal ?? null, phoneVal ?? null);
  }

  const chainAfter = getChain(primaryId);
  const emailsOrdered: string[] = [];
  if (primaryContact.email) emailsOrdered.push(primaryContact.email);
  for (const c of chainAfter) {
    if (c.id !== primaryContact.id && c.email && !emailsOrdered.includes(c.email)) {
      emailsOrdered.push(c.email);
    }
  }
  const phoneNumbersOrdered: string[] = [];
  if (primaryContact.phoneNumber) phoneNumbersOrdered.push(primaryContact.phoneNumber);
  for (const c of chainAfter) {
    if (c.id !== primaryContact.id && c.phoneNumber && !phoneNumbersOrdered.includes(c.phoneNumber)) {
      phoneNumbersOrdered.push(c.phoneNumber);
    }
  }
  const secondaryContactIds = chainAfter.filter((c) => c.id !== primaryId).map((c) => c.id);

  return {
    primaryContatctId: primaryId,
    emails: emailsOrdered,
    phoneNumbers: phoneNumbersOrdered,
    secondaryContactIds,
  };
}
