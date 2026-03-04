export type LinkPrecedence = "primary" | "secondary";

export interface ContactRow {
  id: number;
  phoneNumber: string | null;
  email: string | null;
  linkedId: number | null;
  linkPrecedence: LinkPrecedence;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface IdentifyRequest {
  email?: string | null;
  phoneNumber?: string | number | null;
}

export interface IdentifyResponse {
  contact: {
    primaryContatctId: number; // typo per spec
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}
