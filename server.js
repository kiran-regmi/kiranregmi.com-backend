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
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isMatch = bcrypt.compareSync(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { email: user.email, role: user.role },
    "SUPER_SECRET",
    { expiresIn: "2h" }
  );

  res.json({ token, role: user.role });
});

app.get("/", (req, res) => {
  res.send("Backend Running");
});

app.listen(PORT, () =>
  console.log(`Backend live → http://localhost:${PORT}`)
);
