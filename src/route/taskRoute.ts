// routes/taskRoutes.ts
import { Router } from 'express';
import * as taskController from '../controller/taskController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const taskRouter = Router();

taskRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:taskId)
// ═════════════════════════════════════════════════════════════════════════

// ─── My tasks (cross-project personal view; includes internal tasks) ────
taskRouter.get(
  '/my',
  authorize('tasks', 'view'),
  taskController.listMyTasks
);

// ─── Internal-only tasks (projectId: null) ──────────────────────────────
taskRouter.get(
  '/internal',
  authorize('tasks', 'view'),
  taskController.listInternalTasks
);

// ─── Global task stats (supports ?hasProject=true|false) ────────────────
taskRouter.get(
  '/stats',
  authorize('tasks', 'view'),
  taskController.getTaskStats
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/',
  authorize('tasks', 'view'),
  taskController.listTasks
);

taskRouter.post(
  '/',
  authorize('tasks', 'add'),
  taskController.createTask
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "TSK-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/:taskId',
  authorize('tasks', 'view'),
  taskController.getTask
);

taskRouter.patch(
  '/:taskId',
  authorize('tasks', 'edit'),
  taskController.updateTask
);

// ═════════════════════════════════════════════════════════════════════════
// ASSIGNMENT / STATUS / TIME / ESTIMATE
// ═════════════════════════════════════════════════════════════════════════

taskRouter.patch(
  '/:taskId/assign',
  authorize('tasks', 'edit'),
  taskController.assignTask
);

taskRouter.patch(
  '/:taskId/status',
  authorize('tasks', 'edit'),
  taskController.changeTaskStatus
);

taskRouter.post(
  '/:taskId/time',
  authorize('tasks', 'edit'),
  taskController.logTaskTime
);

taskRouter.patch(
  '/:taskId/estimate',
  authorize('tasks', 'edit'),
  taskController.changeTaskEstimate
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/activities',
  authorize('tasks', 'edit'),
  taskController.addTaskActivity
);

taskRouter.delete(
  '/:taskId/activities/:activityId',
  authorize('tasks', 'edit'),
  taskController.removeTaskActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: COMMENTS
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/comments',
  authorize('tasks', 'edit'),
  taskController.addTaskComment
);

taskRouter.delete(
  '/:taskId/comments/:commentId',
  authorize('tasks', 'edit'),
  taskController.removeTaskComment
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/attachments',
  authorize('tasks', 'edit'),
  taskController.addTaskAttachment
);

taskRouter.delete(
  '/:taskId/attachments/:attachmentId',
  authorize('tasks', 'edit'),
  taskController.removeTaskAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// RECOMPUTE PARENT PROJECT PROGRESS
// (internal tasks return 400 — they have no project to recompute)
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/recompute-progress',
  authorize('tasks', 'edit'),
  taskController.recomputeFromTask
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete(
  '/:taskId',
  authorize('tasks', 'delete'),
  taskController.deleteTask
);

taskRouter.post(
  '/:taskId/restore',
  authorize('tasks', 'edit'),
  taskController.restoreTask
);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent, main admin only, must be soft-deleted first)
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete(
  '/:taskId/permanent',
  taskController.hardDeleteTask
);

export default taskRouter;