// config/config.js
// Central configuration — all env vars in one place

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
  // NOTE: not actually used anywhere yet — authRoutes.js hardcodes 24h directly
  // in its jwt.sign() calls instead of reading this value. Worth wiring this in
  // if you want config.tokenExpiry to be the real source of truth.
  tokenExpiry: "2h",

  // Rate limiting
  loginRateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // max attempts per window per IP
  },
  apiRateLimit: {
    windowMs: 60 * 1000,       // 1 minute
    max: 60,                   // general API calls
  },

  // Google Sheets access — used by routes/tradesRoutes.js
  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    // Render preserves literal \n characters in a pasted multi-line env var --
    // this un-escapes them back into real newlines, which the Google auth
    // library requires in the private key.
    privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n"),
    sheetId:  process.env.GOOGLE_SHEET_ID  || "",
    sheetTab: process.env.GOOGLE_SHEET_TAB || "Daily-Logs",
  }
};