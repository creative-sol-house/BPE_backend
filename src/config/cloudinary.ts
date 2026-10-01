// config/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';

let configured = false;

export function getCloudinary() {
  if (configured) return cloudinary;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  console.log('☁️  [cloudinary] config:', {
    cloud_name: cloudName,
    key: apiKey,
    secretLen: apiSecret?.length,
  });

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      `Cloudinary env missing. cloud=${cloudName ? 'set' : 'MISSING'} key=${apiKey ? 'set' : 'MISSING'} secret=${apiSecret ? 'set' : 'MISSING'}`
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  configured = true;
  console.log('☁️  [cloudinary] CONFIGURED');
  return cloudinary;
}

export default cloudinary;   // still export the raw instance for type-safe usage