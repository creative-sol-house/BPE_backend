// controller/roleController.ts
import { Response } from 'express';
import Role from '../model/role';
import { AuthRequest } from '../middleware/auth';

export async function createRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, description, departments } = req.body;

    if (!req.user?.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Only main admin can create roles' });
      return;
    }

    if (departments) {
      const deptNames = departments.map((d: any) => d.name.trim().toLowerCase());
      if (new Set(deptNames).size !== deptNames.length) {
        res.status(400).json({
          success: false,
          message: 'Duplicate department names are not allowed within a role',
        });
        return;
      }
    }

    const existing = await Role.findOne({ name: name.trim(), isDeleted: false });
    if (existing) {
      res.status(409).json({ success: false, message: 'Role name already exists' });
      return;
    }

    const role = await Role.create({
      name: name.trim(),
      description,
      departments: departments || [],
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function listRoles(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const roles = await Role.find({ isDeleted: false }).sort({ createdAt: -1 });
    res.json({ success: true, data: roles });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const role = await Role.findOne({ _id: req.params.roleId, isDeleted: false });
    if (!role) {
      res.status(404).json({ success: false, message: 'Role not found' });
      return;
    }
    res.json({ success: true, data: role });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roleId } = req.params;
    const { name, description, departments, isActive } = req.body;

    if (!req.user?.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Only main admin can update roles' });
      return;
    }

    const role = await Role.findOne({ _id: roleId, isDeleted: false });
    if (!role) {
      res.status(404).json({ success: false, message: 'Role not found' });
      return;
    }

    if (departments) {
      const deptNames = departments.map((d: any) => d.name.trim().toLowerCase());
      if (new Set(deptNames).size !== deptNames.length) {
        res.status(400).json({
          success: false,
          message: 'Duplicate department names are not allowed within a role',
        });
        return;
      }
    }

    if (name !== undefined) {
      const existing = await Role.findOne({
        name: name.trim(),
        _id: { $ne: roleId },
        isDeleted: false,
      });
      if (existing) {
        res.status(409).json({ success: false, message: 'Role name already exists' });
        return;
      }
      role.name = name.trim();
    }
    if (description !== undefined) role.description = description;
    if (departments !== undefined) role.departments = departments;
    if (isActive !== undefined) role.isActive = isActive;

    await role.save();

    res.json({ success: true, message: 'Role updated successfully', data: role });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roleId } = req.params;

    if (!req.user?.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Only main admin can delete roles' });
      return;
    }

    const role = await Role.findById(roleId);
    if (!role) {
      res.status(404).json({ success: false, message: 'Role not found' });
      return;
    }

    role.isDeleted = true;
    role.isActive = false;
    await role.save();

    res.json({ success: true, message: 'Role deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}