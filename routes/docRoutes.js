// routes/docRoutes.js
// ─────────────────────────────────────────────────────────────
//  Secure document delivery — admin only
// ─────────────────────────────────────────────────────────────

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { authenticateToken, requireRole } from "../middleware/auth.js";
import { auditLog, EVENT } from "../db/auditLogger.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// GET /api/secure-doc/:name — admin only
router.get(
  "/:name",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      // path.basename prevents directory traversal attacks (../../etc/passwd)
      const safeName = path.basename(req.params.name);
      const filePath = path.join(__dirname, "../assets/pdf", safeName);

      auditLog({
        event_type: EVENT.SENSITIVE_API,
        outcome:    "success",
        req,
        user_email: req.user.email,
        user_role:  req.user.role,
        metadata:   { document: safeName },
      });

      res.sendFile(filePath, (err) => {
        if (err) res.status(404).json({ message: "Document not found" });
      });

    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
