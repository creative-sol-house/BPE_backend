// controller/serviceController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Service, {
  SERVICE_STATUSES,
  SERVICE_BILLING_TYPES,
  type ServiceStatus,
  type ServiceBillingType,
} from '../model/service';
import { AuthRequest } from '../middleware/auth';

// ─── Options (for dropdowns / ComboField) ────────────────────────────────
export async function listServiceOptions(
  _req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const services = await Service.find({
      isDeleted: false,
      status: 'active',
    })
      .select('_id name code category')
      .sort('name')
      .lean();

    res.json({
      success: true,
      data: services.map((s) => ({
        _id: String(s._id),
        name: s.name,
        code: s.code,
        category: s.category,
      })),
    });
  } catch (err: any) {
    console.error('listServiceOptions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── List ────────────────────────────────────────────────────────────────
export async function listServices(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      status,
      category,
      billingType,
      search,
      onlyDeleted,
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (billingType) filter.billingType = billingType;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [services, total] = await Promise.all([
      Service.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Service.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: services,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listServices error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get one ─────────────────────────────────────────────────────────────
export async function getService(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { serviceId } = req.params;
    const idStr = String(serviceId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { serviceId: idStr, isDeleted: false };

    const service = await Service.findOne(query);
    if (!service) {
      res.status(404).json({ success: false, message: 'Service not found' });
      return;
    }

    res.json({ success: true, data: service });
  } catch (err: any) {
    console.error('getService error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Create ──────────────────────────────────────────────────────────────
export async function createService(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      name,
      code,
      description,
      category,
      tags,
      basePrice,
      currency,
      billingType,
      taxRate,
      estimatedDurationDays,
      deliveryNotes,
      status,
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, message: 'name is required' });
      return;
    }

    if (status !== undefined && !SERVICE_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${SERVICE_STATUSES.join(', ')}`,
      });
      return;
    }

    if (
      billingType !== undefined &&
      !SERVICE_BILLING_TYPES.includes(billingType)
    ) {
      res.status(400).json({
        success: false,
        message: `Invalid billingType. Allowed: ${SERVICE_BILLING_TYPES.join(', ')}`,
      });
      return;
    }

    const service = new Service({
      name: String(name).trim(),
      code: code ? String(code).trim().toUpperCase() : undefined,
      description: description ? String(description).trim() : undefined,
      category: category ? String(category).trim() : undefined,
      tags: Array.isArray(tags) ? tags : [],

      basePrice: basePrice !== undefined ? Number(basePrice) : 0,
      currency: currency ? String(currency).toUpperCase() : 'PKR',
      billingType: (billingType as ServiceBillingType) || 'one_time',
      taxRate: taxRate !== undefined ? Number(taxRate) : 0,

      estimatedDurationDays:
        estimatedDurationDays !== undefined
          ? Number(estimatedDurationDays)
          : undefined,
      deliveryNotes: deliveryNotes ? String(deliveryNotes).trim() : undefined,

      status: (status as ServiceStatus) || 'active',

      createdBy: req.user?._id ?? null,
    });

    await service.save();

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service,
    });
  } catch (err: any) {
    console.error('createService error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update ──────────────────────────────────────────────────────────────
export async function updateService(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { serviceId } = req.params;
    const idStr = String(serviceId);

    const {
      name,
      code,
      description,
      category,
      tags,
      basePrice,
      currency,
      billingType,
      taxRate,
      estimatedDurationDays,
      deliveryNotes,
      status,
    } = req.body;

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { serviceId: idStr, isDeleted: false };

    const service = await Service.findOne(query);
    if (!service) {
      res.status(404).json({ success: false, message: 'Service not found' });
      return;
    }

    if (status !== undefined && !SERVICE_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${SERVICE_STATUSES.join(', ')}`,
      });
      return;
    }

    if (
      billingType !== undefined &&
      !SERVICE_BILLING_TYPES.includes(billingType)
    ) {
      res.status(400).json({
        success: false,
        message: `Invalid billingType. Allowed: ${SERVICE_BILLING_TYPES.join(', ')}`,
      });
      return;
    }

    if (name !== undefined) service.name = String(name).trim();
    if (code !== undefined)
      service.code = code ? String(code).trim().toUpperCase() : undefined;
    if (description !== undefined)
      service.description = description ? String(description).trim() : undefined;
    if (category !== undefined)
      service.category = category ? String(category).trim() : undefined;
    if (Array.isArray(tags)) service.tags = tags;

    if (basePrice !== undefined) service.basePrice = Number(basePrice);
    if (currency !== undefined) service.currency = String(currency).toUpperCase();
    if (billingType !== undefined) service.billingType = billingType;
    if (taxRate !== undefined) service.taxRate = Number(taxRate);

    if (estimatedDurationDays !== undefined)
      service.estimatedDurationDays = Number(estimatedDurationDays);
    if (deliveryNotes !== undefined)
      service.deliveryNotes = deliveryNotes ? String(deliveryNotes).trim() : undefined;

    if (status !== undefined) service.status = status as ServiceStatus;

    service.updatedBy = req.user?._id ?? null;

    await service.save();

    res.json({
      success: true,
      message: 'Service updated successfully',
      data: service,
    });
  } catch (err: any) {
    console.error('updateService error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Status change ───────────────────────────────────────────────────────
export async function changeServiceStatus(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { serviceId } = req.params;
    const { status } = req.body;
    const idStr = String(serviceId);

    if (!status || !SERVICE_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${SERVICE_STATUSES.join(', ')}`,
      });
      return;
    }

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { serviceId: idStr, isDeleted: false };

    const service = await Service.findOne(query);
    if (!service) {
      res.status(404).json({ success: false, message: 'Service not found' });
      return;
    }

    service.status = status as ServiceStatus;
    service.updatedBy = req.user?._id ?? null;
    await service.save();

    res.json({
      success: true,
      message: 'Service status updated',
      data: service,
    });
  } catch (err: any) {
    console.error('changeServiceStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Delete / Restore ────────────────────────────────────────────────────
export async function deleteService(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { serviceId } = req.params;
    const idStr = String(serviceId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { serviceId: idStr, isDeleted: false };

    const service = await Service.findOne(query);
    if (!service) {
      res.status(404).json({ success: false, message: 'Service not found' });
      return;
    }

    service.isDeleted = true;
    service.isActive = false;
    await service.save();

    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (err: any) {
    console.error('deleteService error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreService(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { serviceId } = req.params;
    const idStr = String(serviceId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr }
      : { serviceId: idStr };

    const service = await Service.findOne(query);
    if (!service) {
      res.status(404).json({ success: false, message: 'Service not found' });
      return;
    }

    service.isDeleted = false;
    service.deletedAt = undefined;
    service.status = 'active';
    await service.save();

    res.json({
      success: true,
      message: 'Service restored successfully',
      data: service,
    });
  } catch (err: any) {
    console.error('restoreService error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}