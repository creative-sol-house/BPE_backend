// routes/leaveRoutes.ts
import { Router } from 'express';
import * as ctrl from '../controller/leaveController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();
router.use(authenticate);

router.get('/me/balance', ctrl.getMyLeaveBalance);

router.post('/assign', authorize('leaves', 'add'), ctrl.assignLeaveDirectly);

router.get('/balance/:employeeId', authorize('leaves', 'edit'), ctrl.getEmployeeLeaveBalance);
router.get('/ledger/:employeeId',  authorize('leaves', 'edit'), ctrl.getEmployeeLedger);

export default router;