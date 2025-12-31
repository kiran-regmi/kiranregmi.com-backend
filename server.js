// server.js - CLEAN FULL WORKING VERSION 🚀

import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 5000;

// CORS SETTINGS (allow frontend only)
app.use(cors({
  origin: [
    "https://kiranregmi.com",
    "https://www.kiranregmi.com",
    "https://kiranregmi-com-backend.onrender.com"
  ],
  methods: "GET,POST,PUT,DELETE",
  credentials: true
}));

app.use(bodyParser.json());

// ROOT PATHS FOR JSON FILES
const ROOT = path.resolve();
const usersFile = path.join(ROOT, "users.json");
const questionsFile = path.join(ROOT, "questions.json");

// JWT SECRET
const JWT_SECRET = "super_secret_key_change_later!!!";

// 🩺 HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "Backend Running OK!" });
});

// 📌 LOAD USERS
function loadUsers() {
  if (!fs.existsSync(usersFile)) return [];
  return JSON.parse(fs.readFileSync(usersFile));
}

// 📌 SAVE USERS
function saveUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// 👉 REGISTER API
app.post("/api/register", (req, res) => {
  const { name, email, password, role } = req.body;
  const users = loadUsers();

  if (users.find(u => u.email === email)) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  const newUser = {
    id: Date.now(),
    name,
    email,
    role: role || "user",
    password: hashedPassword
  };

  users.push(newUser);
  saveUsers(users);

  res.json({ message: "Registered successfully" });
});

// 👉 LOGIN API
app.post("/api/login", (req, res) => {
  console.log("Login request hit backend!");
  const { email, password } = req.body;

  const users = loadUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, role: user.role });
});

// 🔐 AUTH MIDDLEWARE
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(403).json({ message: "No token provided" });

  const token = header.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
}

// 👉 PROTECTED: QUESTIONS API
app.get("/api/questions", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(questionsFile));
  res.json(data);
});

// ⭐ ADMIN ONLY - Get all users
app.get("/api/users", auth, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Not authorized" });
  }
  const users = loadUsers().map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  res.json(users);
});

// START SERVER ✅
app.listen(PORT, () => {
  console.log(`Backend Live on Port ${PORT}`);
});
