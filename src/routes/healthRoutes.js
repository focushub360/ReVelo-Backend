import { Router } from 'express';
import { User } from '../models/user.js';

const router=Router();

router.get('/health',(req,res)=>res.json({status:'ok'}));
router.get('/ready',async(req,res,next)=>{try{await User.findOne().lean();res.json({status:'ready'})}catch(error){next(error)}});

export default router;
