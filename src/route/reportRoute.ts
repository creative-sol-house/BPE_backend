// routes/reportRoutes.ts
import { Router } from 'express';
import * as reportController from '../controller/reportController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

// ── Profit & Loss ─────────────────────────────────────────────────────
// GET /api/reports/profit-loss?fiscalYear=&fiscalPeriod=
// OR ?from=&to=
router.get(
  '/profit-loss',
  authorize('accounting', 'view'),
  reportController.profitAndLoss
);

// ── Balance Sheet ─────────────────────────────────────────────────────
// GET /api/reports/balance-sheet?asOf=YYYY-MM-DD
router.get(
  '/balance-sheet',
  authorize('accounting', 'view'),
  reportController.balanceSheet
);

// ── Cash Flow ─────────────────────────────────────────────────────────
// GET /api/reports/cash-flow?fiscalYear=&fiscalPeriod=
// OR ?from=&to=
router.get(
  '/cash-flow',
  authorize('accounting', 'view'),
  reportController.cashFlow
);

export default router;