// routes/employeeRoutes.ts
import { Router } from 'express';
import * as employeeController from '../controller/employeeController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const emprouter = Router();

emprouter.use(authenticate);

// ─── Specific routes first (must come before /:employeeId) ───────────────
emprouter.get(
  '/me',
  employeeController.getMyEmployeeRecord
);

emprouter.get(
  '/stats',
  authorize('employees', 'view'),
  employeeController.getEmployeeStats
);

emprouter.get(
  '/by-user/:userId',
  authorize('employees', 'view'),
  employeeController.getEmployeeByUserId
);

// ─── Cron-style: extend all open-ended leave schedules ───────────────────
emprouter.post(
  '/extend-schedules',
  authorize('employees', 'edit'),
  employeeController.extendAllSchedules
);

// ─── Generic list / create ───────────────────────────────────────────────
emprouter.get(
  '/',
  authorize('employees', 'view'),
  employeeController.listEmployees
);

emprouter.post(
  '/',
  authorize('employees', 'add'),
  employeeController.createEmployee
);

// ─── Get one by _id or "EMP-XXXXX" ───────────────────────────────────────
emprouter.get(
  '/:employeeId',
  authorize('employees', 'view'),
  employeeController.getEmployee
);

emprouter.patch(
  '/:employeeId',
  authorize('employees', 'edit'),
  employeeController.updateEmployee
);

// ─── Adjust a specific month's used days ─────────────────────────────────
// body: { type, year, month, delta }
emprouter.post(
  '/:employeeId/leave-used',
  authorize('employees', 'edit'),
  employeeController.adjustLeaveUsed
);

// ─── Soft delete / restore ───────────────────────────────────────────────
emprouter.delete(
  '/:employeeId',
  authorize('employees', 'delete'),
  employeeController.deleteEmployee
);

emprouter.post(
  '/:employeeId/restore',
  authorize('employees', 'edit'),
  employeeController.restoreEmployee
);

export default emprouter;