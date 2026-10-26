import multer from 'multer';
import path from 'path';
import fs from 'fs';

// 1. Set the path to Vercel's writable /tmp directory
// Note: We check if we are in production (Vercel) to use /tmp, otherwise use local tmp/uploads
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const uploadDir = isProduction 
  ? '/tmp/uploads' 
  : path.resolve(process.cwd(), 'tmp/uploads');

// 2. Safely create the directory
// Wrap in try/catch because Vercel serverless functions sometimes re-use the /tmp folder
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create upload directory:', error);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Helper to safely delete temp file after Cloudinary upload
export async function cleanupTempFile(filePath: string) {
  try {
    // Check if file exists before deleting (prevents crash if Cloudinary upload failed)
    await fs.promises.access(filePath, fs.constants.F_OK);
    await fs.promises.unlink(filePath);
  } catch (err) {
    console.warn(`Failed to delete temp file ${filePath}:`, err);
  }
}