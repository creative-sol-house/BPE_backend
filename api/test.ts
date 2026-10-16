// api/test.ts
import type { Request, Response } from 'express';

export default function handler(req: Request, res: Response) {
  res.status(200).json({
    status: 'OK',
    message: 'Hello — I am alive 🎉',
    timestamp: new Date().toISOString(),
  });
}