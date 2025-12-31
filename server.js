import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS
app.use(cors({
  origin: "https://kiranregmi.com",
  credentials: true
}));

// DATA FILES
const USERS_FILE = path.join(__dirname, "users.json");
const PROJECTS_FILE = path.join(__dirname, "projects.json");
const QUESTIONS_FILE = path.join(__dirname, "questions.json");

// JWT
const JWT_SECRET = "super_secret_key_change_later!!!";

// AUTH TOKEN MIDDLEWARE
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: "Invalid token" });
  }
}

// GET USERS
app.get("/api/users", (req, res) => {
  const users = JSON.parse(fs.readFileSync(USERS_FILE));
  res.json(users);
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  const users = JSON.parse(fs.readFileSync(USERS_FILE));
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const validPass = bcrypt.compareSync(password, user.passwordHash);
  if (!validPass) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign({ email, role: user.role }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ email: user.email, role: user.role, token });
});

// PROJECTS (protected)
app.get("/api/projects", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(PROJECTS_FILE));
  res.json(data);
});

// QUESTIONS (protected)
app.get("/api/questions", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE));
  res.json(data);
});

// DEPLOYMENT PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Backend live on port " + PORT));
