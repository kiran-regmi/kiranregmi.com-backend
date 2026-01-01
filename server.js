// server.js
// Simple backend for login + interview questions

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { JWT_SECRET, PORT } = require("./config");

// Load data files
const users = require("./users.json");
const questions = require("./questions.json");

const app = express();

// ---------- Middleware ----------
app.use(express.json());

// Allow your frontend origins
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "https://kiranregmi.com",
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (no origin) and the allowed list
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn("CORS blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

// Simple health check
app.get("/", (req, res) => {
  res.send("kiranregmi.com backend is running 🚀");
});

// ---------- Auth helper (optional later) ----------
function createToken(user) {
  return jwt.sign(
    {
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

// ---------- /api/login ----------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const user = users.find(
      (u) => u.email.toLowerCase() === String(email).toLowerCase()
    );

    if (!user) {
      return res
        .status(401)
        .json({ message: "Invalid email or password (user not found)." });
    }

    // users.json uses passwordHash, not password
    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      return res
        .status(401)
        .json({ message: "Invalid email or password (bad password)." });
    }

    const token = createToken(user);

    return res.json({
      message: "Logged in successfully.",
      token,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error during login." });
  }
});

// ---------- /api/questions ----------
// For now this is PUBLIC (no token needed) so you can just make it work.
// We can add auth later once everything is stable.
app.get("/api/questions", (req, res) => {
  try {
    return res.json(questions);
  } catch (err) {
    console.error("Questions error:", err);
    return res.status(500).json({ message: "Failed to load questions." });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
