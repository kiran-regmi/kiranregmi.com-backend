const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ["https://kiranregmi.com", "https://www.kiranregmi.com"],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(bodyParser.json());

// Load Users + Questions
const users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json"), "utf8"));
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));

// LOGIN
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ success: false, message: "Invalid email or password" });

  return res.json({
    success: true,
    email: user.email,
    role: user.role
  });
});

// QUESTIONS API
app.get("/api/questions", (req, res) => {
  res.json(questions);
});

// Root Test
app.get("/", (req, res) => {
  res.send("Backend is running ✔");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
