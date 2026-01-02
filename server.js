// server.js
import express from "express";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import { fileURLToPath } from "url";

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

// Middleware
app.use(cors({
  origin: "https://www.kiranregmi.com",
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// --- JWT auth middleware ---

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
app.get("/api/questions", authenticateToken, async (req, res) => {
  try {
    const data = await fs.readFile(QUESTIONS_FILE, "utf-8");
    const questions = JSON.parse(data);

    // You could do role-based filtering here later if you want:
    // const role = req.user.role; // "admin" or "user"

    res.json({
      success: true,
      questions
    });
  } catch (err) {
    console.error("Error loading questions:", err);
    res.status(500).json({ success: false, message: "Server error loading questions" });
  }
});

// Root test
app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
