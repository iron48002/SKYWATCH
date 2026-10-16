import { Router, type IRouter } from "express";
import healthRouter from "./health";
import skywatcherRouter from "./skywatcher";

const router: IRouter = Router();

router.use(healthRouter);
router.use(skywatcherRouter);

export default router;
