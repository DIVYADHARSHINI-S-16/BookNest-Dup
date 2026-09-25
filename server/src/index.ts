import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { testConnection } from "./db/pool";
import { connectRedis } from "./config/redis";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/authRoutes";
import bookRoutes from "./routes/bookRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import cartRoutes from "./routes/cartRoutes";
import orderRoutes from "./routes/orderRoutes";
import adminRoutes from "./routes/adminRoutes";
import storeRoutes from "./routes/storeRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "booknest-server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stores", storeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    await testConnection();
  } catch (err) {
    console.error("Failed to start server (PostgreSQL required):", err);
    process.exit(1);
  }

  try {
    await connectRedis();
  } catch (err) {
    console.error("Redis unavailable, continuing without cache:", (err as Error).message);
  }

  app.listen(PORT, () => {
    console.log(`BookNest server running on http://localhost:${PORT}`);
  });
}

start();
