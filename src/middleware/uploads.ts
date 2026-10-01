// middleware/uploads.ts
import { getCloudinary } from '../config/cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { cleanupTempFile } from '../utils/multer';
import fs from 'fs';

export async function uploadImage(filePath: string) {
  console.log('📤 [uploadImage] called with:', filePath);

  if (!fs.existsSync(filePath)) {
    console.error('📤 [uploadImage] FILE DOES NOT EXIST');
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  console.log('📤 [uploadImage] file exists. size:', stats.size, 'bytes');

  try {
    const cloud = getCloudinary();

    console.log('📤 [uploadImage] calling cloudinary.uploader.upload...');
    const result: UploadApiResponse = await cloud.uploader.upload(filePath, {
      folder: 'my-uploads',
      resource_type: 'image',
      // ✅ Only safe parameters — no quality/fetch_format here
      transformation: [{ width: 800, crop: 'scale' }],
    });

    console.log('📤 [uploadImage] SUCCESS. URL:', result.secure_url);

    await cleanupTempFile(filePath);
    return { url: result.secure_url, publicId: result.public_id };
  } catch (error: any) {
    console.error('❌ [uploadImage] FAILED');
    console.error('   message:', error?.message);
    console.error('   http_code:', error?.http_code);
    console.error('   name:', error?.name);
    // Cloudinary sometimes puts the real error message here:
    console.error('   error:', JSON.stringify(error, null, 2));

    await cleanupTempFile(filePath);
    throw new Error(`Upload failed: ${error?.message || 'Unknown error'}`);
  }
}

export async function deleteImage(publicId: string): Promise<void> {
  try {
    const cloud = getCloudinary();
    await cloud.uploader.destroy(publicId);
  } catch (error: any) {
    throw new Error(`Delete failed: ${error?.message || 'Unknown error'}`);
  }
}