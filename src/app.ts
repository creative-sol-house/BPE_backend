// src/app.ts
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// Hello route
// ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ message: 'Hello World 👋' });
});

app.get('/api/hello', (_req, res) => {
  res.json({
    status: 'OK',
    message: 'Hello from Vercel 🚀',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', message: 'Backend is running' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// Only listen locally — Vercel handles this automatically
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

export default app;