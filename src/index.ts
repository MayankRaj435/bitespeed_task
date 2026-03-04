import express, { Request, Response } from "express";
import { initDb } from "./db";
import { identify } from "./identify";
import type { IdentifyRequest, IdentifyResponse } from "./types";

initDb();

const app = express();
app.use(express.json());

app.post("/identify", (req: Request, res: Response) => {
  try {
    const body = req.body as IdentifyRequest;
    const email = body.email ?? null;
    const phoneNumber = body.phoneNumber ?? null;

    if (email == null && phoneNumber == null) {
      return res.status(400).json({
        error: "At least one of email or phoneNumber is required",
      });
    }

    const result = identify(email, phoneNumber);
    const payload: IdentifyResponse = {
      contact: {
        primaryContatctId: result.primaryContatctId,
        emails: result.emails,
        phoneNumbers: result.phoneNumbers,
        secondaryContactIds: result.secondaryContactIds,
      },
    };
    return res.status(200).json(payload);
  } catch (err) {
    console.error("/identify error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
