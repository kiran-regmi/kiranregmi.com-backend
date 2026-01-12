import bcrypt from "bcryptjs";

const passwords = [
  { email: "admin@kiranregmi.com", password: "Admin@123", role: "admin" },
  { email: "user@kiranregmi.com", password: "User@123", role: "user" },
  { email: "test@kiranregmi.com", password: "Test@123", role: "user" },
  { email: "kid@kiranregmi.com", password: "Kid@123", role: "kid" },
  { email: "adult@kiranregmi.com", password: "Baba@123", role: "adult" }
];

async function generate() {
  for (const user of passwords) {
    const hash = await bcrypt.hash(user.password, 10);
    console.log(`Email: ${user.email}`);
    console.log(`Hash: ${hash}`);
    console.log("------------------------");
  }
}

generate();
