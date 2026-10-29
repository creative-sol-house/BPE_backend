// app.ts
import express, { Request, Response, NextFunction } from 'express'; // Added types for middleware
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import dns from 'dns';
import { connectDB } from './database/db';
import allRoutes from './route/allRoute';
import { errorHandler } from './middleware/errorHandler';
import { startCleanupCron } from './cron/cleanupPendingUsers';

// DNS fix (needed in some regions for MongoDB Atlas)
dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

const app = express();

app.set('trust proxy', 1);        // 👈 Keep this so we get the real IP

// ─────────────────────────────────────────────
// 🏢 HARDCODED OFFICE IP WHITELIST
// ─────────────────────────────────────────────
// Add as many IPs as you want in this array
const ALLOWED_IPS = [
  '119.73.101.159', 
  // '127.0.0.1', // (Optional) uncomment this if you want to test locally on your own machine
];

connectDB().then(() => {
  startCleanupCron();          // 👈 start cron AFTER DB is connected
});

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL?.split(',') || true,
    credentials: true,
  })
);
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─────────────────────────────────────────────
// Health check (Left open so you can always monitor the server)
// ─────────────────────────────────────────────
app.get('/api/ping', (_req, res) => {
  res.json({ status: 'OK', message: 'pong 🏓', time: new Date().toISOString() });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    message: 'CS_ERP Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─────────────────────────────────────────────
// 🛡️ IP WHITELIST MIDDLEWARE
// ─────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  // Get the real client IP (trust proxy makes this the actual public IP)
  let clientIP = req.ip || req.socket.remoteAddress || '';
  
  // Clean up IPv6-mapped IPv4 addresses (e.g., '::ffff:119.73.101.159' -> '119.73.101.159')
  if (clientIP.startsWith('::ffff:')) {
    clientIP = clientIP.substring(7); 
  }

  // Check if the IP is in our allowed list
  if (ALLOWED_IPS.includes(clientIP)) {
    next(); // Allowed, proceed to API routes
  } else {
    // Not allowed
    console.warn(`🚫 Blocked access attempt from IP: ${clientIP}`);
    res.status(403).json({
      success: false,
      error: 'Access Denied: You must be connected to the office network to use this system.',
    });
  }
});

// ─────────────────────────────────────────────
// API Routes (Protected)
// ─────────────────────────────────────────────
app.use('/api', allRoutes);

// ─────────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
  });
});

// ─────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────
app.use(errorHandler);

export default app;