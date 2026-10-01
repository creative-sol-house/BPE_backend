// routes/roleRoutes.ts
import { Router } from 'express';
import * as roleController from '../controller/roleController';
import { authenticate, requireMainAdmin } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

router.get('/', authorize('roles', 'view'), roleController.listRoles);
router.get('/:roleId', authorize('roles', 'view'), roleController.getRole);
router.post('/', requireMainAdmin, authorize('roles', 'add'), roleController.createRole);
router.patch('/:roleId', requireMainAdmin, authorize('roles', 'edit'), roleController.updateRole);
router.delete('/:roleId', requireMainAdmin, authorize('roles', 'delete'), roleController.deleteRole);

export default router;