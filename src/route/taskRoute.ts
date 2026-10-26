// routes/taskRoutes.ts
import { Router } from 'express';
import * as taskController from '../controller/taskController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const taskRouter = Router();

taskRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SELF-SERVICE ROUTES — NO authorize() — controller scopes to req.user._id
// ═════════════════════════════════════════════════════════════════════════

// My tasks (cross-project personal view; includes internal tasks)
taskRouter.get('/my', taskController.listMyTasks);

// Internal-only tasks (projectId: null)
taskRouter.get('/internal', taskController.listInternalTasks);

// ═════════════════════════════════════════════════════════════════════════
// ADMIN / STATS — GLOBAL scope → authorize('tasks','view') stays
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/stats',
  authorize('tasks', 'view'),
  taskController.getTaskStats
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST — GLOBAL scope → authorize('tasks','view') stays
// (employees should call /tasks/my instead)
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/',
  authorize('tasks', 'view'),
  taskController.listTasks
);

// ═════════════════════════════════════════════════════════════════════════
// CREATE — controller enforces project-scoped add permission
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/', taskController.createTask);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE — controller checks isAssignee / isAssigner / isCreator
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get('/:taskId', taskController.getTask);
taskRouter.patch('/:taskId', taskController.updateTask);

// ═════════════════════════════════════════════════════════════════════════
// ASSIGNMENT — controller checks admin / tasks:edit / assigner
// ═════════════════════════════════════════════════════════════════════════

taskRouter.patch('/:taskId/assign', taskController.assignTask);

// ═════════════════════════════════════════════════════════════════════════
// STATUS / TIME / ESTIMATE — controller checks assignee / tasks:edit
// ═════════════════════════════════════════════════════════════════════════

taskRouter.patch('/:taskId/status', taskController.changeTaskStatus);
taskRouter.post('/:taskId/time', taskController.logTaskTime);
taskRouter.patch('/:taskId/estimate', taskController.changeTaskEstimate);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES — controller checks tasks:edit / assignee
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/activities', taskController.addTaskActivity);
taskRouter.delete(
  '/:taskId/activities/:activityId',
  taskController.removeTaskActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: COMMENTS — controller checks admin / tasks:edit / author
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/comments', taskController.addTaskComment);
taskRouter.delete(
  '/:taskId/comments/:commentId',
  taskController.removeTaskComment
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS — controller checks tasks:edit / assignee
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/attachments', taskController.addTaskAttachment);
taskRouter.delete(
  '/:taskId/attachments/:attachmentId',
  taskController.removeTaskAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// RECOMPUTE PARENT PROJECT PROGRESS
// controller checks admin / projects:edit / PM / task assigner
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/recompute-progress',
  taskController.recomputeFromTask
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE — controller checks admin / tasks:delete|edit
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete('/:taskId', taskController.deleteTask);
taskRouter.post('/:taskId/restore', taskController.restoreTask);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent) — controller enforces main admin only
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete('/:taskId/permanent', taskController.hardDeleteTask);

export default taskRouter;