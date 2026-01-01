import bcrypt from "bcryptjs";

const passwords = [
  { email: "admin@kiranregmi.com", password: "Admin@123", role: "admin" },
  { email: "user@kiranregmi.com", password: "User@123", role: "user" }
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
