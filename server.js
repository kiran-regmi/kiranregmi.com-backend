import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 5000;

// CORS for frontend domain
app.use(cors({
  origin: ["https://kiranregmi.com", "https://www.kiranregmi.com"],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(bodyParser.json());

// Load JSON Users
const usersPath = path.resolve("users.json");
let users = JSON.parse(fs.readFileSync(usersPath, "utf8"));

// Login Route
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    res.json({
      success: true,
      email: user.email,
      role: user.role || "user"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
