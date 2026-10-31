export function escapeSearchTerm(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toPublicVehicle(vehicle, price) {
  return {
    id: String(vehicle._id),
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    odometer: vehicle.odometer,
    price: price ?? null,
    dealer: vehicle.dealership
      ? {
          name: vehicle.dealership.name,
          city: vehicle.dealership.address?.city || '',
          state: vehicle.dealership.address?.state || '',
        }
      : null,
    images: (vehicle.images || []).map((image) => ({
      id: String(image._id),
      url: `/api/v1/public/vehicles/${vehicle._id}/images/${image._id}`,
    })),
  };
}
