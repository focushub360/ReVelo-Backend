export function paginatedQuery(Model, baseFilter = {}) {
  return async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      // A tenant is derived from the server session, never from request parameters.
      const filter = req.tenantId ? { ...baseFilter, dealership: req.tenantId } : { ...baseFilter };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
      if (req.query.from || req.query.to) {
        filter.createdAt = {};
        if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
        if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
      }
      if (req.query.search)
        filter.$or = ['registration', 'vehicleCode', 'enquiryCode', 'code', 'name'].map((field) => ({
          [field]: { $regex: req.query.search, $options: 'i' },
        }));
      const populatePaths = ['vehicle', 'person', 'assignedTo', 'activeVehicle', 'currentLocation'].filter(
        (path) => Model.schema.path(path)
      );
      const itemsQuery = Model.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
      if (populatePaths.length) itemsQuery.populate(populatePaths.join(' '));
      const [items, total] = await Promise.all([itemsQuery.lean(), Model.countDocuments(filter)]);
      res.json({ items, page, total, pages: Math.ceil(total / limit) });
    } catch (error) {
      next(error);
    }
  };
}
