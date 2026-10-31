import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Dealership, Vehicle, Person, OwnershipPeriod, Enquiry, Audit } from '../models/index.js';
import { id, audit, httpError } from '../utils/core.js';
import { publicLeadConfig, configuredPublicFields, DEFAULT_PUBLIC_FIELDS } from '../services/publicLeadService.js';

const router = Router();

// Public seller lead capture. An opaque location value is resolved server-side to an active dealership;
// dealership identity is never rendered on the public page.
router.get('/public/sell-locations', async (req, res, next) => {
  try {
    const config = await publicLeadConfig();
    const configured = (config?.locations || []).filter((location) => location.active);
    const dealerships = await Dealership.find({
      _id: { $in: configured.map((location) => location.dealership) },
      active: true,
      'subscription.status': 'Active',
    }).select('address.city address.state address.country').lean();
    const activeDealers = new Map(dealerships.map((dealership) => [String(dealership._id), dealership]));
    res.json({
      fields: configuredPublicFields(config),
      locations: configured.flatMap((location) => {
        const dealership = activeDealers.get(String(location.dealership));
        return dealership ? [{
          id: String(location._id), label: location.label,
          city: dealership.address?.city || location.label,
          state: dealership.address?.state || '', country: dealership.address?.country || 'India',
        }] : [];
      }),
    });
  } catch (error) {
    next(error);
  }
});
router.post(
  '/public/seller-enquiries',
  rateLimit({ windowMs: 60 * 60e3, max: 5, standardHeaders: true }),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          locationId: z.string().regex(/^[a-f\d]{24}$/i),
          answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
          consentToContact: z.literal(true),
          website: z.string().max(0).optional(),
        })
        .parse(req.body);
      const config = await publicLeadConfig();
      const fields = configuredPublicFields(config);
      const answer = (key) => input.answers[key];
      const textAnswer = (key) => String(answer(key) ?? '').trim();
      const booleanAnswer = (key) => answer(key) === undefined || answer(key) === '' ? undefined : answer(key) === true || answer(key) === 'true';
      for (const field of fields) {
        if (field.required && !textAnswer(field.key)) throw httpError(400, `${field.label} is required`);
      }
      if (!/^[+0-9 ()-]{7,30}$/.test(textAnswer('phone'))) throw httpError(400, 'Enter a valid mobile number');
      if (!/^\d{6}$/.test(textAnswer('postalCode'))) throw httpError(400, 'Enter a valid 6-digit pincode');
      if (textAnswer('email') && !z.string().email().safeParse(textAnswer('email')).success) throw httpError(400, 'Enter a valid email address');
      const selectedLocation = (config?.locations || []).find((location) => String(location._id) === input.locationId && location.active);
      if (!selectedLocation) throw httpError(400, 'The selected location is not currently available');
      const dealership = await Dealership.findOne({
        _id: selectedLocation.dealership,
        active: true,
        'subscription.status': 'Active',
      });
      if (!dealership) throw httpError(400, 'The selected location is not currently available');
      const normalizedRegistration = textAnswer('registration').toUpperCase().replace(/\s+/g, '');
      let vehicle = await Vehicle.findOne({ dealership: dealership.id, registration: normalizedRegistration });
      if (!vehicle) {
        vehicle = await Vehicle.create({
          make: textAnswer('make'), model: textAnswer('model'),
          year: answer('year') ? Number(answer('year')) : undefined,
          odometer: answer('odometer') ? Number(answer('odometer')) : undefined,
          registration: normalizedRegistration,
          dealership: dealership.id,
          vehicleCode: id('VEH'),
          lifecycle: 'Enquiry Created',
          activities: [{ type: 'public-enquiry', message: 'Vehicle submitted through public seller form' }],
        });
      }
      const seller = await Person.create({
        dealership: dealership.id,
        customerReference: id('SEL'),
        name: textAnswer('name'), phone: textAnswer('phone'), email: textAnswer('email') || undefined,
        kind: 'seller',
      });
      const enquiry = await Enquiry.create({
        dealership: dealership.id,
        enquiryCode: id('ENQ'),
        type: 'seller',
        vehicle: vehicle.id,
        person: seller.id,
        source: 'Public sell-your-car form',
        declaredAccidentHistory: textAnswer('previousAccidents') || undefined,
        history: [{ type: 'public-submission', message: 'Seller submitted initial vehicle details', at: new Date() }],
        publicSubmission: {
          nearestLocation: { city: selectedLocation.label, state: dealership.address?.state },
          address: { line1: textAnswer('line1'), locality: textAnswer('locality'), city: textAnswer('city'), state: textAnswer('state'), postalCode: textAnswer('postalCode') },
          ownerCount: answer('ownerCount') ? Number(answer('ownerCount')) || undefined : undefined,
          isFirstOwner: booleanAnswer('isFirstOwner'),
          rcAvailable: booleanAnswer('rcAvailable'),
          insuranceRenewalDate: answer('insuranceRenewalDate') ? new Date(answer('insuranceRenewalDate')) : undefined,
          hasActiveLoan: booleanAnswer('hasActiveLoan'),
          loanProvider: textAnswer('loanProvider') || undefined,
          customFields: fields.filter((field) => !DEFAULT_PUBLIC_FIELDS.some((standard) => standard.key === field.key)).map((field) => ({ fieldId: String(field._id), label: field.label, value: answer(field.key) })).filter((field) => field.value !== undefined && field.value !== ''),
          consentToContact: true,
          proofStatus: 'Not Requested',
        },
      });
      await OwnershipPeriod.create({ vehicle: vehicle.id, owner: seller.id, source: 'Public seller declaration' });
      await audit(Audit, undefined, 'PUBLIC_SELLER_ENQUIRY', 'Enquiry', enquiry.id, {
        dealership: dealership.id,
        sellerReference: seller.customerReference,
        location: dealership.address?.city,
      });
      res.status(201).json({
        sellerReference: seller.customerReference,
        enquiryReference: enquiry.enquiryCode,
        message: 'Your details have been received. The nearby team will contact you to request proof documents.',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
