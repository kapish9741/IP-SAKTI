import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import healthRouter from "./routes/health.js";
import askRouter from "./routes/ask.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS for frontend clients
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Routes
app.use("/", healthRouter);
app.use("/api", askRouter);

// Fallback error handler
app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    status: "error",
    message: "An unexpected server error occurred.",
    error_code: "INTERNAL_ERROR",
  });
});

app.listen(PORT, () => {
  console.log(`[IP-SAKTI API] Server running on http://localhost:${PORT}`);
  console.log(`[IP-SAKTI API] Health check at http://localhost:${PORT}/health`);
  console.log(`[IP-SAKTI API] Ask endpoint at http://localhost:${PORT}/api/ask`);
});

export default app;
