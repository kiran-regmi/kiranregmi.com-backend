// config/config.js
// Central configuration — all env vars in one place

export const config = {
  port:      process.env.PORT      || 10000,
  jwtSecret: process.env.JWT_SECRET || (() => {
    console.warn("⚠️  JWT_SECRET not set in environment — using insecure default. Set it in Render env vars!");
    return "INSECURE_DEFAULT_CHANGE_THIS_NOW";
  })(),
  nodeEnv:   process.env.NODE_ENV  || "development",
  isDev:     process.env.NODE_ENV  !== "production",

  // CORS allowed origins
  allowedOrigins: [
    "https://kiranregmi.com",
    "https://www.kiranregmi.com",
    "https://kiranregmi.vercel.app"
  ],

  // Token expiry
  tokenExpiry: "2h",

  // Rate limiting
  loginRateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // max attempts per window per IP
  },
  apiRateLimit: {
    windowMs: 60 * 1000,       // 1 minute
    max: 60,                   // general API calls
  }
};
