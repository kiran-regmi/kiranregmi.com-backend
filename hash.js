const bcrypt = require("bcrypt");

async function run() {
  const adminHash = await bcrypt.hash("Admin@123", 10);
  const userHash = await bcrypt.hash("User@123", 10);

  console.log("Admin hash:", adminHash);
  console.log("User hash:", userHash);
}

run();
