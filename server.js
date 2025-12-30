const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { JWT_SECRET, PORT } = require("./config");

// users + questions loaded from JSON
let users = require("./users.json");
let questions = require("./questions.json");

const USERS_FILE = path.join(__dirname, "users.json");
const QUESTIONS_FILE = path.join(__dirname, "questions.json");

const app = express();

// Enable CORS for local Dev + Live Domain
app.use(cors({
  origin: [
    "http://kiranregmi.com",
    "https://kiranregmi.com"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* ---------------- AUTH ---------------- */

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword)
    return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({
    message: "Logged in successfully",
    token,
    email: user.email,   // 👈 MISSING BEFORE — FIXED!
    role: user.role,
    name: user.name
  });
});

// Public Signup — Standard Users Only
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Email & password required" });

  const exists = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) return res.status(409).json({ message: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    name: name || email,
    email,
    password: hashed,
    role: "user"
  };

  users.push(newUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  res.status(201).json({ message: "User registered successfully" });
});

/* --- Middleware --- */
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function verifyAdmin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
}

/* ---------------- QUESTIONS API ---------------- */

app.get("/api/questions", verifyToken, (req, res) => {
  res.json({ questions });
});

app.post("/api/questions", verifyToken, verifyAdmin, (req, res) => {
  const newQ = {
    id: Date.now(),
    question: req.body.question,
    answer: req.body.answer,
    category: req.body.category
  };
  questions.push(newQ);
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
  res.status(201).json({ message: "Question added", question: newQ });
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, () =>
  console.log(`Backend running on port ${PORT}`)
);
