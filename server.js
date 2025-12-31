import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS FIX ⬇⬇⬇
app.use(cors({
  origin: "https://kiranregmi.com", // allow requests from your frontend
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));
// CORS FIX END ⬆⬆⬆

// File paths
const USERS_FILE = path.join(__dirname, "users.json");

// Load Users
let users = JSON.parse(fs.readFileSync(USERS_FILE));

// LOGIN API
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.status(400).json({ success: false, message: "Invalid email or password" });
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);

  if (!isValid) {
    return res.status(400).json({ success: false, message: "Invalid email or password" });
  }

  return res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
