// routes/requestRoutes.ts
import { Router } from 'express';
import * as ctrl from '../controller/requestController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();
router.use(authenticate);

router.get('/stats', ctrl.requestStats);

router.post('/',            authorize('requests', 'add'),  ctrl.submitRequest);
router.get('/',             authorize('requests', 'view'), ctrl.listRequests);

router.patch('/:requestId',         authorize('requests', 'edit'), ctrl.editRequest);
router.post('/:requestId/cancel',   authorize('requests', 'edit'), ctrl.cancelRequest);
router.post('/:requestId/approve',  authorize('requests', 'edit'), ctrl.approveRequest);
router.post('/:requestId/reject',   authorize('requests', 'edit'), ctrl.rejectRequest);
router.post('/:requestId/comments', authorize('requests', 'view'), ctrl.addComment);

router.get('/:requestId', authorize('requests', 'view'), ctrl.getRequest);

export default router;