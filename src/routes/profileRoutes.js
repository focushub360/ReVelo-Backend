import { Router } from 'express';
import { getProfile, updatePassword, updateProfile } from '../controllers/profileController.js';

const router = Router();

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.post('/profile/password', updatePassword);

export default router;
