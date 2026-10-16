// routes/proposalRoutes.ts
import { Router } from 'express';
import * as proposalController from '../controller/proposalController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { downloadProposalDocx } from '../controller/proposalController';

const proposalRouter = Router();

// ═════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES — MUST BE REGISTERED BEFORE `authenticate` MIDDLEWARE
// ═════════════════════════════════════════════════════════════════════════

// Download .docx — public (no auth required)
proposalRouter.get('/:proposalId/download-docx', downloadProposalDocx);

// ═════════════════════════════════════════════════════════════════════════
// EVERYTHING BELOW REQUIRES AUTHENTICATION
// ═════════════════════════════════════════════════════════════════════════
proposalRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:proposalId)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.get(
  '/stats',
  authorize('proposals', 'view'),
  proposalController.getProposalStats
);

proposalRouter.get(
  '/options',
  authorize('proposals', 'view'),
  proposalController.listProposalOptions
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.get(
  '/',
  authorize('proposals', 'view'),
  proposalController.listProposals
);

proposalRouter.post(
  '/',
  authorize('proposals', 'add'),
  proposalController.createProposal
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "PRO-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.get(
  '/:proposalId',
  authorize('proposals', 'view'),
  proposalController.getProposal
);

proposalRouter.patch(
  '/:proposalId',
  authorize('proposals', 'edit'),
  proposalController.updateProposal
);

// ═════════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.patch(
  '/:proposalId/status',
  authorize('proposals', 'edit'),
  proposalController.changeProposalStatus
);

proposalRouter.post(
  '/:proposalId/send',
  authorize('proposals', 'edit'),
  proposalController.sendProposal
);

proposalRouter.post(
  '/:proposalId/accept',
  authorize('proposals', 'edit'),
  proposalController.acceptProposal
);

proposalRouter.post(
  '/:proposalId/reject',
  authorize('proposals', 'edit'),
  proposalController.rejectProposal
);

// ═════════════════════════════════════════════════════════════════════════
// PROJECT CREATION (manual trigger for manual-mode proposals)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/create-project',
  authorize('proposals', 'edit'),
  proposalController.createProjectFromProposalHandler
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: SECTIONS
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/sections',
  authorize('proposals', 'edit'),
  proposalController.addProposalSection
);

proposalRouter.patch(
  '/:proposalId/sections/:sectionKey',
  authorize('proposals', 'edit'),
  proposalController.updateProposalSection
);

proposalRouter.delete(
  '/:proposalId/sections/:sectionKey',
  authorize('proposals', 'edit'),
  proposalController.removeProposalSection
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: LINE ITEMS
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/line-items',
  authorize('proposals', 'edit'),
  proposalController.addProposalLineItem
);

proposalRouter.patch(
  '/:proposalId/line-items/:lineItemId',
  authorize('proposals', 'edit'),
  proposalController.updateProposalLineItem
);

proposalRouter.delete(
  '/:proposalId/line-items/:lineItemId',
  authorize('proposals', 'edit'),
  proposalController.removeProposalLineItem
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: PAYMENT MILESTONES
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.put(
  '/:proposalId/payment-milestones',
  authorize('proposals', 'edit'),
  proposalController.setProposalPaymentMilestones
);

proposalRouter.patch(
  '/:proposalId/payment-milestones/:milestoneId',
  authorize('proposals', 'edit'),
  proposalController.markMilestonePaid
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: PAGES (technical content)
// ═════════════════════════════════════════════════════════════════════════

// Reorder MUST come before /:pageKey to avoid conflict
proposalRouter.post(
  '/:proposalId/pages/reorder',
  authorize('proposals', 'edit'),
  proposalController.reorderProposalPages
);

proposalRouter.post(
  '/:proposalId/pages',
  authorize('proposals', 'edit'),
  proposalController.addProposalPage
);

proposalRouter.patch(
  '/:proposalId/pages/:pageKey',
  authorize('proposals', 'edit'),
  proposalController.updateProposalPage
);

proposalRouter.delete(
  '/:proposalId/pages/:pageKey',
  authorize('proposals', 'edit'),
  proposalController.removeProposalPage
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: BLOCKS (per page)
// ═════════════════════════════════════════════════════════════════════════

// Reorder MUST come before /:blockKey
proposalRouter.post(
  '/:proposalId/pages/:pageKey/blocks/reorder',
  authorize('proposals', 'edit'),
  proposalController.reorderProposalBlocks
);

proposalRouter.post(
  '/:proposalId/pages/:pageKey/blocks',
  authorize('proposals', 'edit'),
  proposalController.addProposalBlock
);

proposalRouter.patch(
  '/:proposalId/pages/:pageKey/blocks/:blockKey',
  authorize('proposals', 'edit'),
  proposalController.updateProposalBlock
);

proposalRouter.delete(
  '/:proposalId/pages/:pageKey/blocks/:blockKey',
  authorize('proposals', 'edit'),
  proposalController.removeProposalBlock
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TABLE COLUMNS (per table block)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/pages/:pageKey/blocks/:blockKey/table/columns',
  authorize('proposals', 'edit'),
  proposalController.addProposalTableColumn
);

proposalRouter.delete(
  '/:proposalId/pages/:pageKey/blocks/:blockKey/table/columns/:columnKey',
  authorize('proposals', 'edit'),
  proposalController.removeProposalTableColumn
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TABLE ROWS (per table block)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/pages/:pageKey/blocks/:blockKey/table/rows',
  authorize('proposals', 'edit'),
  proposalController.addProposalTableRow
);

proposalRouter.patch(
  '/:proposalId/pages/:pageKey/blocks/:blockKey/table/rows/:rowId',
  authorize('proposals', 'edit'),
  proposalController.updateProposalTableRow
);

proposalRouter.delete(
  '/:proposalId/pages/:pageKey/blocks/:blockKey/table/rows/:rowId',
  authorize('proposals', 'edit'),
  proposalController.removeProposalTableRow
);

// ═════════════════════════════════════════════════════════════════════════
// TABLE OF CONTENTS (per proposal)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.get(
  '/:proposalId/toc',
  authorize('proposals', 'view'),
  proposalController.getProposalTableOfContents
);

proposalRouter.patch(
  '/:proposalId/toc',
  authorize('proposals', 'edit'),
  proposalController.updateProposalTocSettings
);

// ═════════════════════════════════════════════════════════════════════════
// PAGE DEFAULTS (per proposal)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.patch(
  '/:proposalId/page-defaults',
  authorize('proposals', 'edit'),
  proposalController.updateProposalPageDefaults
);

// ═════════════════════════════════════════════════════════════════════════
// REVISIONS
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.post(
  '/:proposalId/revision',
  authorize('proposals', 'edit'),
  proposalController.createProposalRevision
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.delete(
  '/:proposalId',
  authorize('proposals', 'delete'),
  proposalController.deleteProposal
);

proposalRouter.post(
  '/:proposalId/restore',
  authorize('proposals', 'edit'),
  proposalController.restoreProposal
);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent, main admin only, must be soft-deleted first)
// ═════════════════════════════════════════════════════════════════════════

proposalRouter.delete(
  '/:proposalId/permanent',
  proposalController.hardDeleteProposal
); 

export default proposalRouter; 