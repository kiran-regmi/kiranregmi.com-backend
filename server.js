const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { JWT_SECRET, PORT } = require("./config");

// users + questions loaded from JSON
let users = require("./users.json");
let questions = require("./questions.json");

const USERS_FILE = path.join(__dirname, "users.json");
const QUESTIONS_FILE = path.join(__dirname, "questions.json");

const app = express();

// trust Render proxy so HTTPS checks work
app.set("trust proxy", 1);

// Basic hardening headers
app.use(helmet());

// Enable CORS for local Dev + Live Domain
app.use(cors({
  origin: [
    "http://localhost:8080",
    "http://localhost:5173",
    "https://kiranregmi.com",
    "https://www.kiranregmi.com"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
})
);

app.use(express.json());

// Enforce HTTPS in production (Render)
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    if (proto && proto !== "https") {
      return res.redirect("https://" + req.headers.host + req.url);
    }
    next();
  });
}

// Rate limit all /api/* routes – A+3 choice
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // 100 reqs per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

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
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

