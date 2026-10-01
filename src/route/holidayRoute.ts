// routes/holidayRoutes.ts
import { Router } from 'express';
import * as holidayController from '../controller/holidayController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
 
const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorize('holidays', 'view'),
  holidayController.listHolidays
);

router.get(
  '/preview',
  authorize('holidays', 'view'),
  holidayController.previewHolidayDates
);

router.post(
  '/',
  authorize('holidays', 'add'),
  holidayController.createHoliday
);

router.get(
  '/:id',
  authorize('holidays', 'view'),
  holidayController.getHoliday
);

router.patch(
  '/:id',
  authorize('holidays', 'edit'),
  holidayController.updateHoliday
);

router.delete(
  '/:id',
  authorize('holidays', 'delete'),
  holidayController.deleteHoliday
);

export default router;