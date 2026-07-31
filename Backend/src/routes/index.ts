import { Router } from "express";

import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { hodScope } from "../middleware/hodScope.js";
import { adminRouter } from "./admin.routes.js";
import { authRouter } from "./auth.routes.js";
import { examRouter } from "./exam.routes.js";
import { facultyRouter } from "./faculty.routes.js";
import { hodRouter } from "./hod.routes.js";
import { studentRouter } from "./student.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", requireAuth, requireSuperAdmin, adminRouter);
apiRouter.use("/hod", requireAuth, hodScope, hodRouter);
apiRouter.use("/exams", examRouter);
apiRouter.use("/faculty", facultyRouter);
apiRouter.use("/student", studentRouter);
