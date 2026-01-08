// server.js
import express from "express";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import { fileURLToPath } from "url";

const ADMIN_ACCESS_EXPIRED = true;
const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = "super_secret_key_change_later!!!";

// Fix __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSON Files located in SAME folder as server.js
const USERS_FILE = path.join(__dirname, "users.json");
const QUESTIONS_FILE = path.join(__dirname, "questions.json");
const PROJECTS_FILE = path.join(__dirname, "projects.json");

// CORS config - Middleware
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      "https://kiranregmi.com",
      "https://www.kiranregmi.com",
      "https://kiranregmi.vercel.app"
    ];

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS blocked"));
    }
  },
  credentials: true
}));

app.use(express.json());

// --- JWT authenticateToken middleware ---

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Missing auth token" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("JWT verify error:", err);
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = user; // { email, role, iat, exp }
    next();
  });
}

//Add a Role Guard - RBAC enforcement 
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const { role } = req.user;

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "Access denied: insufficient privileges"
      });
    }

    next();
  };
}



// ✨ LOGIN ROUTE
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
    const user = users.find(u => u.email === email);

    if (!user) return res.status(401).json({ message: "Invalid user" });

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ token, role: user.role });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ✨ QUESTIONS API — now actually protected
// test user get 403 | admin and user get 200

app.get(
  "/api/questions",
  authenticateToken,
  requireRole(["admin", "user"]),
  async (req, res) => {
    try {
      const data = await fs.readFile(QUESTIONS_FILE, "utf-8");
      const questions = JSON.parse(data);

      res.json({ success: true, questions });
    } catch (err) {
      res.status(500).json({ message: "Server error loading questions" });
    }
  }
);


  // You could do role-based filtering here later if you want:
app.get(
  "/api/secure-doc/:name",
  authenticateToken,
  requireRole(["admin"]), // 🔐 ONLY admin
  async (req, res) => {
    try {
      const safeName = path.basename(req.params.name);
      const filePath = path.join(__dirname, "assets/pdf", safeName);

      res.sendFile(filePath);
    } catch (err) {
      res.status(404).json({ message: "File not found" });
    }
  }
);

// 🔐 SECURE DOC API — ADMIN ONLY
app.get(
  "/api/secure-doc/:name",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const safeName = path.basename(req.params.name);
      const filePath = path.join(__dirname, "assets/pdf", safeName);

      res.sendFile(filePath);
    } catch {
      res.status(404).json({ message: "File not found" });
    }
  }
);

    // const role = req.user.role; // "admin" or "user"

    res.json({
      success: true,
      questions
    });

// Root test
app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
