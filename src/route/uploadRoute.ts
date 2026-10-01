// route/uploadRoute.ts
import { Router } from 'express';
import { upload } from '../utils/multer';
import { uploadImage } from '../middleware/uploads';

const uploadRouter = Router();

uploadRouter.post('/upload', upload.single('image'), async (req, res) => {
  try {
 
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Field name must be "image".' });
    }

    const { url, publicId } = await uploadImage(req.file.path);
    return res.status(200).json({ success: true, data: { url, publicId } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});

export default uploadRouter;