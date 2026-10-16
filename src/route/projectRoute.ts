// routes/projectRoutes.ts
import { Router } from 'express';
import * as projectController from '../controller/projectController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const projectRouter = Router();

projectRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:projectId)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/stats',
  authorize('projects', 'view'),
  projectController.getProjectStats
);

projectRouter.get(
  '/internal',
  authorize('projects', 'view'),
  projectController.listInternalProjects
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/',
  authorize('projects', 'view'),
  projectController.listProjects
);

projectRouter.post(
  '/',
  authorize('projects', 'add'),
  projectController.createProject
);

import * as taskController from '../controller/taskController';

projectRouter.get(
  '/:projectId/tasks',
  authorize('tasks', 'view'),
  taskController.listTasksByProject
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "PRJ-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/:projectId',
  authorize('projects', 'view'),
  projectController.getProject
);

projectRouter.patch(
  '/:projectId',
  authorize('projects', 'edit'),
  projectController.updateProject
);

// ═════════════════════════════════════════════════════════════════════════
// STATUS / TEAM
// ═════════════════════════════════════════════════════════════════════════

projectRouter.patch(
  '/:projectId/status',
  authorize('projects', 'edit'),
  projectController.changeProjectStatus
);

projectRouter.put(
  '/:projectId/team',
  authorize('projects', 'edit'),
  projectController.setProjectTeam
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TASK CATEGORIES
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/task-categories',
  authorize('projects', 'edit'),
  projectController.addTaskCategory
);

projectRouter.patch(
  '/:projectId/task-categories/:categoryId',
  authorize('projects', 'edit'),
  projectController.updateTaskCategory
);

projectRouter.delete(
  '/:projectId/task-categories/:categoryId',
  authorize('projects', 'edit'),
  projectController.removeTaskCategory
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/activities',
  authorize('projects', 'edit'),
  projectController.addProjectActivity
);

projectRouter.delete(
  '/:projectId/activities/:activityId',
  authorize('projects', 'edit'),
  projectController.removeProjectActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/attachments',
  authorize('projects', 'edit'),
  projectController.addProjectAttachment
);

projectRouter.delete(
  '/:projectId/attachments/:attachmentId',
  authorize('projects', 'edit'),
  projectController.removeProjectAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: MILESTONES
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/milestones',
  authorize('projects', 'edit'),
  projectController.addProjectMilestone
);

projectRouter.patch(
  '/:projectId/milestones/:milestoneId',
  authorize('projects', 'edit'),
  projectController.toggleProjectMilestone
);

projectRouter.delete(
  '/:projectId/milestones/:milestoneId',
  authorize('projects', 'edit'),
  projectController.removeProjectMilestone
);

// ═════════════════════════════════════════════════════════════════════════
// PROGRESS RECOMPUTE (from tasks)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/recompute-progress',
  authorize('projects', 'edit'),
  projectController.recomputeProjectProgress
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

projectRouter.delete(
  '/:projectId',
  authorize('projects', 'delete'),
  projectController.deleteProject
);

projectRouter.post(
  '/:projectId/restore',
  authorize('projects', 'edit'),
  projectController.restoreProject
);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent, main admin only, must be soft-deleted first)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.delete(
  '/:projectId/permanent',
  projectController.hardDeleteProject
);

export default projectRouter;