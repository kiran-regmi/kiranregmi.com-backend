const bcrypt = require("bcrypt");

(async () => {
  const adminHash = await bcrypt.hash("Admin@123", 10);
  console.log("Admin Hash:", adminHash);

  const userHash = await bcrypt.hash("User@123", 10);
  console.log("User Hash:", userHash);

  process.exit();
})();
